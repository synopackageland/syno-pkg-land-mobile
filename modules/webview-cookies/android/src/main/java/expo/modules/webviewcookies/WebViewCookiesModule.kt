package expo.modules.webviewcookies

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.MotionEvent
import android.view.HapticFeedbackConstants
import android.graphics.BitmapFactory
import android.webkit.WebChromeClient
import android.webkit.PermissionRequest
import android.webkit.ConsoleMessage
import android.webkit.JsResult
import android.webkit.JsPromptResult
import android.webkit.ValueCallback
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class WebViewCookiesModule : Module() {
  private val io = Executors.newFixedThreadPool(2)
  private val discoveryIo = Executors.newFixedThreadPool(8)
  private val iconIo = Executors.newFixedThreadPool(4)
  private val maxIcon = 2 * 1024 * 1024
  private val sessionEpoch = ConcurrentHashMap<String, Long>()
  private val reads = AtomicInteger()
  private val scripts = mutableMapOf<Int, ScriptHandler>()
  private val fits = mutableMapOf<Int, ScriptHandler>() // Presentation-only start scripts; no transport
  private val resetScripts = mutableMapOf<Int, ScriptHandler>()
  private val bound = mutableMapOf<Int, WebView>()
  private val signIns = mutableMapOf<Int, SignInRelay>()
  private val maxIntake = 8 * 1024 * 1024
  private class SignInAttempt { @Volatile var cancelled = false; @Volatile var connection: HttpURLConnection? = null }
  private val signInAttempts = ConcurrentHashMap<String, SignInAttempt>()

  private fun origin(value: String): String {
    val u = URI(value)
    require(u.scheme == "http" || u.scheme == "https") { "Unsupported URL" }
    require(u.rawUserInfo == null && u.host != null) { "Invalid origin" }
    val port = if (u.port < 0) (if (u.scheme == "https") 443 else 80) else u.port
    return "${u.scheme.lowercase()}://${u.host.lowercase()}:$port"
  }

  private fun webViews(): List<WebView> {
    val result = mutableListOf<WebView>()
    fun walk(v: View) {
      if (v is WebView) result.add(v)
      else if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    appContext.currentActivity?.window?.decorView?.let { walk(it) }
    return result
  }

  private fun detach(id: Int) {
    signIns.remove(id)?.close()
    scripts.remove(id)?.remove()
    fits.remove(id)?.remove()
    resetScripts.remove(id)?.remove()
    bound.remove(id)?.let { WebViewCompat.removeWebMessageListener(it, "SynoPkgTransport") }
  }

  private fun resets() = appContext.reactContext!!.getSharedPreferences("storage-reset", android.content.Context.MODE_PRIVATE)
  /**
   * A sign-out or a native sign-in leaves DSM's page resume data (`crossPortData`, `lastHS`)
   * in localStorage, which WebStorage.deleteOrigin keeps. A new nonce makes the next document at the origin
   * remove it once (see storageResetScript); committed before the cookies change.
   */
  private fun markStorageReset(url: String) { resets().edit().putString(origin(url), UUID.randomUUID().toString()).commit() }

  private fun storeCookies(connection: HttpURLConnection, url: String, key: String, epoch: Long) {
    synchronized(sessionEpoch) {
      require((sessionEpoch[key] ?: 0L) == epoch) { "Session changed" }
      connection.headerFields.forEach { (name, values) -> if (name?.equals("Set-Cookie", true) == true) values.forEach { CookieManager.getInstance().setCookie(url, it) } }
    }
  }

  private fun intake(intent: Intent?): Map<String, Any> {
    if (intent == null || intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_VIEW)) return mapOf("items" to emptyList<Any>())
    // Clear before reading: recreation or a JS subscriber must not replay a share
    appContext.currentActivity?.intent = Intent(Intent.ACTION_MAIN)
    if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == "synopkgland" && intent.data?.host == "add-nas") {
      // Keep QR setup out of App intake; JS validates before any trust or network work.
      return mapOf("items" to emptyList<Any>(), "addNas" to (intent.dataString ?: ""))
    }
    return try {
      val items = mutableListOf<Map<String, Any>>()
      var budget = maxIntake
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
      val link = if (intent.action == Intent.ACTION_VIEW) intent.dataString else text
      if (!link.isNullOrEmpty()) {
        require(link.toByteArray().size <= budget) { "Shared text exceeds limit" }
        budget -= link.toByteArray().size
        val scheme = try { Uri.parse(link).scheme } catch (_: Exception) { null }
        items.add(if (scheme in listOf("http", "https", "magnet", "ed2k")) mapOf("kind" to "url", "url" to link) else mapOf("kind" to "text", "text" to link))
      }
      val uris = mutableListOf<Uri>()
      @Suppress("DEPRECATION")
      if (intent.action == Intent.ACTION_SEND_MULTIPLE) uris.addAll(intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList())
      else {
        @Suppress("DEPRECATION") val single = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        single?.let { uris.add(it) }
      }
      // Text shares may carry preview/provider URIs in ClipData. Only explicit
      // streams are attachments when EXTRA_TEXT already carries a text payload.
      val textPayload = intent.type?.startsWith("text/") == true && !text.isNullOrEmpty()
      if (uris.isEmpty() && !textPayload) {
        intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { if (it !in uris) uris.add(it) } }
      }
      require(uris.size <= 16) { "Too many shared files" }
      val resolver = appContext.reactContext!!.contentResolver
      for (uri in uris) {
        require(uri.scheme == "content") { "Only content URIs are accepted" }
        val bytes = resolver.openInputStream(uri)!!.use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(64 * 1024)
          while (output.size() <= budget) {
            val count = input.read(buffer, 0, minOf(buffer.size, budget + 1 - output.size()))
            if (count < 0) break
            output.write(buffer, 0, count)
          }
          output.toByteArray()
        }
        require(bytes.size <= budget) { "Shared files exceed limit" }
        budget -= bytes.size
        var name = "shared-file"
        resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) name = cursor.getString(0) ?: name }
        items.add(mapOf("kind" to "file", "filename" to name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(120), "mime" to (resolver.getType(uri) ?: "application/octet-stream"), "size" to bytes.size, "base64" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
      }
      mapOf("items" to items)
    } catch (_: Exception) { mapOf("items" to emptyList<Any>(), "error" to "intakeUnreadable") }
  }

  override fun definition() = ModuleDefinition {
    Name("WebViewCookies")
    Events("onBridgeMessage", "onIntake", "onTransfer", "onDocument", "onKeyboard", "onSignIn")
    Function("logSignIn") { stage: String ->
      require(stage in setOf("launcher_shown", "refresh_started", "refresh_finished", "refresh_failed"))
      Log.i("SynoPkgSignIn", "stage=$stage")
    }
    Function("logOpen") { stage: String, request: Int ->
      require(stage in setOf("tap_received", "intake_received", "open_requested", "webview_created", "open_waiting", "open_retry", "open_rejected", "press_started", "press_released")) { "Invalid open stage" }
      // Fixed stages and local sequence only: never URLs, account names or page data.
      Log.i("SynoPkgOpen", "request=$request stage=$stage")
    }
    AsyncFunction("setCertificatePins") { pins: List<Map<String, String>> ->
      CertificatePins.replace(pins)
      webViews().forEach { it.clearSslPreferences() }
    }.runOnQueue(Queues.MAIN)
    Function("cookieHeader") { url: String -> CookieManager.getInstance().getCookie(url) ?: "" }
    // A one-way session fingerprint scopes local snapshots without persisting cookies
    Function("sessionKey") { url: String ->
      origin(url)
      sessionFingerprint(CookieManager.getInstance().getCookie(url) ?: "")
    }
    AsyncFunction("clearSession") { url: String, keepDevice: Boolean, promise: Promise ->
      val key = origin(url)
      synchronized(sessionEpoch) { sessionEpoch.compute(key) { _, value -> (value ?: 0L) + 1L } }
      clearWebStorage(url)
      markStorageReset(url)
      val manager = CookieManager.getInstance()
      val host = URI(url).host
      val names = listOf("/", "/webman/", "/webapi/").flatMap { path ->
        (manager.getCookie(url + path) ?: "").split(';').map { it.trim().substringBefore('=') }
      }.let { cookiesToExpire(it, keepDevice) }
      val paths = listOf("/", "/webman", "/webman/", "/webapi", "/webapi/")
      val remaining = AtomicInteger(names.size * paths.size * 2)
      if (remaining.get() == 0) { manager.flush(); promise.resolve(null) }
      else for (name in names) for (path in paths) {
        val expired = "$name=; Max-Age=0; Path=$path; HttpOnly" + if (url.startsWith("https:")) "; Secure" else ""
        for (cookie in listOf(expired, "$expired; Domain=$host")) manager.setCookie(url, cookie) {
          if (remaining.decrementAndGet() == 0) {
            manager.flush()
            val stillSignedIn = (manager.getCookie(url) ?: "").split(';').any { it.trim().startsWith("id=") && it.trim().substringAfter('=').isNotEmpty() }
            if (stillSignedIn) promise.reject("SIGN_OUT_FAILED", "Sign-out did not clear the session", null) else promise.resolve(null)
          }
        }
      }
    }.runOnQueue(Queues.MAIN)
    // Phone label for DSM's trusted-device list: the user-visible device name, else the model
    Function("storageReset") { url: String -> resets().getString(origin(url), null) ?: "" }
    Function("deviceName") {
      val context = appContext.reactContext
      val named = context?.let { android.provider.Settings.Global.getString(it.contentResolver, "device_name") }
      (named?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}").take(64)
    }
    /**
     * Native Auth.login for the App's own sign-in screen. The reply exposes only the outcome,
     * the DSM error code and second-step types; sid, SynoToken and did stay in the cookie jar.
     */
    AsyncFunction("signIn") { allowedOrigin: String, body: String, userAgent: String, id: String, promise: Promise ->
      val key = origin(allowedOrigin)
      val epoch = sessionEpoch[key] ?: 0L
      val request = try { SignInRequest.parse(allowedOrigin, "$allowedOrigin/webapi/entry.cgi", body, emptyMap()) } catch (_: Exception) { promise.reject("invalid", "Invalid sign-in request", null); return@AsyncFunction }
      val attempt = SignInAttempt()
      require(signInAttempts.putIfAbsent(id, attempt) == null)
      io.execute {
        val current = { !attempt.cancelled && (sessionEpoch[key] ?: 0L) == epoch }
        try {
          val reply = AuthExchange.post(request, userAgent, { attempt.connection = it }, current)
          val json = try { org.json.JSONObject(reply.body.toString(Charsets.UTF_8)) } catch (_: Exception) { null }
          if (!reply.success) {
            val error = json?.optJSONObject("error")
            val types = error?.optJSONObject("errors")?.optJSONArray("types")?.let { list -> (0 until list.length()).mapNotNull { list.optJSONObject(it)?.optString("type")?.takeIf { t -> t.isNotEmpty() } } } ?: emptyList()
            promise.resolve(mapOf("success" to false, "status" to reply.status, "code" to (error?.optInt("code", 0) ?: 0), "types" to types))
            return@execute
          }
          var scope = ""
          // Another user's App data for this origin must not carry over
          clearWebStorage(allowedOrigin)
          markStorageReset(allowedOrigin)
          AuthExchange.commit(request.url, reply.cookies, current, ready = { accepted ->
            if (accepted) scope = sessionFingerprint(CookieManager.getInstance().getCookie(allowedOrigin) ?: "")
          })
          require(current() && scope.isNotEmpty()) { "Session cookies were not stored" }
          promise.resolve(mapOf("success" to true, "scope" to scope))
        } catch (error: Exception) {
          promise.reject(if (attempt.cancelled) "cancelled" else networkCause(error), "Sign-in request failed", null)
        } finally { signInAttempts.remove(id, attempt) }
      }
    }
    Function("cancelSignIn") { id: String ->
      signInAttempts[id]?.let { it.cancelled = true; it.connection?.disconnect() }
    }
    AsyncFunction("readJson") { url: String, allowedOrigin: String, language: String?, promise: Promise ->
      // DSM localizes package strings by Accept-Language; only a plain language list is sent
      val acceptLanguage = language?.takeIf { Regex("^[A-Za-z0-9,;=. -]{1,64}$").matches(it) }
      val key = origin(allowedOrigin)
      val epoch = sessionEpoch[key] ?: 0L
      val read = reads.incrementAndGet()
      val started = android.os.SystemClock.elapsedRealtime()
      Log.i("SynoPkgSession", "read=$read stage=queued")
      discoveryIo.execute {
        Log.i("SynoPkgSession", "read=$read stage=started elapsed=${android.os.SystemClock.elapsedRealtime() - started}")
        try {
          var next = url
          var result: Map<String, Any>? = null
          for (hop in 0..10) {
            require(origin(next) == origin(allowedOrigin)) { "Cross-origin discovery refused" }
            require((sessionEpoch[key] ?: 0L) == epoch) { "Session changed" }
            val connection = URI(next).toURL().openConnection() as HttpURLConnection
            CertificatePins.configure(connection)
            connection.instanceFollowRedirects = false
            // No request timeout; JS hedges slow reads without cancelling them
            CookieManager.getInstance().getCookie(next)?.let { connection.setRequestProperty("Cookie", it) }
            acceptLanguage?.let { connection.setRequestProperty("Accept-Language", it) }
            try {
              val code = connection.responseCode
              storeCookies(connection, next, key, epoch)
              if (code in listOf(301, 302, 303, 307, 308)) {
                next = URI(next).resolve(connection.getHeaderField("Location") ?: error("Missing redirect")).toString()
                continue
              }
              val stream = if (code in 200..299) connection.inputStream else connection.errorStream
              val bytes = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(64 * 1024)
                while (output.size() <= 8 * 1024 * 1024) {
                  val count = input.read(buffer, 0, minOf(buffer.size, 8 * 1024 * 1024 + 1 - output.size()))
                  if (count < 0) break
                  output.write(buffer, 0, count)
                }
                output.toByteArray()
              } ?: byteArrayOf()
              require(bytes.size <= 8 * 1024 * 1024) { "Discovery response too large" }
              result = mapOf("status" to code, "body" to bytes.toString(Charsets.UTF_8))
              break
            } finally { connection.disconnect() }
          }
          require(result != null) { "Too many redirects" }
          CookieManager.getInstance().flush()
          Log.i("SynoPkgSession", "read=$read stage=finished elapsed=${android.os.SystemClock.elapsedRealtime() - started}")
          promise.resolve(result)
        } catch (error: Exception) { Log.i("SynoPkgSession", "read=$read stage=failed elapsed=${android.os.SystemClock.elapsedRealtime() - started}"); promise.reject(networkCause(error), "Discovery request failed", null) }
      }
    }

    // App icons: same pins and cookies as discovery, conditional, written only inside files/app-icons
    AsyncFunction("fetchIcon") { url: String, allowedOrigin: String, dest: String, etag: String?, lastModified: String?, promise: Promise ->
      val root = File(appContext.reactContext!!.filesDir, "app-icons").canonicalFile
      iconIo.execute {
        var temp: File? = null
        try {
          val target = File(dest).canonicalFile
          require(target.path.startsWith(root.path + File.separator)) { "Invalid icon path" }
          var next = url
          var result: Map<String, Any?>? = null
          for (hop in 0..5) {
            require(origin(next) == origin(allowedOrigin)) { "Cross-origin icon refused" }
            val connection = URI(next).toURL().openConnection() as HttpURLConnection
            CertificatePins.configure(connection)
            connection.instanceFollowRedirects = false
            // Bounded: an icon never holds up the launcher, and a dead NAS frees the worker
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            CookieManager.getInstance().getCookie(next)?.let { connection.setRequestProperty("Cookie", it) }
            if (!etag.isNullOrEmpty()) connection.setRequestProperty("If-None-Match", etag)
            if (!lastModified.isNullOrEmpty()) connection.setRequestProperty("If-Modified-Since", lastModified)
            try {
              val code = connection.responseCode
              if (code in listOf(301, 302, 303, 307, 308)) {
                next = URI(next).resolve(connection.getHeaderField("Location") ?: error("Missing redirect")).toString()
                continue
              }
              if (code != 200) { result = mapOf("status" to code); break }
              val type = connection.contentType?.lowercase() ?: ""
              require(type.startsWith("image/") && !type.contains("svg")) { "Not a raster image" }
              val bytes = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(32 * 1024)
                while (output.size() <= maxIcon) {
                  val count = input.read(buffer, 0, minOf(buffer.size, maxIcon + 1 - output.size()))
                  if (count < 0) break
                  output.write(buffer, 0, count)
                }
                output.toByteArray()
              }
              require(bytes.size in 1..maxIcon) { "Icon size" }
              val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
              BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
              require(bounds.outWidth in 1..1024 && bounds.outHeight in 1..1024) { "Undecodable icon" }
              target.parentFile?.mkdirs()
              temp = File(target.parentFile, target.name + ".part")
              temp!!.writeBytes(bytes)
              require(temp!!.renameTo(target)) { "Cannot store icon" }
              temp = null
              result = mapOf("status" to 200, "etag" to connection.getHeaderField("ETag"), "lastModified" to connection.getHeaderField("Last-Modified"), "size" to bytes.size)
              break
            } finally { connection.disconnect() }
          }
          promise.resolve(result ?: error("Too many redirects"))
        } catch (error: Exception) {
          temp?.delete()
          promise.reject(networkCause(error), "Icon request failed", null)
        }
      }
    }
    Function("haptic") { kind: String ->
      val constant = when (kind) { "tick" -> HapticFeedbackConstants.CLOCK_TICK; "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY; else -> HapticFeedbackConstants.LONG_PRESS }
      appContext.currentActivity?.window?.decorView?.let { view -> view.post { view.performHapticFeedback(constant) } }
    }
    AsyncFunction("probe") { url: String, id: String, promise: Promise -> NasProbe.run(url, id) { promise.resolve(it) } }
    Function("cancelProbe") { id: String -> NasProbe.cancel(id) }
    Function("releaseProbe") { id: String -> NasProbe.release(id) }
    AsyncFunction("goBackIfPossible") { viewId: Int ->
      val view = webViews().find { it.id == viewId || (it.parent as? View)?.id == viewId }
      if (view?.canGoBack() == true) { view.goBack(); true } else false
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("bindBridge") { viewId: Int, allowedOrigin: String, script: String, camera: Boolean, signInScript: String, resetScript: String ->
      val view = webViews().find { it.id == viewId || (it.parent as? View)?.id == viewId } ?: return@AsyncFunction false
      detach(viewId)
      if ((script.isNotEmpty() || signInScript.isNotEmpty()) && (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))) return@AsyncFunction false
      val key = origin(allowedOrigin)
      val signIn = if (signInScript.isEmpty()) null else SignInRelay(view, allowedOrigin, signInScript, { sessionEpoch[key] ?: 0L }) { scope ->
        sendEvent("onSignIn", mapOf("viewId" to viewId, "origin" to allowedOrigin, "scope" to scope))
      }.also { signIns[viewId] = it }
      view.webViewClient = ScopedWebViewClient(view.webViewClient, { stage ->
        if (stage == "start") signIn?.documentStarted()
        sendEvent("onDocument", mapOf("viewId" to viewId, "stage" to stage))
      }, { request -> signIn?.intercept(request) })
      val delegate = view.webChromeClient
      view.webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(v: WebView, progress: Int) { delegate?.onProgressChanged(v, progress) }
        override fun onReceivedTitle(v: WebView, title: String?) { delegate?.onReceivedTitle(v, title) }
        override fun onConsoleMessage(message: ConsoleMessage?): Boolean = true // Never log page content
        override fun onCreateWindow(v: WebView, dialog: Boolean, gesture: Boolean, message: Message): Boolean = gesture && (delegate?.onCreateWindow(v, dialog, gesture, message) ?: false)
        override fun onCloseWindow(v: WebView) { delegate?.onCloseWindow(v) }
        override fun onShowFileChooser(v: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean = delegate?.onShowFileChooser(v, callback, params) ?: false
        override fun onJsAlert(v: WebView, url: String?, message: String?, result: JsResult): Boolean = delegate?.onJsAlert(v, url, message, result) ?: false
        override fun onJsConfirm(v: WebView, url: String?, message: String?, result: JsResult): Boolean = delegate?.onJsConfirm(v, url, message, result) ?: false
        override fun onJsPrompt(v: WebView, url: String?, message: String?, value: String?, result: JsPromptResult): Boolean = delegate?.onJsPrompt(v, url, message, value, result) ?: false
        override fun onPermissionRequest(request: PermissionRequest) {
          val allowed = try { camera && script.isNotEmpty() && origin(request.origin.toString()) == origin(allowedOrigin) && request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE } } catch (_: Exception) { false }
          if (allowed) delegate?.onPermissionRequest(request) ?: request.deny() else request.deny()
        }
      }
      // Every WebView, bridge or not, runs the one-shot storage reset before DSM's own scripts
      if (resetScript.isNotEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        origin(allowedOrigin)
        resetScripts[viewId] = WebViewCompat.addDocumentStartJavaScript(view, resetScript, setOf(allowedOrigin))
      }
      if (script.isEmpty()) return@AsyncFunction true
      origin(allowedOrigin) // validate before passing origin rules to WebView
      var lastTouch = Long.MIN_VALUE / 2
      view.setOnTouchListener { _, event -> if (event.action == MotionEvent.ACTION_UP) lastTouch = android.os.SystemClock.elapsedRealtime(); false }
      WebViewCompat.addWebMessageListener(view, "SynoPkgTransport", setOf(allowedOrigin)) { _, message, sourceOrigin, isMainFrame, _ ->
        if (isMainFrame && CertificatePins.acceptsCertificate(allowedOrigin, view.certificate) && origin(sourceOrigin.toString()) == origin(allowedOrigin) && view.url?.let { try { origin(it) == origin(allowedOrigin) } catch (_: Exception) { false } } == true) {
          val data = message.data ?: ""
          // Maximum base64 payload plus bounded envelope; never log message content
          if (data.length <= 70 * 1024 * 1024) sendEvent("onBridgeMessage", mapOf("data" to data, "origin" to allowedOrigin, "viewId" to viewId, "userActivated" to (android.os.SystemClock.elapsedRealtime() - lastTouch < 1000)))
        }
      }
      bound[viewId] = view
      scripts[viewId] = WebViewCompat.addDocumentStartJavaScript(view, script, setOf(allowedOrigin))
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("unbindBridge") { viewId: Int -> detach(viewId) }.runOnQueue(Queues.MAIN)
    // Experimental mobile fit: a document-start script for one origin, with no
    // message listener, so the page gets no transport. Call after bindBridge.
    AsyncFunction("bindFit") { viewId: Int, allowedOrigin: String, script: String ->
      val view = webViews().find { it.id == viewId || (it.parent as? View)?.id == viewId } ?: return@AsyncFunction false
      if (script.isEmpty() || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return@AsyncFunction false
      origin(allowedOrigin) // validate before passing origin rules to WebView
      fits.remove(viewId)?.remove()
      fits[viewId] = WebViewCompat.addDocumentStartJavaScript(view, script, setOf(allowedOrigin))
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("zeroWebViewInsets") {
      val views = webViews()
      val zero = WindowInsetsCompat.Builder().build().toWindowInsets()
      for (v in views) {
        // Edge-to-edge windows are not resized for the IME. Report where the keyboard
        // starts (window dp, -1 when hidden) so the shell can shrink the page above it.
        var lastTop = Float.NaN
        v.setOnApplyWindowInsetsListener { view, insets ->
          val ime = WindowInsetsCompat.toWindowInsetsCompat(insets, view).getInsets(WindowInsetsCompat.Type.ime()).bottom
          val root = view.rootView.height
          val top = if (ime > 0 && root > ime) (root - ime) / view.resources.displayMetrics.density else -1f
          if (top != lastTop) { lastTop = top; sendEvent("onKeyboard", mapOf("top" to top.toDouble())) }
          view.onApplyWindowInsets(zero)
        }
        v.requestApplyInsets()
      }
      views.size
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("takePendingIntake") { intake(appContext.currentActivity?.intent) }.runOnQueue(Queues.MAIN)
    OnNewIntent { intent -> sendEvent("onIntake", intake(intent)) }
    OnDestroy { bound.keys.toList().forEach { detach(it) }; io.shutdown(); discoveryIo.shutdown(); iconIo.shutdown() }

    AsyncFunction("download") { url: String, allowedOrigin: String, filename: String, id: String, promise: Promise ->
      val key = origin(allowedOrigin)
      val epoch = sessionEpoch[key] ?: 0L
      io.execute {
        var file: File? = null
        try {
          val directory = File(appContext.reactContext!!.cacheDir, "downloads/${UUID.randomUUID()}")
          directory.mkdirs()
          file = File(directory, downloadFilename(filename))
          sendEvent("onTransfer", mapOf("id" to id, "received" to 0L, "total" to -1L))
          var next = url
          var complete = false
          for (hop in 0..10) {
            require(origin(next) == origin(allowedOrigin)) { "Cross-origin download refused" }
            require((sessionEpoch[key] ?: 0L) == epoch) { "Session changed" }
            val connection = URI(next).toURL().openConnection() as HttpURLConnection
            CertificatePins.configure(connection)
            connection.instanceFollowRedirects = false
            // No wall-clock request timeout; the native worker streams in-process
            val cookie = CookieManager.getInstance().getCookie(next)
            if (!cookie.isNullOrEmpty()) connection.setRequestProperty("Cookie", cookie)
            try {
              val code = connection.responseCode
              storeCookies(connection, next, key, epoch)
              if (code in listOf(301, 302, 303, 307, 308)) {
                next = URI(next).resolve(connection.getHeaderField("Location") ?: error("Missing redirect")).toString()
                continue
              }
              require(code in 200..299) { "Download failed" }
              val total = connection.contentLengthLong
              var received = 0L
              var last = 0L
              connection.inputStream.use { input -> file.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                  val n = input.read(buffer)
                  if (n < 0) break
                  output.write(buffer, 0, n); received += n
                  val now = android.os.SystemClock.elapsedRealtime()
                  if (now - last >= 250) { sendEvent("onTransfer", mapOf("id" to id, "received" to received, "total" to total)); last = now }
                }
              } }
              sendEvent("onTransfer", mapOf("id" to id, "received" to received, "total" to total))
              complete = true
              break
            } finally { connection.disconnect() }
          }
          require(complete) { "Too many redirects" }
          CookieManager.getInstance().flush()
          promise.resolve(Uri.fromFile(file).toString())
        } catch (_: Exception) { file?.delete(); promise.reject("DOWNLOAD_FAILED", "Download failed", null) }
      }
    }
    AsyncFunction("saveToDownloads") { uri: String, filename: String, mime: String, promise: Promise ->
      io.execute {
        var destination: Uri? = null
        try {
          require(Build.VERSION.SDK_INT >= 29) { "Save requires Android 10" }
          val file = File(URI(uri)).canonicalFile
          val cache = File(appContext.reactContext!!.cacheDir, "downloads").canonicalFile
          require(file.path.startsWith(cache.path + File.separator)) { "Invalid download" }
          val resolver = appContext.reactContext!!.contentResolver
          val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, downloadFilename(filename))
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
          destination = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Cannot save")
          resolver.openOutputStream(destination)!!.use { output -> file.inputStream().use { it.copyTo(output) } }
          values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(destination, values, null, null)
          promise.resolve(null)
        } catch (_: Exception) {
          destination?.let { appContext.reactContext?.contentResolver?.delete(it, null, null) }
          promise.reject("SAVE_FAILED", "Save failed", null)
        }
      }
    }
  }
}
