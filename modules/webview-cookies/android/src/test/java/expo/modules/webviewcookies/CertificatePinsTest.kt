package expo.modules.webviewcookies

import org.junit.Assert.*
import org.junit.After
import org.junit.Test
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import javax.net.ssl.HttpsURLConnection

class CertificatePinsTest {
  private val der = CertificateFactory.getInstance("X.509").generateCertificate(javaClass.getResourceAsStream("/qr-leaf.pem")!!).encoded
  private val pin = MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }
  @After fun clear() { CertificatePins.replace(emptyList()) }
  @Test fun trustsOnlyReviewedLeafAndCompleteOrigin() {
    CertificatePins.replace(listOf(mapOf("origin" to "https://nas.example:5001", "sha256" to pin)))
    assertTrue(CertificatePins.acceptsLeaf("https://nas.example:5001/webman/", der))
    assertFalse(CertificatePins.acceptsLeaf("https://other.example:5001", der))
    assertFalse(CertificatePins.acceptsLeaf("https://nas.example:443", der))
    assertFalse(CertificatePins.acceptsLeaf("http://nas.example:5001", der))
    assertFalse(CertificatePins.acceptsLeaf("https://nas.example:5001", der + byteArrayOf(0)))
  }
  @Test fun replacingAndRemovingPinsRevokesPreviousTrust() {
    CertificatePins.replace(listOf(mapOf("origin" to "https://nas.example", "sha256" to pin)))
    assertTrue(CertificatePins.acceptsLeaf("https://NAS.example:443", der))
    CertificatePins.replace(listOf(mapOf("origin" to "https://nas.example", "sha256" to "a".repeat(64))))
    assertFalse(CertificatePins.acceptsLeaf("https://nas.example", der))
    CertificatePins.replace(emptyList())
    assertFalse(CertificatePins.acceptsLeaf("https://nas.example", der))
  }
  @Test fun exceptionsAreConnectionScopedAndNeverChangeGlobalTlsDefaults() {
    val factory = HttpsURLConnection.getDefaultSSLSocketFactory()
    val verifier = HttpsURLConnection.getDefaultHostnameVerifier()
    CertificatePins.replace(listOf(mapOf("origin" to "https://nas.example:5001", "sha256" to pin)))
    val scoped = URL("https://nas.example:5001").openConnection() as HttpsURLConnection
    val other = URL("https://other.example:5001").openConnection() as HttpsURLConnection
    CertificatePins.configure(scoped); CertificatePins.configure(other)
    assertNotSame(factory, scoped.sslSocketFactory)
    assertSame(factory, other.sslSocketFactory)
    assertSame(factory, HttpsURLConnection.getDefaultSSLSocketFactory())
    assertSame(verifier, HttpsURLConnection.getDefaultHostnameVerifier())
  }
  @Test(expected = IllegalArgumentException::class) fun refusesHttpPin() {
    CertificatePins.replace(listOf(mapOf("origin" to "http://nas.example", "sha256" to pin)))
  }
}
