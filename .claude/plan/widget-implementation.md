# Widget Implementation Plan — Monthly Surplus + Net Worth
> Generated 2026-05-15. Two home screen widgets for iOS (WidgetKit) and Android (AppWidget/RemoteViews).

## What gets built
- **Monthly Surplus widget** — shows `monthEndCash` (green if ≥0, red if <0)
- **Net Worth widget** — shows `accountSummary.netWorth` (gold if ≥0, red if <0)
- Both show "Updated 2h ago" relative timestamp and a "Open Forgenta to sync" placeholder until first write

## Data flow
```
Dashboard.tsx (React)
  └─ useWidgetSync hook (debounced 500ms)
       └─ WidgetBridge Capacitor plugin.updateWidget(payload)
            ├─ iOS:  UserDefaults(suiteName: "group.com.treforged.forged.widgets")
            │        + WidgetCenter.shared.reloadAllTimelines()
            └─ Android: SharedPreferences("forgenta_widget")
                        + AppWidgetManager broadcast → onUpdate()
```

## Payload written
```json
{
  "version": 1,
  "monthEndCash": 1240.55,
  "netWorth": 28430.10,
  "currency": "USD",
  "updatedAt": "2026-05-15T18:42:11Z"
}
```

## Phase 1 — TypeScript (web-safe, ship now)

### Files to create
- `src/plugins/widget-bridge.ts` — typed Capacitor plugin interface + web no-op stub
- `src/hooks/useWidgetSync.ts` — debounced write hook; skips when `isDemo=true` or `platform='web'`
- `src/hooks/__tests__/useWidgetSync.test.ts` — Vitest: debounce, platform guard, demo guard

### Files to modify
- `src/pages/Dashboard.tsx` (~line 454, after monthEndCash + accountSummary compute):
  ```tsx
  useWidgetSync({ monthEndCash, netWorth: accountSummary.netWorth, enabled: !isDemo && !essentialLoading });
  ```

## Phase 2 — iOS (do in Xcode)

### Manual Xcode steps (can't be scripted)
1. Main app target → Signing & Capabilities → App Groups → add `group.com.treforged.forged.widgets`
2. File → New → Target → Widget Extension → name `ForgentaWidgets` → uncheck "Include Configuration Intent"
3. Widget Extension target → Signing & Capabilities → App Groups → same group
4. Confirm widget extension is in main app's "Embed App Extensions" build phase

### Files to create
- `ios/App/App/WidgetBridgePlugin.swift` — Capacitor plugin; writes JSON to App Group UserDefaults; calls `WidgetCenter.shared.reloadAllTimelines()`
- `ios/App/ForgentaWidgets/WidgetSnapshot.swift` — `Codable` model + `static func load()` from App Group; add to both targets
- `ios/App/ForgentaWidgets/SurplusWidget.swift` — WidgetKit TimelineProvider + SwiftUI view; `.systemSmall` + `.systemMedium`
- `ios/App/ForgentaWidgets/NetWorthWidget.swift` — same pattern, gold color
- `ios/App/ForgentaWidgets/ForgentaWidgetsBundle.swift` — `@main WidgetBundle`
- `ios/App/ForgentaWidgets/ForgentaWidgets.entitlements` — App Group entry

### Files to modify
- `ios/App/App/App.entitlements` — App Group `group.com.treforged.forged.widgets`
- `ios/App/App.xcodeproj/project.pbxproj` — Xcode manages this after step above; commit result

### Apple Developer Portal prerequisites
- Register bundle ID `com.treforged.forged.ForgentaWidgets`
- Enable App Groups on both `com.treforged.forged` and `com.treforged.forged.ForgentaWidgets`
- Regenerate provisioning profiles before archiving

## Phase 3 — Android

### Check first
- `android/app/build.gradle` — confirm `apply plugin: 'kotlin-android'` exists (Capacitor 8 adds it by default). If missing, add it + `kotlin-stdlib` dep.

### Files to create
- `android/app/src/main/java/com/treforged/forged/widgets/WidgetSnapshot.kt` — data class + SharedPreferences reader
- `android/app/src/main/java/com/treforged/forged/widgets/WidgetBridgePlugin.kt` — `@CapacitorPlugin(name = "WidgetBridge")`; writes SharedPreferences; broadcasts `ACTION_APPWIDGET_UPDATE` to both providers
- `android/app/src/main/java/com/treforged/forged/widgets/SurplusWidgetProvider.kt` — `AppWidgetProvider.onUpdate`; RemoteViews from `R.layout.widget_surplus`
- `android/app/src/main/java/com/treforged/forged/widgets/NetWorthWidgetProvider.kt` — mirror
- `android/app/src/main/res/layout/widget_surplus.xml` — LinearLayout; label + amount + updated TextViews
- `android/app/src/main/res/layout/widget_networth.xml` — mirror
- `android/app/src/main/res/xml/widget_surplus_info.xml` — `<appwidget-provider>` with `updatePeriodMillis="0"` (push-driven)
- `android/app/src/main/res/xml/widget_networth_info.xml` — mirror
- `android/app/src/main/res/drawable/widget_background.xml` — rounded shape, bg `#0A0A0A`

### Files to modify
- `android/app/src/main/AndroidManifest.xml` — two `<receiver>` blocks (both `android:exported="true"` required for Android 12+)
- `android/app/src/main/java/com/treforged/forged/MainActivity.java` — `registerPlugin(WidgetBridgePlugin.class)` in `onCreate`

## Sequencing recommendation
1. **Phase 1 now** — zero native risk, web build unchanged
2. **Phase 2 (iOS)** — Apple portal lead time is the bottleneck; start first
3. **Phase 3 (Android)** — parallel with Phase 2 if bandwidth allows
4. **Phase 4 (verify)** — physical device test, then include in next app release

## Key risks
| Risk | Mitigation |
|------|------------|
| iOS provisioning (new bundle ID + App Group) | Register in Apple portal before archiving; regenerate profiles |
| `capacitor sync` resetting `App.entitlements` | Commit entitlements file; verify Capacitor doesn't overwrite it |
| Kotlin plugin missing in Android build | Read `build.gradle` first (step 13) before assuming |
| Widget showing stale data | Acceptable v1; placeholder text until first write |
| Demo mode polluting widget | `useWidgetSync` skips writes when `isDemo=true` |

## Success criteria
- [ ] Web dashboard unchanged, no console errors
- [ ] iOS: both widgets appear in "Add Widget" gallery on device
- [ ] Android: both widgets appear in launcher widget picker
- [ ] Opening Dashboard updates widgets within 1 second on both platforms
- [ ] Demo mode never writes to widget storage
- [ ] Placeholder shown before first app open
- [ ] Unit test for `useWidgetSync` passes
