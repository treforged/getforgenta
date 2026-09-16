//
//  GlassEffectPlugin.swift
//
//  BRIDGE SMOKE TEST - there is deliberately NO visual effect code in this file.
//
//  Its only job is to prove that a JS -> Swift -> JS call round-trips inside this app's
//  Capacitor bridge. The native glass material (UIVisualEffectView / UIGlassEffect) is the
//  work behind it, and none of that work matters if the bridge does not round-trip. That is
//  a one-commit answer rather than a week of work discovered at the end.
//
//  iOS 26 is the floor for the real material. This file must still COMPILE against the iOS 15
//  deployment target, so every iOS 26 reference lives inside `#available`.
//
//  Registration: Capacitor discovers CAPBridgedPlugin conformers in the app target through the
//  ObjC runtime, which is why `@objc(...)` is load-bearing and there is no registration call
//  anywhere. `AuthSessionPlugin` in AppDelegate.swift is the working precedent.
//
//  The JS side is `src/lib/native-glass.ts`. The two are coupled by the `jsName` string below
//  and asserted to agree by `src/lib/__tests__/native-glass-bridge.test.ts`, which reads BOTH
//  files - a name mismatch is the most likely way this bridge fails and it is invisible to the
//  compiler on either side.
//

import Foundation
import UIKit
import Capacitor

@objc(GlassEffectPlugin)
public class GlassEffectPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlassEffectPlugin"
    public let jsName = "GlassEffect"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    /// One effect view per caller-supplied id, so `apply` on an id already on screen MOVES that
    /// view rather than stacking a second one over it.
    private var effectViews: [String: UIVisualEffectView] = [:]

    /// Resolves `{ supported, iosVersion, echo }`.
    ///
    /// `echo` is the round-trip proof: JS sends a token, Swift hands the same token back. A
    /// call that resolves with the wrong echo is a bridge that is connected to something else.
    @objc func isSupported(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let echo = call.getString("echo") ?? ""

            // `#available` is a CONDITION, not an expression - it cannot be assigned to a let.
            let supported: Bool
            if #available(iOS 26.0, *) {
                supported = true
            } else {
                supported = false
            }

            call.resolve([
                "supported": supported,
                "iosVersion": UIDevice.current.systemVersion,
                "echo": echo
            ])
        }
    }

    /// Put a native glass surface over the web view at a rect given in CSS points.
    ///
    /// ⚠️ THIS COVERS WHAT IS UNDERNEATH IT, WHICH IS THE WHOLE CONSTRAINT. The effect view is a
    /// SIBLING of the WKWebView, not a layer inside it, so it can only be used on a surface with
    /// NO web content of its own - any icon, label or figure the web app draws in that rect is
    /// hidden behind the material. A surface that has its own content needs a second transparent
    /// WKWebView for that content, which is an architecture decision and not this method's job.
    ///
    /// ⚠️ AND THE FRAME DOES NOT FOLLOW ANYTHING. Being a sibling, it knows nothing about scrolling,
    /// resizing, rotation or the keyboard - the caller owns re-pushing the rect. That machinery is
    /// deliberately NOT built yet (Sam, 2026-09-15): one static surface first, because it is the
    /// cheapest thing that can answer whether this approach survives contact at all.
    @objc func apply(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }
        guard
            let x = call.getDouble("x"),
            let y = call.getDouble("y"),
            let width = call.getDouble("width"),
            let height = call.getDouble("height")
        else {
            call.reject("Missing frame")
            return
        }
        let cornerRadius = call.getDouble("cornerRadius") ?? 0

        guard #available(iOS 26.0, *) else {
            call.reject("Requires iOS 26")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view to attach to")
                return
            }

            let frame = CGRect(x: x, y: y, width: width, height: height)
            let view = self.effectViews[id] ?? UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))

            // Load-bearing: the view sits OVER the web view, so without this it swallows every tap
            // that lands on it and the app underneath stops responding.
            view.isUserInteractionEnabled = false
            view.frame = frame
            view.layer.cornerRadius = CGFloat(cornerRadius)
            view.layer.masksToBounds = true

            // addSubview on a view already in this hierarchy re-adds it at the TOP, which is what
            // an update wants anyway - so this is correct for both the new and the reused case.
            host.addSubview(view)
            self.effectViews[id] = view

            call.resolve(["applied": true])
        }
    }

    /// Take a surface away. Removing an id that is not there is NOT an error - a caller unmounting
    /// twice, or unmounting something that never applied, is ordinary and must not throw at it.
    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let view = self.effectViews.removeValue(forKey: id) else {
                call.resolve(["removed": false])
                return
            }
            view.removeFromSuperview()
            call.resolve(["removed": true])
        }
    }
}
