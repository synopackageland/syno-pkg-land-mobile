package expo.modules.webviewcookies

import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A per-view, main-frame-only Auth transport. DSM owns the form and response.
 * Virtual GETs carry random handles, never credentials, and never reach a NAS.
 */
internal class SignInRelay(
  private val view: WebView,
  private val allowedOrigin: String,
  script: String,
  private val epoch: () -> Long,
  private val authenticated: (String) -> Unit
) {
  private class Pending(val id: String, val request: SignInRequest, val epoch: Long, val document: Long) {
    @Volatile var cancelled = false
    @Volatile var connection: HttpURLConnection? = null
  }
  private val prepared = ConcurrentHashMap<String, Pending>()
  private val active = ConcurrentHashMap<String, Pending>()
  private val prefix = "$allowedOrigin/.synopkg-sign-in/"
  private val userAgent = view.settings.userAgentString
  private val completion = SignInCompletion(epoch())
  @Volatile private var closed = false
  @Volatile private var document = 0L
  private val startScript: ScriptHandler

  init {
    WebViewCompat.addWebMessageListener(view, "SynoPkgSignIn", setOf(allowedOrigin)) { _, message, source, isMainFrame, _ ->
      if (closed || !isMainFrame || source.toString().trimEnd('/') != allowedOrigin || !CertificatePins.acceptsCertificate(allowedOrigin, view.certificate)) return@addWebMessageListener
      val data = message.data ?: return@addWebMessageListener
      if (data.length > 100000) return@addWebMessageListener
      var id = ""
      try {
        val value = JSONObject(data)
        id = value.getString("id")
        require(id.length in 1..128)
        if (value.getString("type") == "cancel") { cancel(id); return@addWebMessageListener }
        require(value.getString("type") == "prepare" && active.size < 4)
        require(view.url?.let { URI(it).let { u -> "${u.scheme}://${u.rawAuthority}" } } == allowedOrigin)
        val headers = value.getJSONObject("headers").let { json -> json.keys().asSequence().associateWith { json.getString(it) } }
        val request = SignInRequest.parse(allowedOrigin, value.getString("url"), value.getString("body"), headers)
        val pending = Pending(id, request, epoch(), document)
        require(active.putIfAbsent(id, pending) == null)
        val handle = UUID.randomUUID().toString()
        prepared[handle] = pending
        reply(id, prefix + handle)
      } catch (_: Exception) { if (id.isNotEmpty()) reply(id, null) }
    }
    startScript = WebViewCompat.addDocumentStartJavaScript(view, script, setOf(allowedOrigin))
  }
  private fun reply(id: String, route: String?) {
    view.evaluateJavascript("if(location.origin===${JSONObject.quote(allowedOrigin)} && window.__synoSignInReady)window.__synoSignInReady(${JSONObject.quote(id)},${route?.let { JSONObject.quote(it) } ?: "null"});true;", null)
  }
  private fun current(pending: Pending) = !closed && !pending.cancelled && pending.document == document && pending.epoch == epoch()
  private fun cancel(id: String) {
    active.remove(id)?.let { pending ->
      pending.cancelled = true
      pending.connection?.disconnect()
      prepared.entries.removeAll { it.value === pending }
    }
  }
  fun documentStarted() {
    document++
    active.keys.toList().forEach(::cancel)
  }
  fun close() {
    closed = true
    active.keys.toList().forEach(::cancel)
    startScript.remove()
    WebViewCompat.removeWebMessageListener(view, "SynoPkgSignIn")
  }
  private fun response(status: Int, body: ByteArray) = WebResourceResponse(
    "application/json", "UTF-8", status, if (status < 400) "OK" else "Request failed",
    mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(body)
  )
  fun intercept(resource: WebResourceRequest): WebResourceResponse? {
    val route = resource.url.toString()
    if (!route.startsWith(prefix)) return null
    val pending = prepared.remove(route.removePrefix(prefix))
    if (pending == null) return response(403, "{}".toByteArray())
    if (resource.method != "GET" || !current(pending)) {
      cancel(pending.id)
      return response(403, "{}".toByteArray())
    }
    val started = SystemClock.elapsedRealtime()
    fun stage(name: String) { Log.i("SynoPkgSignIn", "stage=$name elapsed=${SystemClock.elapsedRealtime() - started}") }
    try {
      stage("request_started")
      val request = pending.request
      val reply = AuthExchange.post(request, userAgent, { pending.connection = it }) { current(pending) }
      stage("response_received")
      var cookiesCommitted = false
      AuthExchange.commit(request.url, reply.cookies, { current(pending) }, ready = { accepted ->
        cookiesCommitted = accepted
        stage("cookies_ready")
        val scope = sessionFingerprint(CookieManager.getInstance().getCookie(allowedOrigin) ?: "")
        if (completion.complete(reply.success, scope, epoch(), accepted)) { stage("authenticated"); authenticated(scope) }
      })
      require(current(pending) && cookiesCommitted)
      return response(reply.status, reply.body)
    } catch (_: Exception) {
      stage("failed")
      return response(502, "{\"success\":false}".toByteArray())
    } finally {
      pending.connection?.disconnect()
      active.remove(pending.id, pending)
    }
  }
}
