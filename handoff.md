# Handoff — 2026-07-27 (session 33) — items 4 & 5 DONE + **PUSHED to main**. Remaining: 2 Supabase dashboard steps (IN FLIGHT when gate hit), edge fn deploy, verification.

## 📋 WHERE SESSION 32 LEFT OFF vs NOW
Session 32 finished items 1–3. This session did **item 4 (debt chart year filter)** and **item 5 (email verification → native app)** in full, plus the Apple/Play credential work that was blocking item 5.

**Everything is now PUSHED** (`1247644b..515fe48a`). This was explicitly authorized by Tre ("if thats everything we can push"). Standing no-auto-push rule still applies to future work.

## ✅ COMMITS THIS SESSION (all pushed)
- `3b8fd2a8` [debt/legal] — item 4 chart filter + Settings→/delete-data link
- `dcfdf3f4` [auth] — token_hash email verification code path
- `82c75f9e` [auth] — assetlinks.json + apple-app-site-association
- `515fe48a` [ios] — Associated Domains entitlement wired into pbxproj

Backups: `backups/2026-07-27_session33/`. `npx tsc --noEmit` clean, **221/221 tests green** after every step.

### Item 4 — debt chart year filter (DONE)
`src/components/debt/CreditCardEngine.tsx`. `chartYears` via `usePersistedState<'1'|'2'|'3'|'5'>('tre:debt:chart-years','5')` (line ~131) — matches the existing `accordionYear` convention rather than plain useState. `visibleChartData` = `debtChartData.slice(0, years*12)`; `chartTickInterval` = `max(0, ceil(years*12/10)-1)` so 5Y still yields 5 (identical to the old hardcoded value). Pills render in a new `justify-between` header row. Display-only — projections still run full `PROJECTION_MONTHS`, payoff/ETA untouched.
Also added the deferred `Link to="/delete-data"` in Settings Danger Zone.

### Item 5 — email verification opening the native app (CODE DONE)
The critical design point from session 32 was correct and is implemented:
- **`supabase-email-templates.html`** CONFIRM SIGNUP block only — both the CTA href (~line 72) and plain-text fallback (~line 87) now emit `{{ .SiteURL }}/auth-callback?token_hash={{ .TokenHash }}&amp;type=signup`. Magic Link / Reset Password / Change Email / Invite deliberately NOT touched (same latent flaw — flag to Tre as follow-ups).
- **`src/pages/AuthCallback.tsx`** rewritten — `token_hash` branch calls `supabase.auth.verifyOtp` with an otp `type` whitelisted against `EMAIL_OTP_TYPES`, navigates `/dashboard`, shows a recoverable error + "Back to sign in" otherwise. Existing custom-scheme "Open Forgenta" UI preserved for the OAuth path. Works in a plain desktop browser.
- **`src/App.tsx`** DeepLinkHandler — `token_hash` deep links forward to `/auth-callback` so verification has ONE implementation for native + web.
- **`AndroidManifest.xml`** — `autoVerify="true"` https intent-filter, `pathPrefix` scoped to `/auth-callback` and `/auth` only (NOT whole host, so `/builds/share/:token` stays in the browser).
- **`public/.well-known/assetlinks.json`** — `com.treforged.forged` + SHA-256 `91:82:33:1F:5D:C6:57:F2:CC:53:92:89:4B:6B:0D:14:44:62:94:FC:BA:3D:1F:17:92:C1:74:5B:0A:D5:DA:D8` (Google-held Play App Signing key, read from Play Console → App signing / `…/keymanagement`).
- **`public/.well-known/apple-app-site-association`** — `JAGC2SWGG4.com.treforged.forged`, components `/auth-callback`, `/auth` (+ `/*`).
- **VERIFIED:** `.well-known` dotfolder DOES survive `vite build` into `dist/`, and both files parse as valid JSON. `vercel.json` already serves AASA as `application/json` (patched session 32).

