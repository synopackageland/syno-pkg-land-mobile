package expo.modules.webviewcookies

import org.junit.Assert.*
import org.junit.Test

class AuthExchangeTest {
  private val url = "https://nas.example.com:5001/webapi/entry.cgi"
  private val now: (Runnable) -> Unit = { it.run() }

  @Test fun writesEveryAuthCookieIntoTheJarBeforeReportingReady() {
    val jar = mutableListOf<String>()
    var ready: Boolean? = null
    AuthExchange.commit(url, listOf("id=session; path=/; HttpOnly", "did=device; Max-Age=31536000; path=/; HttpOnly"), { true }, { ready = it },
      store = { target, cookie, done -> assertEquals(url, target); jar.add(cookie.substringBefore(';')); done(true) }, post = now)
    assertEquals(listOf("id=session", "did=device"), jar)
    assertEquals(true, ready)
  }
  @Test fun aRejectedCookieOrAStaleSessionNeverReportsSuccess() {
    var ready: Boolean? = null
    AuthExchange.commit(url, listOf("id=a", "did=b"), { true }, { ready = it }, store = { _, cookie, done -> done(!cookie.startsWith("did")) }, post = now)
    assertEquals(false, ready)
    ready = null
    AuthExchange.commit(url, listOf("id=a"), { false }, { ready = it }, store = { _, _, _ -> fail("Stale exchange wrote a cookie") }, post = now)
    assertNull(ready)
  }
  @Test fun signOutKeepsTheTrustedDeviceCookieAndRemovalExpiresIt() {
    val names = listOf("id", "did", "_SSID", "stay_login", "did", "")
    assertEquals(listOf("id", "_SSID", "stay_login"), cookiesToExpire(names, keepDevice = true))
    assertEquals(listOf("id", "did", "_SSID", "stay_login"), cookiesToExpire(names, keepDevice = false))
  }
  @Test fun theNativeFormBodyPassesTheSameAuthLoginGuard() {
    val origin = "https://nas.example.com:5001"
    val body = "api=SYNO.API.Auth&version=6&method=login&session=webui&format=cookie&account=alice&passwd=p%26ss&enable_device_token=yes"
    assertEquals(body, SignInRequest.parse(origin, "$origin/webapi/entry.cgi", body, emptyMap()).body)
    try { SignInRequest.parse(origin, "$origin/webapi/entry.cgi", "api=SYNO.API.Auth&method=logout", emptyMap()); fail("Logout accepted") } catch (_: IllegalArgumentException) {}
  }

  @Test fun webStorageOriginMatchesWebViewOrigins() {
    assertEquals("https://10.0.0.2:5001", webStorageOrigin("https://10.0.0.2:5001"))
    assertEquals("https://nas.example", webStorageOrigin("https://NAS.example:443/webapi/entry.cgi"))
    assertEquals("http://nas.example", webStorageOrigin("http://nas.example"))
  }
}
