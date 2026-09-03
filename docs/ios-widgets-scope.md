# iOS home-screen widgets — scope

Written 2026-09-03. **Scope only; nothing built.** Android widgets exist and were
hardened the same day (`dd097596`); iOS is genuinely unstarted.

Read `src/lib/widget-snapshot.ts` before starting — the rules about what a widget
may show are already decided and tested there, and iOS must obey the same ones.

---

## What exists today

| Piece | Android | iOS |
| --- | --- | --- |
| Native widget UI | ✅ `NetWorthWidgetProvider`, `SurplusWidgetProvider` | ❌ none |
| Shared storage | ✅ `WidgetSnapshot` (SharedPreferences) | ❌ none |
| `WidgetBridge` plugin | ✅ `WidgetBridgePlugin.java` | ❌ none |
| Payload from the app | ✅ shared — `useWidgetSync` → `buildWidgetPayload` | ✅ same, already correct |

The web/TS half is done and platform-agnostic. `src/plugins/widget-bridge.ts`
already defines the contract, and `useWidgetSync` already refuses to send a
figure the app does not have.

### ⚠️ On iOS today, the bridge call fails silently

`registerPlugin('WidgetBridge')` has a **web** fallback and no iOS
implementation, so on a native iOS build the call rejects with "not implemented"
and `useWidgetSync` swallows it into a `console.warn`. Nothing is broken for
users — there is no widget to be wrong — but do not read the absence of errors as
evidence that anything works.

## The work, in order

1. **App Group entitlement** (`group.com.treforged.forged`). A WidgetKit
   extension is a separate process and cannot read the app's `UserDefaults`; the
   App Group is the only shared surface. **Read the risk section below before
   touching entitlements.**
2. **`WidgetBridge` Swift plugin** — a `CAPPlugin` with one `updateWidget`
   method, writing the same JSON shape the TS contract defines into the shared
   `UserDefaults(suiteName:)`, then calling
   `WidgetCenter.shared.reloadAllTimelines()`.
3. **WidgetKit extension target** — a new target in `App.xcodeproj`, SwiftUI
   views for the two widgets Android already has (net worth, surplus), reading
   from the same App Group suite.
4. **The honesty rules, ported not reinvented** — see below.

## The rules this must obey

These are settled and were paid for on Android; do not re-litigate them:

- **Absent is not zero.** A missing or malformed field renders `--`, never `$0`.
  On Android, `optDouble(key, 0)` made a genuine zero and missing data
  pixel-identical in confident gold. Swift's `UserDefaults.double(forKey:)` has
  **exactly the same trap** — it returns `0` for an absent key. Use
  `object(forKey:)` and check for nil.
- **Stale is absent, not a caveat.** Older than `WIDGET_STALE_AFTER_MS` (7 days)
  → render `--`, not the number with a timestamp under it. A caveat under a
  figure drawn in full-confidence colour is a caveat nobody reads.
- **The user's currency**, from the payload, never a hardcoded symbol. The
  Android widget hardcoded `Locale.US` and the app had been sending the literal
  `'USD'` — a non-USD user was reading their own money with the wrong symbol.
- **Never render a figure the app did not read.** That is the whole rule; the
  three above are instances of it.

## ⚠️ THE RISK THAT WILL BITE: entitlements and the pinned provisioning profile

Adding an App Group **changes the entitlements file**, and this project signs
Release **manually against a pinned provisioning profile**. From
`ios/App/App/App.entitlements`, recorded when Associated Domains was added on
2026-07-27:

> Release signs Manual against that pinned profile, so the
> `BUILD_PROVISION_PROFILE_BASE64` GitHub secret must carry the REGENERATED
> profile or the iOS build will fail at signing.

So the sequence is not optional and not reorderable:

1. Enable App Groups on App ID `com.treforged.forged` in the Apple developer
   portal.
2. **Regenerate** the "Forged App Store" provisioning profile.
3. **Update the `BUILD_PROVISION_PROFILE_BASE64` GitHub secret** with the new
   profile.
4. Only then add the entitlement in the repo.

Doing step 4 first turns every iOS build red at the signing step, with an error
that does not mention widgets. That is the single most expensive mistake
available in this slice, and it has already been made once on this project with
Associated Domains — which is why the warning is in the entitlements file.

A widget extension is also **its own target with its own bundle id**
(`com.treforged.forged.widgets`) and needs its own provisioning profile, so
there are two profiles to regenerate, not one.

## What cannot be verified from here

- Nothing in this slice can be pressed without **a Mac and Tre's device**. There
  is no simulator path from this machine, and the Android half is in the same
  position — those changes are read-and-reason and the commit says so.
- Budget the work as: entitlements/signing first and separately (it is the part
  that fails loudly and blocks everything), then the plugin, then the UI.

## Not in scope

- Lock-screen and StandBy widgets. Same data, more layouts; decide after the
  home-screen pair is real.
- Live Activities. Nothing here is time-boxed enough to justify one.
- Interactive widgets (iOS 17+). Every figure here is a read; tapping through to
  the app is the whole interaction.
