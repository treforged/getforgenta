# handoff-mac.md - the MacBook (Xcode) desk

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
