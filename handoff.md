# Handoff — 2026-07-27 (session 32) — 5-item batch: **items 1–3 DONE + committed `cd48de32` (local only, NOT pushed)**. Items 4 (debt chart year filter) and 5 (email-verify deep link) NOT started. Item 5 blocked on two credentials from Tre.

## 📋 THE 5 REQUESTS THIS SESSION
1. ✅ "all pictures are being blocked from upload" — FIXED
2. ✅ "does my app respect do not track requests?" — answered NO, then implemented DNT + GPC
3. ✅ "create a right to delete notice" — new /delete-data page
4. ⏭️ "add year filter to chart on debt payoff tab" — NOT STARTED (design decided, see below)
5. ⏭️ "make sure email verification takes them to the app if they have it downloaded" — NOT STARTED (design decided + blocked on credentials)

## ✅ DONE — commit `cd48de32` (LOCAL ONLY, do not push without asking)
Backups: `backups/2026-07-27_200550/` (vercel.json, analytics.ts, Legal.tsx, App.tsx, CreditCardEngine.tsx, Settings.tsx, AndroidManifest.xml).
`npx tsc --noEmit` clean after all edits.

### 1. Image upload — ROOT CAUSE + FIX
`src/lib/build-photos.ts:24` sanitizes every upload by `URL.createObjectURL(file)` → `img.src = blobUrl` (canvas re-encode to strip EXIF). The CSP in `vercel.json` was `img-src 'self' data: https:` — **no `blob:`** — so the decode was refused, `img.onerror` fired, and EVERY upload failed with "Image could not be decoded — file may be corrupt or unsafe". Hit web AND native (Capacitor `server.url` = getforgenta.com, same CSP).
**Fix:** `img-src 'self' data: blob: https:`. One token. ⚠️ Only takes effect once deployed to Vercel — Tre cannot verify uploads work until this is pushed/deployed.

### 2. DNT / GPC
Was NOT respected (zero references anywhere). Tre chose "honor both".
`src/lib/analytics.ts`: added exported `hasTrackingOptOutSignal()` (checks `navigator.globalPrivacyControl === true`, then `navigator.doNotTrack ?? window.doNotTrack ?? navigator.msDoNotTrack` === '1'/'yes'), plus global type augmentations. `initGA()` early-returns on it; `trackSignUp()` also guards. Signal deliberately OVERRIDES stored cookie consent. Privacy Policy gained section "8a. Do Not Track & Global Privacy Control".

### 3. Right to Delete notice
New `src/components/legal/DeleteDataContent.tsx` (11 sections: right, how to submit, verification, timelines, what's deleted, what's retained + why, service providers, consequences, non-discrimination, appeals, contact). Route `/delete-data` added in `App.tsx`, rendered by the existing `Legal` shell; 4th tab added to desktop nav ("Right to Delete") and BOTH mobile tab rows ("Deletion"); `isDelete` + `isTerms` flags replace the old `!isPrivacy && !isRefund` ternaries. Privacy Policy §8 Deletion now links to it.
⏭️ NOT DONE: a link from Settings → Danger Zone (near the Delete Account button, `src/pages/Settings.tsx:~786-830`) to `/delete-data`. Small, worth adding.

**⚠️ WHILE VERIFYING THE NOTICE WAS TRUTHFUL, FOUND + FIXED 2 REAL DELETION GAPS in `supabase/functions/delete-account/index.ts`:**
- `public.subscriptions` (tracked bills) has **NO foreign key to auth.users** (verified via SQL) → `auth.admin.deleteUser` did NOT cascade it and it was missing from `USER_TABLES` → rows would survive account deletion forever as orphaned personal data. Added `"subscriptions"` to `USER_TABLES`.
- The **`build-photos` storage bucket is PUBLIC** and its objects were never deleted → a deleted user's photos stayed reachable at their public URLs forever. Added `USER_STORAGE_BUCKETS` + `listUserObjects()` helper (Storage `list()` is not recursive; layout is `${userId}/${buildId}/${uuid}.jpg`, so it walks one level) + a non-fatal step 5b that removes them.
- Verified all OTHER tables missing from `USER_TABLES` (ai_advisor_history, ai_usage_events, car_build_items/phases/builds, lump_sum_transfers, payment_plans, email_nudges) DO cascade (`confdeltype='c'` on auth.users) — no action needed.
- Live orphan check ran clean: **0 orphaned subscriptions, 0 orphaned photos** — the leak was latent, nothing has actually leaked.
- ⚠️ **The edge function is edited but NOT DEPLOYED.** Needs a deploy to take effect.

