# handoff-mac.md - the MacBook (Xcode) desk

## ⚠️ MAC RETURNED 2026-09-28 NIGHT. COLD-RESUME ON THE PC FROM HERE.
Tre took the MacBook back. Nothing below needs this physical Mac: a GitHub `macos-latest` runner can boot a simulator,
`xcrun simctl io booted screenshot`, and upload the PNG as an artifact. Each open item and how CI replaces the Mac:

1. **Widget in TestFlight (IN FLIGHT).** Target shipped in cbb0b524; profiles/secrets set; dispatch run 36503530493
   (build 1080, head 0e75637e) was queued when the Mac left. Sam re-dispatches from the PC after the wrap-up push.
   Proof = the "Assert the exported binary..." step green (appex present, group in both binaries, version parity)
   AND altool printing `UPLOAD SUCCEEDED`. If the group assert fails, the profile secrets are the suspect.
2. **Widget on a home screen (NOT SEEN).** Only renders via the Mac preview (real SwiftUI view + real decoder).
   Replacement: Tre adds the widget on his phone after installing 1080+, or a CI job. Nobody has seen it on iOS.
3. **Native glass 8a202850 (NOT STARTED).** One glass panel with no web content of its own, one screenshot. CI route:
   a workflow_dispatch job that builds for the simulator, launches with a debug flag that mounts the panel, and
   uploads a screenshot. Do not build frame-sync. f22f17b1 stays Tre's decision.
4. **Share sheet + GlassEffectPlugin round trip (NOT RUN).** Needs a signed-in sim. `.env.deck-walk.local` was
   DELETED from the Mac; use the PC copy. CI route: the same simulator job, with the credentials as secrets.
