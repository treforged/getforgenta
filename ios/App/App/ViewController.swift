import UIKit
import Capacitor
import WebKit

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AuthSessionPlugin())
        bridge?.webView?.navigationDelegate = self
    }
}

// MARK: - WKNavigationDelegate

extension ViewController: WKNavigationDelegate {
    /// Called when the WKWebView content process is killed by iOS (memory pressure,
    /// long background, etc.). Without a reload the view stays blank permanently.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
        (UIApplication.shared.delegate as? AppDelegate)?.handleWebViewProcessTerminated()
    }
}
