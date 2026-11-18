package expo.modules.webviewcookies

import org.junit.Assert.*
import org.junit.Test

class SignInRequestTest {
  private val origin = "https://nas.example.com:5001"
  private val url = "$origin/webapi/entry.cgi?api=SYNO.API.Auth"
  private val body = "api=SYNO.API.Auth&version=7&method=login&session=webui&__cIpHeRtExT=encrypted"

  @Test fun acceptsOnlyTheSameOriginAuthLogin() {
    assertEquals(url, SignInRequest.parse(origin, url, body, emptyMap()).url)
    for ((target, data) in listOf(
      "https://other.example.com/webapi/entry.cgi" to body,
      "$origin/webapi/../other" to body,
      "$origin/webapi/%2e%2e/other" to body,
      "$origin/webapi/entry.cgi#fragment" to body,
      "$url&method=logout" to body,
      url to "api=SYNO.API.Auth&method=logout",
      url to "api=SYNO.Core.Package&method=list",
      url to "$body&method=logout"
    )) {
      try { SignInRequest.parse(origin, target, data, emptyMap()); fail("Rejected request accepted") } catch (_: IllegalArgumentException) {}
    }
  }
  @Test fun boundsRequestAndHeadersWithoutChangingEncryptedPayload() {
    val request = SignInRequest.parse(origin, url, body, mapOf("Content-Type" to "application/x-www-form-urlencoded", "Cookie" to "untrusted", "Host" to "other.example.com"))
    assertEquals(body, request.body)
    assertEquals(mapOf("Content-Type" to "application/x-www-form-urlencoded"), request.headers)
    try { SignInRequest.parse(origin, url, "x".repeat(65537), emptyMap()); fail("Oversized body accepted") } catch (_: IllegalArgumentException) {}
  }
  @Test fun wrongPasswordAndTwoFactorChallengesCannotAuthenticateOrReuseAnOldSession() {
    val completion = SignInCompletion(4)
    assertFalse(completion.complete(false, "old-session", 4))
    assertFalse(completion.complete(true, "", 4))
    assertFalse(completion.complete(true, "new-session", 5))
    assertFalse(completion.complete(true, "new-session", 4, false))
    assertTrue(completion.complete(true, "new-session", 4))
    assertFalse(completion.complete(true, "new-session", 4))
  }
  @Test fun onlyTheLoginCookieScopesSnapshots() {
    assertEquals("", sessionFingerprint("_SSID=pre-login; stay_login=1"))
    assertEquals("", sessionFingerprint("id=; did=device"))
    val scope = sessionFingerprint("id=session; did=device")
    assertEquals(64, scope.length)
    assertEquals(scope, sessionFingerprint("id=session; did=another-device"))
    assertNotEquals(scope, sessionFingerprint("id=another-session"))
  }
}