5. **Sign-in slowness.** Marks shipped in 0725d8e9. Tre reads DBG (OAUTH_*:+ms) on 1071+ and names the slow phase.
6. **Package.swift** still has Windows `\` paths in git. The Mac regenerated it locally only, and CI regenerates it.
7. **graphify-out/** was NOT updated from the Mac (graphify is not installed here). The PC runs
   `python -m graphify update .` and publishes.

Tooling left on the Mac: none. The gh binary, Tailscale pkg, logs, profiles and env file were deleted (see the session
report). Tailscale.app stays installed and signed in, because Tre uses it.


Kept short on purpose (Sam's ask). Ada's `handoff.md` is the main record; this is only the Mac's slice.

## Machine (measured 2026-09-28)
- Xcode 27.0 (27A266a), simulators: iOS 27.0 only (iPhone 17 / 17e / Air / 18 Pro / 18 Pro Max). No iOS 15-18 runtime,
  so the IPHONEOS_DEPLOYMENT_TARGET 15.0 floor is still unmeasured here.
- Node 24.21.0 at `~/.nvm/versions/node/v24.21.0/bin` (NOT on PATH, no nvm.sh). CI runs 22. No `gh`, no CocoaPods, no brew.
- Simulator build recipe (no signing):
  `npm ci && npm run build && npx cap sync ios`, then
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build`
- `cap sync` rewrites `ios/App/CapApp-SPM/Package.swift`: the committed copy has Windows `\` paths and lacks 4 plugins
  (haptics, local-notifications, preferences, push-notifications). CI regenerates it, so shipped builds are fine.
  Not committed from here, because the PC desk regenerates it with `\` again.
- Cover debug log in the simulator: `plutil -extract "CapacitorStorage\.forged:debug_log" raw "$(xcrun simctl get_app_container booted com.treforged.forged data)/Library/Preferences/com.treforged.forged.plist"`

## Done
1. `mac:` UIScene life cycle. The Xcode 27 SDK REFUSES TO LAUNCH a non-scene app: SIGTRAP ~0.4 s after launch,
   "UIScene life cycle is required for apps built with this SDK". So the day CI's `macos-latest` runner gets
   Xcode 27, every build would crash on launch. Fixed by a `SceneDelegate` (inside AppDelegate.swift, so no pbxproj
   edit) that forwards scene events to AppDelegate's existing handlers, plus `UIApplicationSceneManifest` in Info.plist.
   Verified in the iOS 27 simulator: it launches to the Auth screen. The cover log reads `first_launch` on a cold start
   with no stray WILL_FOREGROUND, and `WILL_FOREGROUND -> bg_poll` after a background trip.
   NOT verified: OAuth return, deep links, push, a real device, iOS < 27. The next dispatched iOS CI run is the Xcode 26 check.

2. `mac:` 2468b594: the project hooks now use `$CLAUDE_PROJECT_DIR`, not `C:/Users/tvonh/...` paths, and the
   Obsidian Stop hook runs only where powershell exists. Sam checked it on the PC: it works, so no revert.
   Node was added to PATH via `~/.zprofile`, which takes effect in new sessions. Mac allow rules are in
   `~/.claude/settings.json` (Tre approved them in manual mode).
3. TestFlight: iOS run 36494360205 = build 1069 from 40cdb82d (= b683e97c, same tree; rewritten for author), dispatched from the Mac. Build IPA succeeded.
   Check the UPLOAD step's own conclusion before calling it shipped.
4. TestFlight: iOS run 36495553543 = build 1071 (VERSION 6.8.1, 36e4c624). Upload step success AND altool printed
   `UPLOAD SUCCEEDED with no errors`, Delivery UUID a8b3825b-7045-4003-8e7d-4268fb4e9871. No `gh` here: read job logs
   with the git credential token via the REST API (`/actions/jobs/<id>/logs`).

## Handoff to a new terminal = Remote Control ON (Tre, 2026-09-28)
Tre: "make sure if you handoff to another terminal you automatically remote connect it". The Mac has no
`dispatch.py`, so open the successor with the flag set, never a bare `claude`:

    osascript -e 'tell application "Terminal" to do script "cd ~/getforgenta && claude --remote-control \"Ada Mac\" \"Read handoff-mac.md in full, then resume its Next list.\""'

`--remote-control [name]` is in this machine's `claude --help` (line 189). NOT yet run end to end: the first real
handoff must confirm the new session shows in Tre's Remote Control list before this tab exits.

## Moving files between the PC and the Mac = Taildrop (Tre/Sam, 2026-09-28)
- The Mac is `amelias-macbook-neo` (100.64.1.37), the PC is `challhq` (100.71.27.67), on Tre's tailnet. Tailscale 1.102.4
  standalone is installed on the Mac (pkg signature: Tailscale Inc. W5364U7YZB, notarized). CLI:
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.
- The PC sends with `tailscale file cp <file> amelias-macbook-neo:`. The Mac app SAVES IT STRAIGHT INTO ~/Downloads.
  `tailscale file get` then reads an EMPTY queue, which is not a failed send.
- ⚠️ This Mac's `find` is bfs: `-newermt "-30 minutes"` is REJECTED (stderr) and matches nothing. A watch built on it
  looks exactly like "the file never came". Use `ls -la ~/Downloads | grep` or `mdfind -name`.
- `.env.deck-walk.local` is installed at 600 and gitignored (keys REACH_TEST_EMAIL, REACH_TEST_PASSWORD). Never print it.

## iOS home-screen widget (2026-09-28, Sam/Tre "build the widgets")
**What exists.** `useWidgetSync` -> `buildWidgetPayload` -> `WidgetBridge.updateWidget` already fed ANDROID's widgets
(month-end cash, net worth, currency, updatedAt; refused when absent or NaN; absent after 7 days). iOS had no native
`WidgetBridge`, so the call was rejected on every iPhone. Built on the Mac:
- `WidgetBridgePlugin` in AppDelegate.swift (registered in ViewController) writes the payload to App Group
  `group.com.treforged.forged`, key `forgenta.widget.snapshot`, then reloads widget timelines. It calculates nothing.
- `ios/App/ForgentaWidget/`: two widgets, Month-End Cash (small+medium, medium shows both) and Net Worth (small).
  `WidgetSnapshot.decode` repeats Android's refusals. Design rendered through the real decoder.
- Gate: `src/lib/__tests__/widget-bridge-ios.gate.test.ts` (9 checks: names, methods, registration, one key set
  across plugin/TS/decoder, group+key, target membership). Proven red by a wrong jsName and a wrong decoder key.
- Simulator: app + ForgentaWidget.appex build, the appex is embedded, and the App Group container is created.
  NOT seen on a home screen: Xcode 27 replaced Simulator.app with DeviceHub and I did not script adding a widget.

**UNHELD 2026-09-28 evening:** Sam did portal steps 1-5 in Chrome while Tre was signed in. Profiles checked here
by sha256 (358e630e / a3b03876), name, app id and entitlements (both carry the group; the main one keeps
aps=production). Both GitHub secrets were set with the official gh 2.101.0 (checksum and GitHub signature verified,
in the scratchpad, not installed). The target patch is applied and retired, App.entitlements has the group, and
ios-build.yml imports + asserts both profiles, the appex, the group in both shipped binaries, and version parity.
**Was HELD, deliberately:** the Xcode target is `ios/App/ForgentaWidget/add-widget-target.pbxproj.patch`, NOT in the
project. Applied before the steps below, Release signing fails on the missing widget profile and every iOS build
(TestFlight included) goes red. App.entitlements also still lacks the App Group, for the same reason.

**Tre, Apple Developer portal, one sitting** (developer.apple.com > Certificates, Identifiers & Profiles):
1. Identifiers > "+" > **App Groups** > Description `Forgenta`, Identifier `group.com.treforged.forged` > Register.
2. Identifiers > `com.treforged.forged` > tick **App Groups** > Configure > tick `group.com.treforged.forged` > Save
   (confirm the "profiles become invalid" prompt).
3. Identifiers > "+" > **App IDs** > App > Description `Forgenta Widget`, Bundle ID explicit
   `com.treforged.forged.widget` > tick **App Groups** > Continue > Register; then open it > App Groups > Configure >
   tick `group.com.treforged.forged` > Save.
4. Profiles > **Forged App Store** > Edit > Save (regenerates it with App Groups) > Download.
5. Profiles > "+" > **App Store Connect** > App ID `com.treforged.forged.widget` > the same Apple Distribution
   certificate > name it exactly **`Forged Widget App Store`** > Generate > Download.
6. Put both downloaded .mobileprovision files on the PC or Mac and say so. The desk base64-encodes them into the
   GitHub secrets `BUILD_PROVISION_PROFILE_BASE64` (replace) and `BUILD_PROVISION_PROFILE_WIDGET_BASE64` (new).
   Only Tre can do steps 1-5. The App Group identifier cannot be created by the App Store Connect API.

**Then the desk does (no Tre):** `git apply` the patch; add the App Group to App.entitlements; in ios-build.yml import
the second profile and add `com.treforged.forged.widget` -> `Forged Widget App Store` to ExportOptions
`provisioningProfiles`; extend the entitlements-in-the-IPA step to assert the group in BOTH binaries; check that the
appex version equals the app version after `agvtool -all`; dispatch; require `UPLOAD SUCCEEDED` in the altool output.

## Standing decisions
- Obsidian: the Mac commits graphify-out/ only; the PC publishes it (Sam, 09-28). The vault NEVER gets a
  remote (no iCloud, Obsidian Sync or git), because it holds personal finance notes.
- Commits from the Mac start with `mac:`. Pull before every edit, because PC Ada also pushes to main.
  The repo identity is TRE Forged <tre@treforged.com>. `main` is protected against force pushes (Tre lifted it once on 09-28 to re-author 40cdb82d->b683e97c), so a pushed
  commit is normally permanent.

## Next (Mac-only work, in order)
1. After CI compiles this commit, dispatch iOS for TestFlight (Tre's call on the build cap) and check the cover
   and OAuth sign-in on his phone.
2. DONE 2026-09-28: Dynamic Type device half, iOS 27 simulator, Auth screen, settled frames (18 s wait; a 9 s frame
   caught the splash mid-fade and was discarded). `large` -> `accessibility-extra-large`: "Start Free" glyphs grew
   ~36 px -> ~72 px, the tagline wrapped to 3 lines, and the buttons grew with the text. So `-apple-system-body` DOES
   follow the iOS slider. Open: at AX-XL the Sign In button and footer sit below the fold. Scroll reachability was
   not checked. Not checked: signed-in screens, iOS < 27, a device.
3. Native share sheet and the GlassEffectPlugin round trip in the simulator. Needs a signed-in session in the sim.
4. f22f17b1 native glass stays BLOCKED on Tre's decision. The simulator can now MEASURE the sibling-view question,
   but do not write Swift for it without his yes.

## Installed on the Mac (2026-09-28, Tre's yes)
- `~/.claude/skills` = a git clone of `treforged/claude-skills` @ 8104ad2 (https). Update it with `git -C ~/.claude/skills pull`.
- `~/.claude/rules` = a copy of `rules/` from `treforged/dot-claude` @ 0f5d4ea.
- `~/.claude/CLAUDE.md` = `mac/CLAUDE.md` from `treforged/dot-claude` @ 2bfc149 (the PC charter with personal sections removed). Not
  installed: settings.json, bin/, hooks, agents (Windows paths and PowerShell).
- Reviewed before install: no secrets, and no injection or exfiltration text (the matches were defensive rules). Skill
  scripts run only when invoked. The only network call is desk/delegate.mjs -> Conductor, and only when its env is set (it is not set here).
