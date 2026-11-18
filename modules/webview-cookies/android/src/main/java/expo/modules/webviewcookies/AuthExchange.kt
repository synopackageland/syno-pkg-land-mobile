package expo.modules.webviewcookies

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.CountDownLatch

/**
 * One Auth.login POST on a fresh HTTP/1.1 connection: pinned leaf, no redirects,
 * no caches, bodies in memory only. The WebView's shared HTTP/2 Auth stream can stall.
 */
internal object AuthExchange {
  class Reply(val status: Int, val body: ByteArray, val cookies: List<String>) {
    val success get() = status == 200 && try { org.json.JSONObject(body.toString(Charsets.UTF_8)).opt("success") == true } catch (_: Exception) { false }
  }
  private val main by lazy { Handler(Looper.getMainLooper()) }

  fun post(request: SignInRequest, userAgent: String, attach: (HttpURLConnection) -> Unit, current: () -> Boolean): Reply {
    val connection = URI(request.url).toURL().openConnection() as HttpURLConnection
    attach(connection)
    try {
      CertificatePins.configure(connection)
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.requestMethod = "POST"
      connection.setRequestProperty("Connection", "close")
      connection.setRequestProperty("User-Agent", userAgent)
      connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
      request.headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
      // The jar carries DSM's did cookie, so a trusted phone skips the code step
      CookieManager.getInstance().getCookie(request.url)?.let { connection.setRequestProperty("Cookie", it) }
      require(current())
      connection.doOutput = true
      connection.outputStream.use { it.write(request.body.toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      // Authentication never follows a redirect with credentials
      require(status !in 300..399)
      val input = if (status < 400) connection.inputStream else connection.errorStream
      val body = input?.use {
        val bytes = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (bytes.size() <= 1024 * 1024) {
          val count = it.read(buffer, 0, minOf(buffer.size, 1024 * 1024 + 1 - bytes.size()))
          if (count < 0) break
          bytes.write(buffer, 0, count)
        }
        bytes.toByteArray()
      } ?: byteArrayOf()
      require(body.size <= 1024 * 1024 && current())
      val cookies = connection.headerFields.entries.filter { it.key?.equals("Set-Cookie", true) == true }.flatMap { it.value }
      return Reply(status, body, cookies)
    } finally { connection.disconnect() }
  }

  /** Writes Set-Cookie values and waits for every cookie-store callback, never a disk flush or a deadline */
  fun commit(
    url: String, cookies: List<String>, current: () -> Boolean, ready: (accepted: Boolean) -> Unit,
    store: (String, String, (Boolean) -> Unit) -> Unit = { target, cookie, done -> CookieManager.getInstance().setCookie(target, cookie) { done(it) } },
    post: (Runnable) -> Unit = { main.post(it) }
  ) {
    val committed = CountDownLatch(1)
    post(Runnable {
      if (!current()) { committed.countDown(); return@Runnable }
      var remaining = cookies.size
      var accepted = true
      fun done() { if (current()) ready(accepted); committed.countDown() }
      if (remaining == 0) done()
      else cookies.forEach { cookie -> store(url, cookie) { ok -> accepted = accepted && ok; if (--remaining == 0) done() } }
    })
    committed.await()
  }
}

/** Cookie names a local sign-out expires; DSM's device token survives unless the NAS is removed */
internal fun cookiesToExpire(names: Collection<String>, keepDevice: Boolean): List<String> =
  names.filter { it.isNotEmpty() && !(keepDevice && it == "did") }.distinct()

/**
 * Web-storage origin of a NAS URL. A sign-out or a new sign-in drops the previous user's
 * IndexedDB and other quota-managed data for that origin. WebView's deleteOrigin does
 * not clear localStorage, where DSM's page keeps its resume data; see storageResetScript.
 */
internal fun webStorageOrigin(url: String): String {
  val u = URI(url)
  val scheme = u.scheme.lowercase()
  val implicit = u.port < 0 || (scheme == "https" && u.port == 443) || (scheme == "http" && u.port == 80)
  return "$scheme://${u.host.lowercase()}" + if (implicit) "" else ":${u.port}"
}

/** Queued on the main thread ahead of any later cookie write for the same origin */
internal fun clearWebStorage(url: String) {
  val origin = webStorageOrigin(url)
  Handler(Looper.getMainLooper()).post { android.webkit.WebStorage.getInstance().deleteOrigin(origin) }
}
