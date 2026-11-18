package expo.modules.webviewcookies

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest

internal data class SignInRequest(val url: String, val body: String, val headers: Map<String, String>) {
  companion object {
    private fun origin(uri: URI): String {
      require(uri.scheme in listOf("http", "https") && uri.host != null && uri.rawUserInfo == null)
      return "${uri.scheme}://${uri.host.lowercase()}:${if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80}"
    }
    private fun fields(value: String): Map<String, String> {
      val result = mutableMapOf<String, String>()
      for (pair in value.split('&').filter { it.isNotEmpty() }) {
        val key = URLDecoder.decode(pair.substringBefore('='), "UTF-8")
        require(!result.containsKey(key)) { "Duplicate parameter" }
        result[key] = URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8")
      }
      return result
    }
    fun parse(allowedOrigin: String, url: String, body: String, headers: Map<String, String>): SignInRequest {
      require(url.length <= 4096 && body.toByteArray().size <= 65536)
      val uri = URI(url)
      require(origin(uri) == origin(URI(allowedOrigin)) && uri.fragment == null)
      require(uri.path.startsWith("/webapi/") && uri.normalize().path == uri.path && '%' !in uri.rawPath)
      require(uri.path.split('/').none { it == "." || it == ".." })
      val query = fields(uri.rawQuery ?: "")
      val data = fields(body)
      require((data["api"] ?: query["api"]) == "SYNO.API.Auth" && data["method"] == "login")
      require(query["api"] == null || query["api"] == "SYNO.API.Auth")
      require(query["method"] == null || query["method"] == "login")
      val safe = headers.filterKeys { it.lowercase() in listOf("content-type", "accept", "x-requested-with") }
      require(safe.size <= 3 && safe.all { (key, value) -> key.length + value.length <= 1024 && !value.contains('\r') && !value.contains('\n') })
      return SignInRequest(url, body, safe)
    }
  }
}

internal fun sessionFingerprint(cookie: String): String {
  val id = cookie.split(';').map { it.trim() }.find { it.startsWith("id=") }?.substringAfter('=') ?: ""
  return if (id.isEmpty()) "" else MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).joinToString("") { "%02x".format(it) }
}

internal class SignInCompletion(private val epoch: Long) {
  private var done = false
  @Synchronized fun complete(success: Boolean, scope: String, currentEpoch: Long, cookiesReady: Boolean = true): Boolean {
    if (done || !success || !cookiesReady || scope.isEmpty() || epoch != currentEpoch) return false
    done = true
    return true
  }
}
