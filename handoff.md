# Handoff — 2026-07-27 (session 35) — MB.2 brand SEO SHIPPED; Meta app CREATED but OAuth not yet proven. Session 33's Supabase steps STILL OPEN.

> ⚠️ Two independent workstreams. **Part A (marketing) is this session's work. Part B is session 33's unfinished production work and is higher stakes** — do Part B first if Tre asks about the app rather than marketing.

---

# PART A — Marketing (session 35)

## What Tre asked
"Continue marketing tasks." Chose **"Both MB.2 and MB.1 setup"** when asked how to spend the session, and answered the open MB.3 question.

## ✅ MB.2 — Brand SEO — DONE AND COMMITTED

Repo: **`C:\Users\tvonh\Desktop\treforgedwebsite`** (a DIFFERENT repo from getforgenta), branch `main`, commit **`6332812`**, **local only — NOT pushed** per Tre's standing rule.

`index.html` root page had **zero** entity markup (blog posts already had BlogPosting/Breadcrumb/FAQPage; the site itself had none). Added a 4-node JSON-LD graph in `<head>`:
- `Organization` `#organization` — logo, legalName "TRE Forged LLC", email, `sameAs` → treforged IG/TikTok/YouTube, `owns` → `#forgenta`
- `SoftwareApplication` `#forgenta` — App Store + Play + @getforgenta, `publisher` → `#organization`
- `WebSite` `#website`, `WebPage` `#webpage`

Also: `<title>` → "TRE Forged — Wealth, Cars & Strategy | Makers of Forgenta", meta description now carries both brand names, and the app-block `<p>` now states Forgenta is built by TRE Forged so the entity link exists in prose, not only markup.

**Deliberate omissions — do not "fix" these without new info:**
- No `offers` / `aggregateRating` on SoftwareApplication. Premium pricing is unknown and fabricating it risks a Google manual action. **Ask Tre for real pricing, then add `offers`.**
- No `SearchAction` on WebSite — the site has no search.
- Forgenta's own profiles live on the SoftwareApplication node, **NOT** in Organization's `sameAs`. `sameAs` means "another page about this same entity"; the app is a distinct entity joined by publisher/owns edges. Merging them is wrong.

Verified: JSON-LD parses (Python `json.loads`). **Not yet verified against Google's Rich Results Test** — do that after push.

Backup: `treforgedwebsite/backups/2026-07-27_MB2-jsonld/index.html`.
⚠️ **`backups/` is NOT gitignored in treforgedwebsite** (3 backup files are already tracked there), unlike getforgenta where it is. My new backup is untracked and uncommitted. Tre was offered an ignore rule and has not answered.

## ✅ MB.3 — question answered
**"Main page" = `Landing.tsx`, the public marketing page.** Logged-out visitors, acquisition-focused. **Not** the Dashboard. Nothing built yet. Still needs a JSON feed from `publish-next.mjs` (treforgedwebsite repo) + a CSP check.

## 🟡 MB.1 — Meta app CREATED, but OAuth is NOT proven working

**Created this session** at developers.facebook.com (Tre logged in himself; he approved the terms click explicitly):

