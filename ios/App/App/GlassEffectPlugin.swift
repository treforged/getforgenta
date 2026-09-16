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
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise)
    ]

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
}
