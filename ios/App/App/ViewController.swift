import UIKit
import Capacitor
import WebKit

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AuthSessionPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        // Was missing until 2026-09-29: an in-app plugin is NOT auto-registered, so every NativeGlass
        // call rejected "not implemented" and useSimGlassExperiment swallowed it (8a202850).
        bridge?.registerPluginInstance(GlassEffectPlugin())
        bridge?.webView?.navigationDelegate = self
        #if DEBUG
        injectSimulatorSessionIfPresent()
        scheduleSimulatorPageProbeIfAsked()
        #endif
    }

    #if DEBUG
    /// CI ONLY (ios-sim-screenshots.yml). simctl cannot tap, so the simulator job signs the
    /// TEST account in by handing this Debug build a session through the launch environment
    /// (`SIMCTL_CHILD_FORGENTA_SIM_SESSION_KEY` / `..._B64`), written to localStorage before the
    /// page's own scripts run. Compiled out of Release, which is what TestFlight and the stores
    /// get (SWIFT_ACTIVE_COMPILATION_CONDITIONS is "" there), and a user cannot set a launch
    /// environment on a device. Both strings are JSON-encoded, so neither can break out of the
    /// script literal, and the write happens only on the app's own origin.
    private func injectSimulatorSessionIfPresent() {
        let env = ProcessInfo.processInfo.environment
        // Experiment flags (e.g. the native glass strip, 8a202850): comma-separated keys, each set
        // to "1". Only keys under "forgenta:sim-" are accepted, so this can switch on nothing else.
        let flags = (env["FORGENTA_SIM_FLAGS"] ?? "")
            .split(separator: ",").map(String.init).filter { $0.hasPrefix("forgenta:sim-") }
        for flag in flags {
            addLocalStorageScript(key: flag, value: "1")
        }
        guard
            let key = env["FORGENTA_SIM_SESSION_KEY"],
            let b64 = env["FORGENTA_SIM_SESSION_B64"],
            let data = Data(base64Encoded: b64),
            let value = String(data: data, encoding: .utf8)
        else { return }
        if addLocalStorageScript(key: key, value: value) {
            NSLog("FORGENTA_SIM_SESSION: injected for key length \(key.count)")
        }
    }

    /// CI ONLY: when the sim job sets FORGENTA_SIM_PAGE_PROBE=1, log the page path and the first
    /// 200 characters of visible text at 20 s and 50 s, so a black frame can be told apart from
    /// "Authenticating..." or "Loading your setup..." hidden under a system alert (e7d28de3).
    /// The only account this ever runs on is the @forgenta.test walk account.
    private func scheduleSimulatorPageProbeIfAsked() {
        guard ProcessInfo.processInfo.environment["FORGENTA_SIM_PAGE_PROBE"] == "1" else { return }
        for delay in [3.0, 8.0, 20.0, 50.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                let js = "JSON.stringify({p: location.pathname, t: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)})"
                self?.bridge?.webView?.evaluateJavaScript(js) { result, error in
                    let text = (result as? String) ?? "error: \(error.map { String(describing: $0) } ?? "nil")"
                    NSLog("FORGENTA_PAGE_PROBE t=%.0f %@", delay, text)
                }
            }
        }
    }

    @discardableResult
    private func addLocalStorageScript(key: String, value: String) -> Bool {
        guard
            let keyLit = try? JSONEncoder().encode(key), let keyJs = String(data: keyLit, encoding: .utf8),
            let valLit = try? JSONEncoder().encode(value), let valJs = String(data: valLit, encoding: .utf8)
        else { return false }
        let source = "if(location.origin==='https://getforgenta.com'){try{localStorage.setItem(\(keyJs),\(valJs))}catch(e){}}"
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        bridge?.webView?.configuration.userContentController.addUserScript(script)
        return true
    }
    #endif
}

// MARK: - WKNavigationDelegate

extension ViewController: WKNavigationDelegate {
    /// Called when the WKWebView content process is killed by iOS (memory pressure,
    /// long background, etc.). Without a reload the view stays blank permanently.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        #if DEBUG
        NSLog("FORGENTA_NAV processTerminated url=%@", webView.url?.absoluteString ?? "nil")
        #endif
        webView.reload()
        (UIApplication.shared.delegate as? AppDelegate)?.handleWebViewProcessTerminated()
    }

    #if DEBUG
    // CI ONLY (e7d28de3): the navigation timeline, so a WebView found on about:blank can be traced
    // to what sent it there. Logs only the path, never a query string or fragment.
    private func navLog(_ what: String, _ webView: WKWebView, _ error: Error? = nil) {
        let u = webView.url
        NSLog("FORGENTA_NAV %@ %@%@ %@", what, u?.scheme ?? "nil", u.map { ":" + $0.path } ?? "", error.map { String(describing: $0) } ?? "")
    }
    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { navLog("start", webView) }
    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { navLog("commit", webView) }
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { navLog("finish", webView) }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navLog("fail", webView, error) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navLog("failProvisional", webView, error) }
    #endif
}
