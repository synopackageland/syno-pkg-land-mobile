package expo.modules.webviewcookies

import android.net.http.SslError
import android.net.http.SslCertificate
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Explicit leaf exceptions, scoped to a complete origin; never a global trust-all manager */
object CertificatePins {
  @Volatile private var pins = emptyMap<String, String>()
  private fun origin(value: String): String {
    val uri = URI(value)
    require(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null)
    return "https://${uri.host.lowercase()}:${if (uri.port < 0) 443 else uri.port}"
  }
  fun replace(values: List<Map<String, String>>) {
    val next = values.associate { item ->
      val pin = item["sha256"] ?: error("Missing pin")
      require(pin.matches(Regex("[a-f0-9]{64}")))
      origin(item["origin"] ?: error("Missing origin")) to pin
    }
    pins = next
  }
  fun matches(der: ByteArray, pin: String): Boolean = MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) } == pin
  fun acceptsCertificate(url: String, certificate: SslCertificate?): Boolean = try {
    if (!pins.containsKey(origin(url))) true else {
      val der = certificate?.let { SslCertificate.saveState(it).getByteArray("x509-certificate") }
      der != null && acceptsLeaf(url, der)
    }
  } catch (_: Exception) { !url.startsWith("https:") }
  fun accepts(error: SslError): Boolean = try {
    val der = SslCertificate.saveState(error.certificate).getByteArray("x509-certificate")
    der != null && acceptsLeaf(error.url, der)
  } catch (_: Exception) { false }
  fun acceptsLeaf(url: String, der: ByteArray): Boolean = try {
    val pin = pins[origin(url)]
    if (pin == null || !matches(der, pin)) false else {
      val cert = CertificateFactory.getInstance("X.509").generateCertificate(der.inputStream()) as X509Certificate
      cert.checkValidity()
      true
    }
  } catch (_: Exception) { false }
  fun configure(connection: HttpURLConnection) {
    if (connection !is HttpsURLConnection) return
    val pin = pins[origin(connection.url.toString())] ?: return
    val manager = object : X509TrustManager {
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { error("Client certificates unsupported") }
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        require(chain.isNotEmpty() && matches(chain[0].encoded, pin)) { "Certificate changed" }
        chain[0].checkValidity()
      }
    }
    val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(manager), null) }
    connection.sslSocketFactory = context.socketFactory
    // A scanned NAS certificate may use a different DNS name. Only the exact
    // reviewed leaf at this origin can bypass the platform hostname check.
    connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, session ->
      try { matches(session.peerCertificates[0].encoded, pin) } catch (_: Exception) { false }
    }
  }
}
