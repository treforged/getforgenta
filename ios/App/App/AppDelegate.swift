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

    // Wall-clock ceiling on the cover, and whether this foreground has already spent its one reload.
    //
    // ⚠️ THE COVER USED TO HAVE NO DEADLINE AT ALL. Every dismissal path below advances only from
    // inside a WKWebView JavaScript completion handler, so `attempt` only increments when the web
    // content process answers. After a long background iOS suspends and routinely jetsams that
    // process; when it never answers, `maxAttempts` is never reached, `hideNativeCover` is never
    // called, and nothing else was scheduled that would remove the cover. That is the "stuck on the
    // cover screen" Tre reported on 2026-08-24. This timer is the only thing in the class that does
    // not depend on the WebView answering, so it is the only thing that can end that state.
    private var coverDeadlineTimer: Timer?
    private var coverReloadAttempted = false

    // True only between applicationWillEnterForeground and applicationDidBecomeActive.
    // applicationWillEnterForeground fires ONLY for user-initiated foreground transitions,
    // NOT for brief interruptions (Control Center, Face ID) or fresh process starts.
    // This is more reliable than didEnterBackground, which can be stale when iOS kills
    // and restarts the app process in the background.
    private var willEnterForeground = false

    // True until the first applicationDidBecomeActive completes.
    // Identifies a fresh process start so the cover can poll instead of dismissing in 0.3s.
    private var isFirstLaunch = true

    /// How long the cover may stay up before the app stops waiting for the WebView and reloads it.
    ///
    /// ⚠️ THIS MUST STAY LONGER THAN THE SLOWEST POLL CHAIN BELOW, or a launch that is merely slow
    /// gets reloaded out from under itself. The longest is the fresh-start branch: 50 attempts at
    /// 200 ms is 10 s, plus up to 1.6 s in waitForPaintThenDismiss, so 11.6 s. Anything still on
    /// screen after 15 s is not slow, it is stuck. Re-check this if any maxAttempts changes.
    private static let coverReloadAfter: TimeInterval = 15.0

    /// How much longer the cover may stay up after that reload before it comes off regardless.
    /// The reload polls for at most 20 attempts (4 s) plus the same 1.6 s paint wait, so 10 s leaves
    /// room for it to finish honestly. Whatever is behind the cover at that point (the app, a
    /// connection notice, an empty page) is more honest than a branded screen that never goes away.
    private static let coverHardCeiling: TimeInterval = 10.0

    // The gleam swept across the cover's logo, held weakly because the cover's own view tree owns
    // it: hideNativeCover's removeFromSuperview drops the last strong reference and this nils
    // itself. Nothing in the shimmer path ever shows, hides, or schedules the cover.
    private weak var coverLogoShimmer: CAGradientLayer?

    /// One crossing of the gleam. Matched to the web half's `.logo-shimmer` (2.2 s, ease-in-out —
    /// see the `shimmer` keyframe in src/index.css) so both loading surfaces read as one effect.
    private static let logoShimmerDuration: CFTimeInterval = 2.2

    private static let logoShimmerAnimationKey = "forgenta.cover.logoShimmer"

    /// Warm, not white. The mark is gold, RGB(222, 171, 51). A white band desaturates it towards
    /// grey on the way past, which reads as a wash rather than a glint off metal. Rendered both
    /// ways before choosing: warm at 0.50 alpha and white at 0.42 land on the same luminance lift
    /// (173 → 207) but only the warm one leaves the gold looking gold.
    private static let logoGleamColor = UIColor(red: 1.0, green: 0.949, blue: 0.816, alpha: 0.5)

    /// Upper bound, per 8-bit RGB channel, of the logo's background colour — see installLogoShimmer,
    /// which keys everything below it out of the gleam so only the mark can catch the light.
    ///
    /// Measured rather than guessed: the asset's background is RGB(13, 10, 2) and the gold runs
    /// (186, 132, 31) … (231, 167, 43), so the two are separated by a wide gap. Moving this cutoff
    /// from 40 to 90 changes the kept area only 10.0% → 8.2% of the tile, i.e. there is no
    /// ambiguous anti-aliased band for it to land in and the exact value is not load-bearing.
    private static let logoMarkChromaCutoff: CGFloat = 70

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
        // Cold start: clear any bgReload flag left over from the previous session.
        // applicationDidEnterBackground sets this flag so WebView reloads in the
        // background skip the lock check. A new process start is a real cold open
        // and must run the full lock check — so we wipe the flag immediately.
        UserDefaults.standard.removeObject(forKey: "CapacitorStorage.forged:bg_reload")

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDeviceLock),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil
        )
        // Show cover immediately so the WKWebView reload on fresh process start
        // (including iOS process kills after short backgrounds) is hidden.
        // applicationDidBecomeActive polls window.__forgenta_dashboard_ready and
        // drops the cover once Auth/Onboarding/Dashboard has rendered.
        DispatchQueue.main.async { [weak self] in self?.showNativeCover() }
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
        // The deadline measures how long the app has been waiting while RUNNING. A timer left armed
        // across a background would come due the instant the app resumes and reload a WebView that
        // was about to answer perfectly well. applicationDidBecomeActive re-arms it.
        cancelCoverDeadline()
        showNativeCover()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        debugLog("ENTER_BG")
        // Pre-emptively mark this as a background transition so that if the
        // WKWebView content process is killed and React reloads while the app is
        // in the background, init() skips the lock check. Cleared on the next
        // cold start (didFinishLaunchingWithOptions). The phoneLocked 30-second
        // reload also passes isBgReload:true so the lock is not re-triggered.
        UserDefaults.standard.set("1", forKey: "CapacitorStorage.forged:bg_reload")
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

        // Every branch below waits on the WebView. Arm the one clock that does not, before choosing
        // which of them to wait with.
        coverReloadAttempted = false
        armCoverDeadline(AppDelegate.coverReloadAfter)

        // Presentation only, and deliberately above the branch chain rather than inside it: iOS
        // strips the sweep off its layer during the background, so if a cover is still up it needs
        // restarting whichever branch is about to run. It reads no cover state and schedules
        // nothing, so it cannot influence which branch that is or when the cover comes off.
        restartCoverShimmerIfNeeded()

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
            // Fresh process start (or iOS process kill+restart after short background).
            // Cover was shown in didFinishLaunchingWithOptions; poll until Auth,
            // Onboarding, or Dashboard sets window.__forgenta_dashboard_ready.
            // Auth sets it immediately (unauthenticated launch) so it resolves fast.
            // Authenticated sessions take 2–5 s for auth restore + dashboard mount.
            debugLog("COVER_BRANCH:first_launch → poll dashboard ready (max 50)")
            pollDashboardReady(maxAttempts: 50)

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
                self?.reloadThenPoll(maxAttempts: 30, isBgReload: true)
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
        // Auth page sets __forgenta_dashboard_ready = true. Reset it now so that
        // pollDashboardReady (called after OAuth returns) waits for Dashboard or
        // Onboarding to mount rather than firing instantly on the stale Auth flag.
        webViewForPolling()?.evaluateJavaScript(
            "window.__forgenta_dashboard_ready = false", completionHandler: nil)
        showNativeCover()
    }

    // MARK: - Native Cover

    private func showNativeCover() {
        guard let window = keyWindow() else { return }
        if let existing = nativeCover {
            existing.layer.removeAllAnimations()
            existing.alpha = 1
            window.bringSubviewToFront(existing)
            // removeAllAnimations above is scoped to the cover's own layer and does not reach the
            // gleam nested under the logo view, so the sweep normally survives a re-show untouched.
            // This call is what picks up a Reduce Motion change made since the cover went up; it
            // re-adds nothing already running, so it never restarts a sweep mid-crossing.
            restartCoverShimmerIfNeeded()
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
            installLogoShimmer(on: logoView)
        }

        window.addSubview(cover)
        nativeCover = cover
    }

    // MARK: - Cover logo shimmer

    /// Hangs the gleam on the cover's logo. Presentation only: it attaches sublayers to the logo
    /// image view and reads no cover state, starts no timer and calls nothing that dismisses, so it
    /// cannot move when the cover appears or disappears. It needs no teardown either — the layers
    /// are owned by the cover's view tree and die with it in hideNativeCover's removeFromSuperview.
    ///
    /// Must be called after the logo view's frame is set; the geometry below is derived from it.
    private func installLogoShimmer(on logoView: UIImageView) {
        let bounds = logoView.bounds
        guard bounds.width > 0, let markImage = logoView.image?.cgImage else {
            debugLog("COVER_SHIMMER skipped=no_image")
            return
        }

        // The gleam has to sit in a container that does NOT move, because the mask below is the
        // mark's fixed silhouette. A mask travels with the layer it is attached to, so masking the
        // sweeping band itself would drag a logo-shaped hole across the screen instead of holding
        // it still and letting the light pass behind it.
        let gate = CALayer()
        gate.frame = bounds
        gate.masksToBounds = true

        // ⚠️ THE MASK IS LOAD-BEARING, NOT DECORATIVE — and it cannot be the usual alpha mask.
        // "Logo" is the app icon: an OPAQUE square (PNG colour type 2, no alpha channel at all), a
        // gold mark on RGB(13, 10, 2) of which only ~8% is the mark. There is therefore nothing for
        // an image mask to clip to, and an unmasked band is actively wrong: source-over compositing
        // lifts that near-black by 0.5 × 245 but the gold by only 0.5 × 82, so the sweep reveals the
        // 88 pt icon tile as a bright rounded card and barely touches the mark. Backwards.
        //
        // So the silhouette is recovered by colour instead. masking(componentRange:) requires
        // precisely what this asset is — an image with no alpha channel — and keys out every pixel
        // darker than the cutoff on all three channels, leaving the mark. It returns nil rather than
        // trapping if a future asset arrives with an alpha channel; the gleam then still runs,
        // clipped to the rounded tile by masksToBounds, and the log below says which branch ran so
        // a wrong-looking cover can be told apart from a missing one without a debugger.
        let cutoff = AppDelegate.logoMarkChromaCutoff
        if let markOnly = markImage.masking([0, cutoff, 0, cutoff, 0, cutoff]) {
            let mask = CALayer()
            mask.frame = gate.bounds
            mask.contents = markOnly
            mask.contentsGravity = .resizeAspect // mirrors the image view's .scaleAspectFit
            gate.mask = mask
            debugLog("COVER_SHIMMER mask=mark")
        } else {
            debugLog("COVER_SHIMMER mask=tile")
        }

        // A band one logo-width wide, parked just off the left edge. Translated two widths it ends
        // just off the right edge, so it is fully outside `gate` at both ends of the loop and is
        // only ever visible mid-crossing.
        let band = CAGradientLayer()
        band.frame = CGRect(x: -bounds.width, y: 0, width: bounds.width, height: bounds.height)
        band.startPoint = CGPoint(x: 0, y: 0.35)
        band.endPoint = CGPoint(x: 1, y: 0.65)
        // The ends are the gleam colour at zero alpha, never UIColor.clear: clear is (0, 0, 0, 0),
        // and interpolating towards it drags the band's edges through grey.
        band.colors = [
            AppDelegate.logoGleamColor.withAlphaComponent(0).cgColor,
            AppDelegate.logoGleamColor.cgColor,
            AppDelegate.logoGleamColor.withAlphaComponent(0).cgColor,
        ]
        band.locations = [0.0, 0.5, 1.0]
        // Hidden until restartCoverShimmerIfNeeded decides — it is the single place that consults
        // Reduce Motion, so there is one answer rather than two that can drift apart.
        band.isHidden = true
        gate.addSublayer(band)

        logoView.layer.addSublayer(gate)
        coverLogoShimmer = band
        restartCoverShimmerIfNeeded()
    }

    /// Starts the sweep, or leaves the logo static under Reduce Motion.
    ///
    /// Safe to call from anywhere and as often as you like: it no-ops unless a cover is up with a
    /// gleam on it, and it re-adds nothing that is already running.
    ///
    /// It HAS to be callable more than once. Core Animation strips animations off layers when the
    /// app is backgrounded, and the cover is put up on resign and is still up on the way back — so
    /// without the call from applicationDidBecomeActive the logo would return frozen, on exactly the
    /// slow resume this shimmer exists to sit on top of.
    private func restartCoverShimmerIfNeeded() {
        // The weak gleam reference IS the "is a cover up" test, and deliberately not `nativeCover`:
        // showNativeCover builds the logo before it assigns `nativeCover`, so checking that here
        // would silently skip the very first call and leave a fresh cover's logo static. The weak
        // reference is also the more accurate question — it goes nil exactly when the cover's view
        // tree is released, which is the moment there is nothing left to shimmer.
        guard let band = coverLogoShimmer else { return }

        // Read fresh every time instead of caching at install: the setting can be changed while the
        // app is in the background, and this is the moment we would find out.
        guard !UIAccessibility.isReduceMotionEnabled else {
            band.removeAnimation(forKey: AppDelegate.logoShimmerAnimationKey)
            // Hidden, not merely stopped. A halted sweep leaves a bright band frozen across the
            // mark, which is a worse artefact than no shimmer at all.
            band.isHidden = true
            return
        }

        band.isHidden = false
        guard band.animation(forKey: AppDelegate.logoShimmerAnimationKey) == nil else { return }

        let sweep = CABasicAnimation(keyPath: "transform.translation.x")
        sweep.fromValue = CGFloat(0)
        sweep.toValue = band.bounds.width * 2
        sweep.duration = AppDelegate.logoShimmerDuration
        sweep.repeatCount = .infinity
        sweep.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        band.add(sweep, forKey: AppDelegate.logoShimmerAnimationKey)
    }

    /// Arms the wall-clock ceiling on the cover.
    ///
    /// This is the recovery path for a WebView that has stopped answering, so it deliberately shares
    /// nothing with the polls: no `evaluateJavaScript`, no completion handler, no dependency on the
    /// web content process being alive. It runs on the main run loop, which is running whenever the
    /// app is foregrounded, and it is cancelled the moment the cover comes off for any other reason.
    private func armCoverDeadline(_ delay: TimeInterval) {
        coverDeadlineTimer?.invalidate()
        coverDeadlineTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.handleCoverDeadline()
        }
    }

    private func cancelCoverDeadline() {
        coverDeadlineTimer?.invalidate()
        coverDeadlineTimer = nil
    }

    /// The cover has been up too long and the WebView has not answered.
    ///
    /// First time: reload it. This is Tre's "it should auto refresh": the app is loaded from a
    /// remote `server.url` (capacitor.config.ts), so after a long background the way back to a live
    /// page is a fresh load, and by this point in-place recovery has demonstrably not happened.
    /// Second time: take the cover off anyway. A blank page or a connection notice is a state the
    /// user can act on; a branded screen that never goes away is not.
    private func handleCoverDeadline() {
        guard nativeCover != nil else { cancelCoverDeadline(); return }

        if !coverReloadAttempted {
            coverReloadAttempted = true
            debugLog("COVER_DEADLINE → reload")
            // isBgReload so the reload does not re-trigger the PIN/biometric lock check. This is the
            // app recovering itself, not the user opening it.
            reloadThenPoll(maxAttempts: 20, isBgReload: true)
            armCoverDeadline(AppDelegate.coverHardCeiling)
            return
        }

        debugLog("COVER_DEADLINE → force hide")
        cancelCoverDeadline()
        hideNativeCover()
    }

    private func scheduleNativeCoverDismiss(after delay: TimeInterval) {
        nativeCoverHideTimer?.invalidate()
        nativeCoverHideTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.hideNativeCover()
        }
    }

    /// Polls window.__forgenta_dashboard_ready every 200 ms.
    /// Set by Dashboard (existing users) and Onboarding (new users) on mount.
    /// Used after OAuth to confirm the post-auth destination has rendered before
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
        cancelCoverDeadline()
        UIView.animate(withDuration: 0.5, animations: {
            cover.alpha = 0
        }, completion: { [weak self] finished in
            // finished is false when something interrupted this fade - notably showNativeCover's
            // removeAllAnimations() on a background during the 0.5s dismiss. Tearing the view down
            // anyway removed the privacy cover show had just put up, exposing balances in the App
            // Switcher. An interrupted hide leaves the cover to whoever interrupted it; a stuck
            // half-faded cover is ended by the deadline timer, never by this completion.
            guard finished else { return }
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
