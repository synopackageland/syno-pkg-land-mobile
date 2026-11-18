package expo.modules.webviewcookies

import android.net.http.X509TrustManagerExtensions
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** Stable, page-free failure causes shared by probes, discovery and downloads */
internal fun networkCause(error: Throwable): String {
  var current: Throwable? = error
  while (current != null) {
    when (current) {
      is UnknownHostException -> return "dns"
      is ConnectException -> return "refused"
      is NoRouteToHostException -> return "unreachable"
      is SocketTimeoutException -> return "timeout"
      is CertificateException -> return "certificate"
      is SSLHandshakeException -> return if (current.cause is CertificateException || current.message?.contains("ertificate") == true) "certificate" else "tls"
      is SSLException -> return "tls"
    }
    current = current.cause
  }
  return if (error is IOException) "network" else "failed"
}

/**
 * Pre-sign-in DSM probe. It sends no cookies or credentials, reads a bounded
 * public response and reports the presented leaf so the user can decide trust.
 * Accepting any leaf here never changes WebView, discovery or download trust.
 */
object NasProbe {
  private val pool = Executors.newCachedThreadPool()
  private val active = ConcurrentHashMap<String, MutableSet<HttpURLConnection>>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  private val system: X509TrustManager by lazy {
    TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(null as KeyStore?) }
      .trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  fun sha256(der: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

  private class Capture(private val host: String) : X509TrustManager {
    var chain: Array<X509Certificate>? = null
    var chainTrusted = false
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { error("Client certificates unsupported") }
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
      this.chain = chain
      chainTrusted = try { X509TrustManagerExtensions(system).checkServerTrusted(chain, authType, host); true } catch (_: Exception) { false }
    }
  }

  fun cancel(id: String) {
    cancelled.add(id)
    active.remove(id)?.forEach { try { it.disconnect() } catch (_: Exception) {} }
  }

  fun release(id: String) { cancelled.remove(id); active.remove(id) }

  fun run(url: String, id: String, done: (Map<String, Any?>) -> Unit) {
    pool.execute { done(probe(url, id)) }
  }

  private fun probe(url: String, id: String): Map<String, Any?> {
    val uri = try { URI(url) } catch (_: Exception) { return mapOf("error" to "invalid") }
    if ((uri.scheme != "http" && uri.scheme != "https") || uri.host == null || uri.rawUserInfo != null) return mapOf("error" to "invalid")
    if (cancelled.contains(id)) return mapOf("error" to "cancelled")
    val connection = try { uri.toURL().openConnection() as HttpURLConnection } catch (_: Exception) { return mapOf("error" to "invalid") }
    val capture = Capture(uri.host)
    var hostnameMatch = false
    if (connection is HttpsURLConnection) {
      connection.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(capture), null) }.socketFactory
      connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { host, session ->
        hostnameMatch = try { HttpsURLConnection.getDefaultHostnameVerifier().verify(host, session) } catch (_: Exception) { false }
        true
      }
    }
    // No wall-clock limit: a waking NAS answers late and the user can cancel.
    connection.instanceFollowRedirects = false
    connection.useCaches = false
    connection.setRequestProperty("Accept", "application/json, text/html")
    active.getOrPut(id) { ConcurrentHashMap.newKeySet() }.add(connection)
    return try {
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      val bytes = stream?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (output.size() < 256 * 1024) {
          val count = input.read(buffer, 0, minOf(buffer.size, 256 * 1024 - output.size()))
          if (count < 0) break
          output.write(buffer, 0, count)
        }
        output.toByteArray()
      } ?: byteArrayOf()
      mapOf("status" to code, "body" to bytes.toString(Charsets.UTF_8), "location" to connection.getHeaderField("Location"), "tls" to tls(capture, hostnameMatch))
    } catch (error: Exception) {
      mapOf("error" to if (cancelled.contains(id)) "cancelled" else networkCause(error), "tls" to tls(capture, hostnameMatch))
    } finally {
      active[id]?.remove(connection)
      try { connection.disconnect() } catch (_: Exception) {}
    }
  }

  private fun tls(capture: Capture, hostnameMatch: Boolean): Map<String, Any?>? {
    val leaf = capture.chain?.firstOrNull() ?: return null
    val now = System.currentTimeMillis()
    return mapOf(
      "sha256" to sha256(leaf.encoded),
      "trusted" to (capture.chainTrusted && hostnameMatch),
      "chainTrusted" to capture.chainTrusted,
      "hostnameMatch" to hostnameMatch,
      "selfSigned" to (leaf.subjectX500Principal == leaf.issuerX500Principal || capture.chain!!.size == 1),
      "expired" to (now > leaf.notAfter.time || now < leaf.notBefore.time),
      "subject" to leaf.subjectX500Principal.name,
      "issuer" to leaf.issuerX500Principal.name,
      "notAfter" to leaf.notAfter.time.toDouble(),
    )
  }
}
