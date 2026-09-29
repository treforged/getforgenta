import UIKit
import Capacitor
import WebKit

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AuthSessionPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.webView?.navigationDelegate = self
        #if DEBUG
        injectSimulatorSessionIfPresent()
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
        webView.reload()
        (UIApplication.shared.delegate as? AppDelegate)?.handleWebViewProcessTerminated()
    }
}