| Field | Value |
|---|---|
| App name | **Forgenta Publisher** |
| **App ID** | **`1521659006403853`** |
| Contact email | `contact@treforged.com` (changed from tre.hines@outlook.com at Tre's request, saved + verified) |
| Use case | Manage messaging & content on Instagram |
| Business portfolio | TRE Forged — **Unverified business** |
| Mode | **Development / Unpublished** |

Dashboard: `https://developers.facebook.com/apps/1521659006403853/dashboard/`

### 🔴 THE TWO OPEN RISKS — read before writing code

**1. Meta added "Facebook Login for Business", NOT classic "Facebook Login".**
The sidebar reads *Facebook Login for Business* and settings live at `/business-login/settings/`. `src/publish/meta_auth.py` was written against **classic FB Login** (plain `scope=` params → `/me/accounts`). Facebook Login for Business commonly requires a **`config_id`** pointing at a saved *Configuration* (there is a `Configurations` nav item, currently unused) instead of raw `scope`. **This may require changing `meta_auth.py`.** Do not assume the existing flow works — run `python connect.py instagram` and read the actual error first.

**2. Redirect URI: Meta gives contradictory answers. UNRESOLVED.**
- Typing `http://localhost:8723/callback` into *Valid OAuth Redirect URIs* and saving → **it does not persist**. After reload the list is empty. Inline notice: *"http://localhost redirects are automatically allowed while in development mode only and do not need to be added here."*
- But the **Redirect URI Validator on the same page says: "This is an invalid redirect URI for this application. You can make this URI valid by adding it to the list of valid OAuth redirect URIs above."**

These directly contradict. Most likely the validator simply doesn't model the dev-mode localhost exemption. **The only real test is running `connect.py instagram`.** If OAuth fails with a redirect_uri error, the fallback is a hosted HTTPS callback on treforged.com (which is also what TikTok needs anyway — see below).

Note `Enforce HTTPS` = Yes and `Use Strict Mode for redirect URIs` = Yes, both appear locked.

### ⏭️ IMMEDIATE NEXT STEPS for MB.1
1. **Get the App Secret** — App settings → Basic → App secret → **Show** (re-prompts for Tre's FB password, so he must do it). Not yet retrieved.
2. **Write `tre-forged-marketing/memory/meta_app.json`**: `{"app_id": "1521659006403853", "app_secret": "..."}` — this file does not exist yet.
3. **Tre must confirm the IG account type.** He said `@getforgenta` is a "professional account", which is the umbrella term covering **Business** and **Creator**. He was told: check Settings → Account type and tools; if **Creator**, switch to **Business** (publishing API is documented against Business; switch is free and reversible). **He has not reported back.** It also must be **linked to a Facebook Page** — unconfirmed whether a Page exists.
4. **Run `supabase-marketing-bucket.sql`** in Supabase SQL editor (project `mdtosrbfkextcaezuclh`). Still not run. Creates the public `marketing-public` bucket. Needed because IG's API fetches media from a public HTTPS URL and does not accept uploaded bytes.
5. **Create `tre-forged-marketing/.env`** with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Does not exist yet.
6. Then `python connect.py instagram`, then publish `posts/blog_carousel.json` (PI.1) for real.

### ⚠️ Still true from session 34
- **`tre-forged-marketing/` is entirely gitignored** (`.gitignore:35`). None of that code is in git. Only safety net is `backups/2026-07-27_210132/`. `git checkout` cannot recover it.
- **TikTok**: documents redirect URIs as HTTPS-only, so localhost may be rejected outright; and direct posting needs TikTok's app audit for `video.publish` — until approved only drafts work. Not started this session.
- **Unverified business portfolio** will eventually block Advanced Access. Not blocking today.
- App has no Privacy Policy URL set and ToS URL is the default `https://www.facebook.com/`. Only matters if the app is ever published Live.

## ⏭️ REMAINING PRIORITY ORDER (unchanged from session 34, MB.2 now removed)
1. **Finish MB.1** (steps above) — highest value, unblocks the standing "every app update gets a post" commitment.
2. **MB.3** — now unblocked on requirements; build against `Landing.tsx`.
3. **MB.5 Reddit** — **confirm paid-vs-organic with Tre first**; existing playbook is organic-only.
4. **MB.4 AI chat recommendations** — slow, downstream of the others, do last.
5. **MB.6 free-tier car builds** — route to `project_roadmap`, it's a product change (`Builds.tsx` premium, depends on FB.6 + FB.7).

Also still open: the **Reddit Scout double-schedule** (local Thursday-9PM Task Scheduler vs Supabase twice-daily cron) may be running redundantly — duplicate digests, doubled Gemini spend. Never resolved. See `marketing_reddit_scout` memory.

## Memory updated this session
`marketing_backlog.md` — MB.2 marked shipped with the entity-graph decision and the omissions recorded; MB.3's open question marked ANSWERED (Landing.tsx).

---

# PART B — Session 33 leftovers (STILL OPEN, higher stakes, UNTOUCHED this session)

Session 33 shipped items 4 & 5 and pushed through `515fe48a`. Both store builds succeeded; **Android auto-deployed to Play production**. The code is live but **two Supabase dashboard steps were never done, so the email-verification work has no visible effect yet.**

## 🔴 DO THESE FIRST IF WORKING ON THE APP
Tre already authorized these ("go into supabase and do it for me"). **Nothing has been changed in Supabase.**
1. **Site URL** → project `mdtosrbfkextcaezuclh` → Authentication → URL Configuration → set `https://getforgenta.com`. Required because the template now uses `{{ .SiteURL }}`.
2. **Confirm signup template** → Authentication → Email Templates → Confirm signup → replace with `supabase-email-templates.html` **lines 9–122** (between the START/END markers, markers excluded).
   - ⚠️ Until BOTH are done, confirmation emails still use the old `supabase.co/auth/v1/verify` redirect and none of the app-link work does anything.

## ⏭️ ALSO STILL OPEN (Part B)
- **`supabase/functions/delete-account/index.ts` is STILL NOT DEPLOYED** (edited in `cd48de32`). Both deletion gaps — `subscriptions` rows + public `build-photos` objects — remain open **in production**. Deploy via Supabase MCP `deploy_edge_function` or CLI.
- Magic Link / Reset Password / Change Email / Invite templates share the same latent `token_hash` flaw as Confirm Signup; only Confirm Signup was fixed.
- Dependabot: 1 moderate vuln on main (`security/dependabot/56`).
- GA `sign_up` key event still unmarked; Search Console indexing never started.

## ✅ VERIFICATION CHECKLIST (after the 2 Supabase steps)
1. **Image upload works** (session 32 CSP fix) — fastest proof the deploy landed.
2. `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` both return JSON, AASA with `Content-Type: application/json`.
3. Debt chart `1Y/2Y/3Y/5Y` pills; 5Y identical to before.
4. `/delete-data` renders; Settings → Danger Zone link reaches it.
5. Email confirm **on a device with the app installed** → opens the APP. Android App Link verification can lag a few minutes post-install.
6. Same link on desktop → verifies and lands on `/dashboard`.

## 🧭 STATE
- **getforgenta**: branch `main`, working tree clean, pushed through `515fe48a`. Nothing changed in this repo this session except `handoff.md`.
- **treforgedwebsite**: branch `main`, commit `6332812` local and UNPUSHED, plus one untracked backup dir.
- Supabase project `mdtosrbfkextcaezuclh`.
- iOS signing risk is CLOSED. No need to re-verify.
- Chrome MCP tab IDs do NOT survive `/clear` — call `tabs_context_mcp` fresh. Tre is **already logged into developers.facebook.com** in that browser profile.
- Chrome screenshot capture intermittently timed out this session (CDP `Page.captureScreenshot` 30s timeouts); `get_page_text` worked reliably as a fallback.
