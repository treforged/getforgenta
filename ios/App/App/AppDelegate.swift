import UIKit
import Capacitor
import AuthenticationServices

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Native privacy cover — lives above WKWebView in the UIWindow hierarchy.
    // Shown synchronously in applicationWillResignActive (before iOS screenshots
    // the app for the switcher and before the rendering process suspends).
    // Hidden 2 s after applicationDidBecomeActive to give WKWebView time to repaint.
    private var nativeCover: UIView?
    private var nativeCoverHideTimer: Timer?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Notify JS layer when the device screen is locked (power button).
        // UIApplication.protectedDataWillBecomeUnavailableNotification fires on lock;
        // regular app-switching does NOT trigger it. JS reads and clears the flag on
        // the next foreground return to decide whether to lock the app.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePhoneLocked),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
        return true
    }

    // Called immediately when the app loses foreground (before it actually backgrounds).
    // Fires for: app switches, Control Center, Notification Center, incoming calls,
    // ASWebAuthenticationSession sheets, and any system overlay.
    func applicationWillResignActive(_ application: UIApplication) {
        // Cancel any pending hide — a new resignation always forces the cover back.
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = nil
        showNativeCover()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    // Called when the app returns to full foreground after any resignation.
    func applicationDidBecomeActive(_ application: UIApplication) {
        scheduleNativeCoverDismiss()
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Native Cover

    private func showNativeCover() {
        guard let window = keyWindow() else { return }
        // If cover already exists, bring it to front (handles rapid resign/active cycles).
        if let existing = nativeCover {
            existing.alpha = 1
            window.bringSubviewToFront(existing)
            return
        }
        let cover = UIView(frame: window.bounds)
        // Match app background: hsl(240,10%,3.9%) ≈ #09090b
        cover.backgroundColor = UIColor(red: 9/255, green: 9/255, blue: 11/255, alpha: 1)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Add app icon centered in the cover (UIImage(named:"AppIcon") resolves from appiconset)
        if let logoImage = UIImage(named: "AppIcon") {
            let logoView = UIImageView(image: logoImage)
            logoView.contentMode = .scaleAspectFit
            logoView.frame = CGRect(x: 0, y: 0, width: 88, height: 88)
            logoView.center = CGPoint(x: cover.bounds.midX, y: cover.bounds.midY)
            logoView.layer.cornerRadius = 20
            logoView.layer.masksToBounds = true
            logoView.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin,
                                         .flexibleTopMargin, .flexibleBottomMargin]
            cover.addSubview(logoView)
        }
        window.addSubview(cover)
        nativeCover = cover
    }

    private func scheduleNativeCoverDismiss() {
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
            self?.hideNativeCover()
        }
    }

    private func hideNativeCover() {
        guard let cover = nativeCover else { return }
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = nil
        UIView.animate(withDuration: 0.35, animations: {
            cover.alpha = 0
        }, completion: { [weak self] _ in
            cover.removeFromSuperview()
            self?.nativeCover = nil
        })
    }

    private func keyWindow() -> UIWindow? {
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })
    }

    // MARK: - Phone Lock Detection

    @objc private func handlePhoneLocked() {
        // Write flag for JS layer — @capacitor/preferences uses UserDefaults.standard
        // under the hood with the key stored verbatim, so pGet('forged:phone_locked')
        // in AppLockContext.tsx reads this value directly.
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