### Apple / Play account work DONE IN BROWSER this session
- **Apple Team ID = `JAGC2SWGG4`** (confirmed on-page).
- **Associated Domains ENABLED** on App ID `com.treforged.forged`. This **invalidated** the `Forged App Store` provisioning profile (Apple warned; Tre approved via AskUserQuestion).
- **Profile REGENERATED** — now carries `associated-domains`, `applesignin`, `beta-reports-active`. In-App Purchase emits no entitlement key on App Store profiles, so nothing was lost. Cert `TreVon Hines(Distribution)` (exp Apr 18 2027) preserved.
- **`ios/App/App/App.entitlements`** created (`applinks:getforgenta.com`), wired via `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in **both** Debug and Release in `project.pbxproj`. plist validated with plistlib.
- **Tre updated the `BUILD_PROVISION_PROFILE_BASE64` GitHub secret himself** (I encoded the .mobileprovision to his clipboard — 16560 chars, single line, decodes to 12420 bytes — but did not paste it; signing material must not go through me).

## 🔴 IN FLIGHT WHEN THE GATE HIT — DO THIS FIRST
Tre said **"go into supabase and do it for me"**, i.e. he authorized doing these two dashboard steps in the browser. I had only located the template line numbers when the context gate fired. **Nothing was changed in Supabase.**

1. **Site URL** → Supabase dashboard (project `mdtosrbfkextcaezuclh`) → Authentication → URL Configuration → set Site URL = `https://getforgenta.com`. Required, since the template now uses `{{ .SiteURL }}`.
2. **Confirm signup template** → Authentication → Email Templates → Confirm signup → replace with the block in `supabase-email-templates.html` **lines 8–123** (between `CONFIRM SIGNUP START` / `CONFIRM SIGNUP END`).
   - Suggested method: extract lines 9–122 to a temp file, `Set-Clipboard`, then Ctrl+A / Ctrl+V in the dashboard's code editor. Do NOT paste the START/END comment markers.
   - ⚠️ Until BOTH are done, confirmation emails still use the old `supabase.co/auth/v1/verify` redirect and **none of the app-link work has any visible effect**.

## ⏭️ ALSO STILL OPEN
- **`supabase/functions/delete-account/index.ts` is STILL NOT DEPLOYED** (edited in session 32's `cd48de32`). Both deletion gaps — `subscriptions` rows + public `build-photos` objects — remain open in production. Tre was asked and had not answered. Deploy via Supabase MCP `deploy_edge_function` or CLI.
- **Dependabot**: 1 moderate vuln on main, `https://github.com/treforged/getforgenta/security/dependabot/56`. Untouched, unrelated.
- Old lingering items: GA `sign_up` key event still unmarked; Search Console indexing never started.

## 🧭 BUILD / DEPLOY STATE AT HANDOFF
- Push `1247644b..515fe48a` triggered 5 workflows.
- **Android Build & Upload to Play Store: SUCCESS** → auto-deploying to Play **production** (10% staged, auto-promotes to 100% after 24h). This is a REAL RELEASE.
- **iOS Build & Upload to App Store: IN PROGRESS** at handoff — this is the live test of the new entitlement + regenerated profile secret. **CHECK IT FIRST:** `gh run list --limit 5`. If it failed at signing, the `BUILD_PROVISION_PROFILE_BASE64` secret likely didn't take.
- A background job (`gh run watch`) was watching both; its output may be stale/orphaned after /clear — just use `gh run list`.
- Vercel deploys off the same push.

## ✅ VERIFICATION CHECKLIST (after the 2 Supabase steps)
1. **Image upload works** (session 32 CSP fix) — fastest proof the deploy landed. Was failing with "Image could not be decoded".
2. `https://getforgenta.com/.well-known/assetlinks.json` returns JSON; `/.well-known/apple-app-site-association` returns JSON with `Content-Type: application/json` (NOT text/html).
3. Debt chart `1Y/2Y/3Y/5Y` pills; 5Y identical to before.
4. `/delete-data` renders; Settings → Danger Zone link reaches it.
5. **Email confirm on a device with the app installed** → link opens the APP, not the browser. Android App Link verification can lag a few minutes post-install.
6. **Same link on desktop** → verifies and lands on `/dashboard`.

## 🧭 STATE
- Branch `main`, clean, **pushed through `515fe48a`**.
- Supabase project `mdtosrbfkextcaezuclh`.
- One Chrome MCP tab open (was on Apple Developer profile download page). Tab IDs do NOT survive /clear — call `tabs_context_mcp` fresh.
