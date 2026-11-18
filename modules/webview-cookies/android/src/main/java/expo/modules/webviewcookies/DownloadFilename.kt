package expo.modules.webviewcookies

/** Apply at every native filename sink, including calls that bypass TypeScript. */
internal fun downloadFilename(name: String): String {
  val value = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").take(120)
  return if (value.isBlank() || value == "." || value == "..") "download" else value
}