## ⏭️ ITEM 4 — Debt Payoff chart year filter (NOT STARTED)
**Tre chose: segmented `1Y / 2Y / 3Y / 5Y` horizon buttons** (not a calendar-year picker, no separate "All").
All in `src/components/debt/CreditCardEngine.tsx` (backup already taken):
- `debtChartData` useMemo is at **line ~983**, builds `PROJECTION_MONTHS` (=60, from `src/lib/scheduling.ts:38`) rows.
- Chart JSX at **lines ~1150–1169** (`{debtChartData.length > 0 && (...)}`, `<LineChart data={debtChartData}>`).
- Plan: `const [chartYears, setChartYears] = useState<1|2|3|5>(5)` — **default 5 to preserve current behavior**; `const visibleChartData = useMemo(() => debtChartData.slice(0, chartYears * 12), [debtChartData, chartYears])`; feed that to `<LineChart>`; render the 4 buttons in the existing `<h3>` header row (justify-between), styled like the other small pill buttons in this file.
- XAxis `interval` is currently hardcoded `5` (line ~1159). Make it dynamic so tick density stays sane: `Math.max(0, Math.ceil((chartYears * 12) / 10) - 1)` → 5Y=5 (identical to today), 3Y=3, 2Y=2, 1Y=1.

## ⏭️ ITEM 5 — Email verification opening the native app (NOT STARTED, BLOCKED)
**🔴 BLOCKED — Tre answered "I'll paste both values now" but had not pasted them when the context gate hit. ASK HIM AGAIN FIRST:**
1. **Apple Team ID** (Apple Developer → Membership). Currently only a GH secret `APPLE_TEAM_ID` (`.github/workflows/ios-build.yml:102`), not in the repo, and the AASA file needs it as a literal.
2. **Android app-signing SHA-256** (Play Console → Setup → App integrity → App signing key certificate — the GOOGLE-held key, not the upload key, since Play App Signing is on).

### Current state (all verified this session — nothing is set up)
- `public/` has NO `.well-known/` at all — no `assetlinks.json`, no `apple-app-site-association`.
- `AndroidManifest.xml` has only the custom-scheme intent-filter (`com.treforged.forged`), no `https` + `autoVerify` filter.
- iOS has NO Associated Domains entitlement and no `.entitlements` file in `ios/App/App/` (would need `CODE_SIGN_ENTITLEMENTS` wired into `project.pbxproj` for Debug AND Release — hand-edit carefully). Apple Developer portal must also have Associated Domains enabled on the App ID or signing fails.
- `vercel.json` already patched this session to serve `/.well-known/apple-app-site-association` as `application/json` (it has no file extension). Vercel checks the filesystem before `rewrites`, so `public/.well-known/*` is served rather than being swallowed by the SPA rewrite — **but verify a `.well-known` dotfolder actually survives `vite build` into `dist/` (check `ls dist/.well-known` after a build).**

### 🎯 THE CRITICAL DESIGN POINT (do not miss this — association files alone will NOT work)
`src/pages/Auth.tsx:443` sets `emailRedirectTo: ${window.location.origin}/auth`, so the emailed link is Supabase's `{{ .ConfirmationURL }}` = `<project>.supabase.co/auth/v1/verify?...&redirect_to=https://getforgenta.com/auth`. The user taps a **supabase.co** URL that 302s to getforgenta.com. **iOS Universal Links and Android App Links only match the URL the user actually tapped — they never fire on a server-side redirect.** So universal links alone would change nothing.
**Fix = switch the Confirm Signup email to a token_hash link on our own domain:**
- `supabase-email-templates.html` (root, the file Tre pastes into the Supabase dashboard) — CONFIRM SIGNUP block, lines ~8–118: change the `<a href="{{ .ConfirmationURL }}">` (line ~67) and the plain-text fallback (line ~82) to `{{ .SiteURL }}/auth-callback?token_hash={{ .TokenHash }}&type=signup`. Requires Supabase Site URL = `https://getforgenta.com`.
- `src/pages/AuthCallback.tsx` (33 lines, currently ONLY renders an "Open Forgenta" custom-scheme button): add a `token_hash` branch → `supabase.auth.verifyOtp({ token_hash, type })` → navigate `/dashboard` on success, show an error + link to `/auth` on failure. Keep the existing custom-scheme UI for the OAuth path. **This page must keep working on desktop/web** (a user without the app lands here in a browser) — that's why the verify lives here rather than in the native handler.
- `DeepLinkHandler` in `src/App.tsx` (~line 153, `CapApp.addListener('appUrlOpen')`, already matches `path.includes('auth-callback')` and handles `code` / `access_token`): add a `token_hash` branch that just `navigate('/auth-callback' + incoming.search)` so AuthCallback does the verify — one implementation for both native and web.
- `AndroidManifest.xml`: add an `autoVerify="true"` intent-filter for `https` host `getforgenta.com`, **scoped by `pathPrefix` to `/auth-callback` and `/auth` only** — deliberately NOT the whole host, because capturing e.g. `/builds/share/:token` would force public share links into the app behind a login wall.
- Scope note: only the **Confirm Signup** template is in scope per Tre's ask. Magic Link, Reset Password, Change Email, and Invite have the identical redirect problem — flag them to Tre as follow-ups, don't silently change them.

## 🧭 STATE
- Branch `main`. `cd48de32` is **LOCAL, NOT PUSHED** (per standing rule).
- Nothing deployed: the CSP upload fix and the delete-account fix both need a deploy before Tre can see any change.
- No MCP browser tabs opened this session. Supabase project `mdtosrbfkextcaezuclh`.
- Prior sessions' work (blog pipeline hardening, GA4 fix) is CLOSED — see git history, not this file. Only lingering old items: GA `sign_up` key event still unmarked, and Search Console indexing never started.
