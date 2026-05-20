import UIKit
import Capacitor
import AuthenticationServices
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // MARK: - Cover state

    private var nativeCover: UIView?
    private var nativeCoverHideTimer: Timer?

    // Tracks whether we actually entered background (vs brief interruptions like
    // Control Center, Face ID prompts, incoming call banners, etc.)
    private var didEnterBackground = false

    // Set by ViewController when WKWebView content process terminates.
    // Means the WebView needs a full network reload before we reveal it.
    private var webViewProcessTerminated = false

    // Set by AuthSessionPlugin before ASWebAuthenticationSession launches.
    // iOS 13+ does not fire applicationWillResignActive for ASWebAuthenticationSession,
    // so we must show the cover ourselves before the sheet opens.
    private var oAuthSessionPending = false

    // MARK: - Lifecycle

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePhoneLocked),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
        return true
    }

    // Fires for every interruption: background, Control Center, Face ID, call banners,
    // ASWebAuthenticationSession (on older iOS), and system overlays.
    func applicationWillResignActive(_ application: UIApplication) {
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = nil
        showNativeCover()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        didEnterBackground = true
    }

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        defer {
            didEnterBackground = false
            webViewProcessTerminated = false
        }

        if oAuthSessionPending {
            // OAuth sheet just closed. React will fire SIGNED_IN and navigate —
            // give it 2 s to complete before revealing the WebView.
            oAuthSessionPending = false
            scheduleNativeCoverDismiss(after: 2.0)

        } else if !didEnterBackground {
            // Brief interruption (Control Center, Face ID, call banner, etc.).
            // WebView did not suspend; dismiss the cover quickly.
            scheduleNativeCoverDismiss(after: 0.3)

        } else if webViewProcessTerminated {
            // Content process was killed; WebView is reloading from network.
            // Poll document.readyState — allow up to 10 s for the reload.
            pollWebViewReady(maxAttempts: 50)   // 50 × 200 ms = 10 s

        } else {
            // Normal background → foreground. Poll until WebView is repainted.
            // Typically resolves on the first poll (< 200 ms).
            pollWebViewReady(maxAttempts: 20)   // 20 × 200 ms = 4 s
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Called by ViewController

    /// ViewController calls this when WKWebView content process terminates.
    func handleWebViewProcessTerminated() {
        webViewProcessTerminated = true
    }

    // MARK: - Called by AuthSessionPlugin

    /// Call BEFORE launching ASWebAuthenticationSession.
    /// Shows the privacy cover immediately so it is up throughout the OAuth flow.
    func oAuthSessionWillStart() {
        oAuthSessionPending = true
        showNativeCover()
    }

    // MARK: - Native Cover

    private func showNativeCover() {
        guard let window = keyWindow() else { return }
        if let existing = nativeCover {
            existing.layer.removeAllAnimations()
            existing.alpha = 1
            window.bringSubviewToFront(existing)
            return
        }

        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = UIColor(red: 9/255, green: 9/255, blue: 11/255, alpha: 1)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        // Text label is always renderable — UIImage(named:"AppIcon") reliably returns
        // nil because the AppIcon.appiconset is the system icon set, not a named asset.
        let label = UILabel()
        label.text = "Forgenta"
        label.textColor = UIColor.white.withAlphaComponent(0.85)
        label.font = UIFont.systemFont(ofSize: 22, weight: .semibold)
        label.sizeToFit()
        label.center = CGPoint(x: cover.bounds.midX, y: cover.bounds.midY)
        label.autoresizingMask = [
            .flexibleLeftMargin, .flexibleRightMargin,
            .flexibleTopMargin,  .flexibleBottomMargin,
        ]
        cover.addSubview(label)

        window.addSubview(cover)
        nativeCover = cover
    }

    private func scheduleNativeCoverDismiss(after delay: TimeInterval) {
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.hideNativeCover()
        }
    }

    /// Polls document.readyState on the WKWebView every 200 ms.
    /// Dismisses the cover 0.4 s after the first 'complete' result, or after
    /// maxAttempts polls (whichever comes first).
    private func pollWebViewReady(maxAttempts: Int, attempt: Int = 0) {
        guard nativeCover != nil else { return }
        guard attempt < maxAttempts else {
            hideNativeCover()
            return
        }
        guard let webView = webViewForPolling() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.pollWebViewReady(maxAttempts: maxAttempts, attempt: attempt + 1)
            }
            return
        }
        webView.evaluateJavaScript("document.readyState") { [weak self] result, _ in
            DispatchQueue.main.async {
                if (result as? String) == "complete" {
                    // Grace period: let React finish its paint pass before revealing.
                    self?.scheduleNativeCoverDismiss(after: 0.4)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self?.pollWebViewReady(maxAttempts: maxAttempts, attempt: attempt + 1)
                    }
                }
            }
        }
    }

    private func hideNativeCover() {
        guard let cover = nativeCover else { return }
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = nil
        UIView.animate(withDuration: 0.5, animations: {
            cover.alpha = 0
        }, completion: { [weak self] _ in
            cover.removeFromSuperview()
            self?.nativeCover = nil
        })
    }

    private func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
            ?? scenes.flatMap { $0.windows }.first
    }

    private func webViewForPolling() -> WKWebView? {
        guard let vc = keyWindow()?.rootViewController as? CAPBridgeViewController else { return nil }
        return vc.bridge?.webView
    }

    // MARK: - Phone Lock Detection

    @objc private func handlePhoneLocked() {
        UserDefaults.standard.set("1", forKey: "forged:phone_locked")
        UserDefaults.standard.synchronize()
    }
}

// MARK: - AuthSession Plugin
// Wraps ASWebAuthenticationSession so JS can start an OAuth flow and receive
// the callback URL directly — no appUrlOpen / custom scheme interception needed.

@objc(AuthSessionPlugin)
public class AuthSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AuthSessionPlugin"
    public let jsName = "AuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?
    private var contextProvider: _AuthSessionContextProvider?

    @objc func start(_ call: CAPPluginCall) {
        guard
            let urlString = call.getString("url"),
            let url = URL(string: urlString),
            let scheme = call.getString("callbackURLScheme")
        else {
            call.reject("Missing url or callbackURLScheme")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            // Show the privacy cover BEFORE launching the session.
            // iOS 13+ does not fire applicationWillResignActive for
            // ASWebAuthenticationSession, so the cover must be shown here.
            (UIApplication.shared.delegate as? AppDelegate)?.oAuthSessionWillStart()

            self.authSession = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: scheme
            ) { callbackURL, error in
                if let err = error as? ASWebAuthenticationSessionError,
                   err.code == .canceledLogin {
                    call.reject("User cancelled")
                    return
                }
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                guard let callbackURL else {
                    call.reject("No callback URL received")
                    return
                }
                call.resolve(["url": callbackURL.absoluteString])
            }

            self.contextProvider = _AuthSessionContextProvider(bridge: self.bridge)
            self.authSession?.presentationContextProvider = self.contextProvider
            self.authSession?.prefersEphemeralWebBrowserSession = false
            self.authSession?.start()
        }
    }
}

private class _AuthSessionContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    weak var bridge: CAPBridgeProtocol?

    init(bridge: CAPBridgeProtocol?) {
        self.bridge = bridge
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? UIWindow()
    }
}
