package expo.modules.webviewcookies

import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Message
import android.view.KeyEvent
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

/** Preserve the RN client and distinguish subframes before RN discards isForMainFrame */
class ScopedWebViewClient(
  private val delegate: WebViewClient,
  private val document: (String) -> Unit,
  private val intercept: (WebResourceRequest) -> WebResourceResponse? = { null }
) : WebViewClient() {
  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    if (!request.isForMainFrame) return request.url.scheme !in listOf("http", "https", "about", "blob", "data")
    return delegate.shouldOverrideUrlLoading(view, request)
  }
  @Suppress("DEPRECATION")
  override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = delegate.shouldOverrideUrlLoading(view, url)
  override fun onPageStarted(view: WebView, url: String?, icon: Bitmap?) { document("start"); delegate.onPageStarted(view, url, icon) }
  private fun checked(view: WebView, url: String?): Boolean {
    if (url == null || CertificatePins.acceptsCertificate(url, view.certificate)) return true
    view.stopLoading()
    // Trusted replacements do not trigger onReceivedSslError. Check the actual
    // committed document leaf as well, and use the existing RN failure UI.
    @Suppress("DEPRECATION")
    delegate.onReceivedError(view, ERROR_FAILED_SSL_HANDSHAKE, "Untrusted certificate", url)
    return false
  }
  override fun onPageFinished(view: WebView, url: String?) { if (checked(view, url)) delegate.onPageFinished(view, url) }
  override fun onPageCommitVisible(view: WebView, url: String?) { if (checked(view, url)) { document("visible"); delegate.onPageCommitVisible(view, url) } }
  override fun onLoadResource(view: WebView, url: String?) { delegate.onLoadResource(view, url) }
  override fun doUpdateVisitedHistory(view: WebView, url: String?, reload: Boolean) { delegate.doUpdateVisitedHistory(view, url, reload) }
  override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = intercept(request) ?: delegate.shouldInterceptRequest(view, request)
  @Suppress("DEPRECATION")
  override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? = delegate.shouldInterceptRequest(view, url)
  override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { delegate.onReceivedError(view, request, error) }
  @Suppress("DEPRECATION")
  override fun onReceivedError(view: WebView, code: Int, description: String?, url: String?) { delegate.onReceivedError(view, code, description, url) }
  override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) { delegate.onReceivedHttpError(view, request, response) }
  override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { if (CertificatePins.accepts(error)) handler.proceed() else delegate.onReceivedSslError(view, handler, error) }
  override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) { delegate.onReceivedClientCertRequest(view, request) }
  override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String?, realm: String?) { delegate.onReceivedHttpAuthRequest(view, handler, host, realm) }
  override fun onFormResubmission(view: WebView, dontResend: Message, resend: Message) { delegate.onFormResubmission(view, dontResend, resend) }
  override fun onScaleChanged(view: WebView, oldScale: Float, newScale: Float) { delegate.onScaleChanged(view, oldScale, newScale) }
  override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean = delegate.shouldOverrideKeyEvent(view, event)
  override fun onUnhandledKeyEvent(view: WebView, event: KeyEvent) { delegate.onUnhandledKeyEvent(view, event) }
  override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean = delegate.onRenderProcessGone(view, detail)
  override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threat: Int, response: SafeBrowsingResponse) { delegate.onSafeBrowsingHit(view, request, threat, response) }
}
