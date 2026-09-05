# Push notifications — what is built, what Tre must do, and the fork found on the way

Written 2026-09-05. Everything in "Built" is on `origin/main` and applied.

**Why this exists at all:** every notification the app ships today is a LOCAL one — scheduled
ON the device BY the app — so it only fires for someone who has already opened it. Measured
2026-09-05: **31 accounts, 2 active in seven days, 23 dormant beyond thirty days**, and no new
signup since 2026-08-07. A local notification cannot reach one of those 23 people.

---

## Built and verified

| Piece | Where | Proof |
| --- | --- | --- |
| `device_tokens`, `push_sends`, `push_send_runs` | `20260905_device_tokens.sql`, applied | anon `GET` on all three returns **401 / 42501** |
| Client registration | `src/lib/push-registration.ts` | 11 cases, including every refusal path |
| The Supabase store | `src/lib/push-store.ts` | upserts on `(platform, token)` |
| Sign-in and sign-out wiring | `AuthContext.tsx`, beside the RevenueCat calls | typecheck + suite |

Three details in there are load-bearing and easy to undo by accident:

- **`revoke all ... from anon, authenticated`** is not decorative. The default public-schema ACL
  grants ALL to both roles, so a table created without it is readable by anyone holding the anon
  key — which ships inside the app bundle. Same class of mistake as the `revenue_summary_lines`
  leak closed the same morning.
- **The token arrives on an EVENT, not from `register()`.** `register()` resolves as soon as the
  request is made, long before APNs answers. Code that awaits it and then reads a token reads
  nothing, every time. There is a 10s timeout so a device with no network cannot hang the launch.
- **Registration rides on `SIGNED_IN || INITIAL_SESSION`**, the same condition as RevenueCat and
  for the same reason: a returning user fires only the second. Registering on `SIGNED_IN` alone
  would collect tokens from first-time sign-ins and from nobody else — which is exactly the bug
  that left the RevenueCat SDK unconfigured for every returning user until this morning.

## ⚠️ THE TRAP: the shipped app is a WebView on the LIVE SITE

`capacitor.config.ts:8` sets `server.url` to `https://getforgenta.com`, and `webDir: 'dist'` is
unused at runtime. Native plugin calls still work through the bridge, but **the registration JS
must be in the DEPLOYED WEB BUILD.** A native rebuild without a matching web deploy registers
nothing, produces no tokens, and reports no error at all.

The upside of the same fact: a web deploy reaches mobile users immediately, with no app store
review.

## ⚠️ THE FORK FOUND WHILE BUILDING THIS — read before writing the sender

`notification-policy.ts` is transport-agnostic and the sender calls it as-is. **But its SIGNALS
are not equally available to a server.** `decideNotification` takes `upcomingBills`,
`projectedCashAtNextBill`, `cashFloor`, `nextMonthProjectedEndingCash`, `newMilestones` — and
every one of those comes from the forecast engine, which is client-side TypeScript that has
never run on a server.

That splits the seven notification kinds in two:

- **Server-computable today:** `learn_lesson` and `streak_risk`. Both derive from the
  `achievements` table (`lesson:<slug>` rows with `earned_at`) plus the bundled lesson list. The
  maths is `learn-streak.ts`, which is pure and needs porting to `supabase/functions/_shared/`
  — Deno cannot import from `src/`.
- **NOT server-computable without porting the engine:** everything money-shaped — bills due,
  cash below floor, a milestone reached.

**This is not a blocker and it is close to good news:** the two the server can already compute
are exactly the two Tre asked for — the weekly learning nudge and the streak. So the first
sender ships those, and **it must say in its own code that it sends two of seven kinds**, or
the next person will read a working sender and assume bill alerts are reaching dormant users
when they are not.

Porting the engine's signals server-side is its own project and should be scoped as one, not
smuggled into a sender.

## What Tre must do — none of it can be done for him

1. **Apple Developer → Certificates, Identifiers & Profiles → Keys:** create an **APNs Auth Key
   (.p8)** with "Apple Push Notifications service (APNs)" enabled. Record the **Key ID** and
   **Team ID**. ⚠️ The `.p8` downloads **once**.
2. **Apple Developer → Identifiers → `com.treforged.forged`:** tick **Push Notifications**.
3. **Regenerate the provisioning profile** after step 2 and update the
   `BUILD_PROVISION_PROFILE_BASE64` GitHub secret. (Same step already documented in
   `App.entitlements` for Associated Domains.)
4. **Firebase Console:** create or link a project to `com.treforged.forged` and download
   **`google-services.json`** into `android/app/`, or inject it in CI. The Gradle block at
   `android/app/build.gradle:56-63` is already conditional on its presence, so nothing breaks
   while it is missing.
5. **Firebase → Project Settings → Service Accounts:** generate a **service-account JSON** for
   FCM HTTP v1 auth.
6. **Supabase → Edge Function secrets:** store the `.p8` contents, Key ID, Team ID and the FCM
   service-account JSON.
7. At submission, confirm no extra entitlement review applies to financial alerts.

Still missing on the native side, and only unblockable by the above: `aps-environment` in
`App.entitlements`, `UIBackgroundModes: remote-notification` in `Info.plist`, and
`google-services.json`.

## ⚠️ How this gets proven, and why CI cannot do it

`notification-service.test.ts:8-9` already states the principle for the local transport and it
binds harder here: mocks prove every branch RUNS, and deliberately do NOT prove "the OS actually
displays anything. That needs a device."

**A 200 response body is not proof.** The steps:

1. Build a TestFlight / internal-track build carrying the real credentials, **and deploy the web
   build at the same time** — see the trap above.
2. Sign in on a **physical iPhone** and a **physical Android**.
3. Read the real rows out of `device_tokens`. Check `environment` says `sandbox` for TestFlight.
4. Invoke the sender with `dry_run=0` **scoped to that one `user_id`**.
5. Confirm a **banner actually appears on each device**. The artefact is a screenshot or a screen
   recording.

CI has no device and no real credentials, so a green badge proves nothing here — exactly as it
proves nothing about the money engine, where the real-data fixtures are gitignored and the
golden tests skip.
