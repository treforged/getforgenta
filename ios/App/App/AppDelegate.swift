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
    private var phoneLockTimer: Timer?

    // True only between applicationWillEnterForeground and applicationDidBecomeActive.
    // applicationWillEnterForeground fires ONLY for user-initiated foreground transitions,
    // NOT for brief interruptions (Control Center, Face ID) or fresh process starts.
    // This is more reliable than didEnterBackground, which can be stale when iOS kills
    // and restarts the app process in the background.
    private var willEnterForeground = false

    // True until the first applicationDidBecomeActive completes.
    // Identifies a fresh process start so the cover can poll instead of dismissing in 0.3s.
    private var isFirstLaunch = true

    // Set by ViewController when WKWebView content process terminates.
    // Means the WebView needs a full network reload before we can reveal it.
    private var webViewProcessTerminated = false

    // Set by AuthSessionPlugin before ASWebAuthenticationSession launches.
    // iOS 13+ does not fire applicationWillResignActive for ASWebAuthenticationSession,
    // so the cover must be shown before the sheet opens from the plugin.
    private var oAuthSessionPending = false

    // Set by protectedDataWillBecomeUnavailableNotification, which fires ONLY
    // on a real device lock (power button), not on home-button backgrounds.
    private var phoneLocked = false

    // MARK: - Lifecycle

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDeviceLock),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
        // No cover shown on fresh launch — capacitor.config ios.backgroundColor (#09090b)
        // makes the bare WKWebView background match the app's dark theme, so no
        // black flash is visible while React loads. The cover is only needed for
        // background→foreground transitions (shown in applicationWillResignActive).
        return true
    }

    @objc private func handleDeviceLock() {
        debugLog("PHONE_LOCK")
        phoneLocked = true
    }

    // Fires for every interruption: background, Control Center, Face ID, call banners,
    // system overlays. Show the cover immediately so app content is never captured
    // in the iOS App Switcher screenshot.
    func applicationWillResignActive(_ application: UIApplication) {
        debugLog("RESIGN fromBg=\(willEnterForeground)")
        phoneLockTimer?.invalidate()
        phoneLockTimer = nil
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = nil
        showNativeCover()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        debugLog("ENTER_BG")
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        debugLog("WILL_FOREGROUND")
        willEnterForeground = true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        debugLog("BECOME_ACTIVE oauth=\(oAuthSessionPending) fromBg=\(willEnterForeground) firstLaunch=\(isFirstLaunch) wvKilled=\(webViewProcessTerminated)")
        defer {
            isFirstLaunch = false
            willEnterForeground = false
            webViewProcessTerminated = false
            phoneLocked = false
        }

        if oAuthSessionPending {
            oAuthSessionPending = false
            // ASWebAuthenticationSession does NOT trigger resign/background so
            // the backing store is intact — no reload needed. Wait 2.5 s minimum
            // for the code exchange, then poll until Dashboard sets the JS flag.
            debugLog("COVER_BRANCH:oauth → wait 2.5s then poll dashboard ready")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                self?.pollDashboardReady(maxAttempts: 30)
            }

        } else if isFirstLaunch {
            // Fresh process start. No cover is shown on launch (ios.backgroundColor
            // handles the loading period). If a cover somehow exists, dismiss quickly.
            debugLog("COVER_BRANCH:first_launch → no cover, dismiss")
            scheduleNativeCoverDismiss(after: 0.0)

        } else if !willEnterForeground {
            // Brief interruption: Control Center, Face ID, call banner, etc.
            // applicationWillEnterForeground was NOT called, so this is not a
            // real background→foreground transition.
            debugLog("COVER_BRANCH:brief → schedule 0.3s")
            scheduleNativeCoverDismiss(after: 0.3)

        } else if phoneLocked {
            // Device was locked via power button. Poll normally so the cover
            // lifts as usual, then schedule a reload 30 s later — this gives
            // the user a 30-second grace period before init() applies the lock.
            debugLog("COVER_BRANCH:phone_lock → poll 20, lock reload in 30s")
            pollWebViewReady(maxAttempts: 20)
            phoneLockTimer?.invalidate()
            phoneLockTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: false) { [weak self] _ in
                self?.debugLog("PHONE_LOCK_RELOAD_TRIGGERED")
                self?.showNativeCover()
                self?.reloadThenPoll(maxAttempts: 30)
            }

        } else if webViewProcessTerminated {
            // webViewWebContentProcessDidTerminate already called webView.reload().
            debugLog("COVER_BRANCH:wv_killed → poll 50")
            pollWebViewReady(maxAttempts: 50)

        } else {
            debugLog("COVER_BRANCH:bg_poll → poll 20")
            pollWebViewReady(maxAttempts: 20)
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

    /// Called when the WKWebView content process terminates.
    func handleWebViewProcessTerminated() {
        webViewProcessTerminated = true
    }

    // MARK: - Called by AuthSessionPlugin

    /// Call BEFORE launching ASWebAuthenticationSession.
    /// Shows the cover immediately so it is up during the OAuth flow and while
    /// React processes SIGNED_IN and navigates after auth completes.
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

        // Logo.imageset is a named image set that references the app icon PNG,
        // so UIImage(named:) resolves it reliably at runtime.
        if let logoImage = UIImage(named: "Logo") {
            let logoView = UIImageView(image: logoImage)
            logoView.contentMode = .scaleAspectFit
            logoView.frame = CGRect(x: 0, y: 0, width: 88, height: 88)
            logoView.center = CGPoint(x: cover.bounds.midX, y: cover.bounds.midY)
            logoView.layer.cornerRadius = 20
            logoView.layer.masksToBounds = true
            logoView.autoresizingMask = [
                .flexibleLeftMargin, .flexibleRightMargin,
                .flexibleTopMargin,  .flexibleBottomMargin,
            ]
            cover.addSubview(logoView)
        }

        window.addSubview(cover)
        nativeCover = cover
    }

    private func scheduleNativeCoverDismiss(after delay: TimeInterval) {
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.hideNativeCover()
        }
    }

    /// Polls window.__forgenta_dashboard_ready every 200 ms.
    /// Used after OAuth sign-in to confirm the dashboard has mounted before
    /// lifting the cover. Falls back to hiding after maxAttempts (6 s).
    private func pollDashboardReady(maxAttempts: Int, attempt: Int = 0) {
        guard nativeCover != nil else { return }
        guard attempt < maxAttempts else { hideNativeCover(); return }
        guard let webView = webViewForPolling() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.pollDashboardReady(maxAttempts: maxAttempts, attempt: attempt + 1)
            }
            return
        }
        webView.evaluateJavaScript("window.__forgenta_dashboard_ready === true") { [weak self] result, _ in
            DispatchQueue.main.async {
                if (result as? Bool) == true {
                    self?.debugLog("DASHBOARD_READY flag=true")
                    self?.waitForPaintThenDismiss(webView)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self?.pollDashboardReady(maxAttempts: maxAttempts, attempt: attempt + 1)
                    }
                }
            }
        }
    }

    /// Polls window.__forgenta_app_ready every 200 ms.
    /// Set by AppReadySignal in App.tsx on first React mount — fires after the full
    /// component tree has rendered, not just when the HTML document is parsed.
    /// This prevents cover dismissal on the bare black WebView skeleton on fresh launch.
    private func pollAppReady(maxAttempts: Int, attempt: Int = 0) {
        guard nativeCover != nil else { return }
        guard attempt < maxAttempts else { hideNativeCover(); return }
        guard let webView = webViewForPolling() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.pollAppReady(maxAttempts: maxAttempts, attempt: attempt + 1)
            }
            return
        }
        webView.evaluateJavaScript("window.__forgenta_app_ready === true") { [weak self] result, _ in
            DispatchQueue.main.async {
                if (result as? Bool) == true {
                    self?.debugLog("APP_READY flag=true")
                    self?.waitForPaintThenDismiss(webView)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self?.pollAppReady(maxAttempts: maxAttempts, attempt: attempt + 1)
                    }
                }
            }
        }
    }

    /// Polls document.readyState every 200 ms.
    /// Dismisses cover 0.4 s after the first 'complete' result, or after maxAttempts.
    private func pollWebViewReady(maxAttempts: Int, attempt: Int = 0) {
        guard nativeCover != nil else { return }
        guard attempt < maxAttempts else { hideNativeCover(); return }
        guard let webView = webViewForPolling() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.pollWebViewReady(maxAttempts: maxAttempts, attempt: attempt + 1)
            }
            return
        }
        webView.evaluateJavaScript("document.readyState") { [weak self] result, _ in
            DispatchQueue.main.async {
                if (result as? String) == "complete" {
                    self?.waitForPaintThenDismiss(webView)
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

    /// Waits for two requestAnimationFrame callbacks before dismissing the cover.
    /// rAF only fires when the WebView is actively painting, so two callbacks
    /// guarantee the backing store has been repopulated after iOS reclaimed it.
    /// Falls back to a fixed 0.4 s delay on iOS < 14 or if the JS call hangs.
    private func waitForPaintThenDismiss(_ webView: WKWebView) {
        guard #available(iOS 14.0, *) else {
            scheduleNativeCoverDismiss(after: 0.4)
            return
        }
        // Safety net: if callAsyncJavaScript never completes, dismiss anyway.
        var completed = false
        let fallback = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
            guard !completed else { return }
            completed = true
            self?.debugLog("RAF_TIMEOUT → fallback dismiss")
            self?.scheduleNativeCoverDismiss(after: 0.0)
        }
        webView.callAsyncJavaScript(
            "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
            arguments: [:],
            in: nil,
            in: WKContentWorld.defaultClient
        ) { [weak self] _ in
            DispatchQueue.main.async {
                guard !completed else { return }
                completed = true
                fallback.invalidate()
                self?.debugLog("RAF_PAINT_READY")
                self?.scheduleNativeCoverDismiss(after: 0.1)
            }
        }
    }

    private func reloadThenPoll(maxAttempts: Int, isBgReload: Bool = false) {
        guard let webView = webViewForPolling() else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.pollWebViewReady(maxAttempts: maxAttempts)
            }
            return
        }
        if isBgReload {
            // Signal JS init() to skip lock check. Lock only applies on a real
            // app open (kill+reopen, phone lock). Clears itself at start of init().
            UserDefaults.standard.set("1", forKey: "CapacitorStorage.forged:bg_reload")
        }
        debugLog("RELOAD_TRIGGERED bgReload=\(isBgReload)")
        webView.reload()
        // Wait for reload to start before polling readyState.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.pollWebViewReady(maxAttempts: maxAttempts)
        }
    }

    // MARK: - Debug Logging

    private func debugLog(_ event: String) {
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let entry = "\(ts)|\(event)"
        // Capacitor Preferences plugin prefixes all keys with "CapacitorStorage."
        // so Swift must use the same prefix for the JS debug panel to read the log.
        let key = "CapacitorStorage.forged:debug_log"
        let existing = UserDefaults.standard.string(forKey: key) ?? ""
        var lines = existing.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        if lines.count >= 200 { lines = Array(lines.suffix(199)) }
        lines.append(entry)
        UserDefaults.standard.set(lines.joined(separator: "\n"), forKey: key)
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
