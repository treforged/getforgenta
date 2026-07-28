# Handoff — 2026-07-27 (session 34) — Marketing backlog created + Instagram/TikTok auto-posting BUILT (blocked on Tre's one-time app setup). Session 33's Supabase steps STILL OPEN.

> ⚠️ Two independent workstreams are live in this file. **Part A (marketing) is this session's work. Part B is session 33's unfinished production work and is higher stakes** — do Part B first if Tre asks about the app rather than marketing.

---

# PART A — Marketing (session 34)

## What Tre asked
1. "What's in my marketing backlog plans?" + add 5 new marketing ideas and 2 post ideas.
2. "Let's work on the IG automation now, then prioritize how you see best fit."
3. Mid-turn: **"make it so its just a simple oath log in screen when i go to connect instagram and tiktok."** ← this changed the design from pasted `.env` tokens to a real browser OAuth flow.

## ⚠️ CRITICAL: none of Part A is in git
`tre-forged-marketing/` is **entirely gitignored** (`.gitignore:35`, `git ls-files` returns 0). All the code below exists **only on disk**. The only safety net is `backups/2026-07-27_210132/`. Do not assume `git checkout` can recover any of it. Nothing was committed this session because there was nothing trackable to commit.

## Decisions Tre made (do not re-litigate)
- **Image host = Supabase Storage** (chose it over GitHub Pages and public Google Drive).
- **Day-one scope = feed post + carousel** (not Stories).

## Why images must be hosted at all
Instagram's Content Publishing API **fetches media from a public HTTPS URL and does not accept uploaded bytes.** The pre-existing Google Drive upload (`src/gdrive.py`) cannot serve this: it uses the `drive.file` scope, never sets public permissions, and returns a `webViewLink` (an HTML viewer page, not a direct image). So a public bucket is structural, not a preference.

## Files created (all under `tre-forged-marketing/`)
- `connect.py` — CLI: `python connect.py [instagram|tiktok]`, `--forget`, bare = status. This is the "simple OAuth login screen" Tre asked for.
- `publish.py` — CLI: `--post` / `--images` / `--caption` / `--dry-run` / `--keep-hosted` / `--check`.
- `src/publish/oauth.py` — local callback server on **`http://localhost:8723/callback`**, CSRF `state` check, styled dark-brand success/failure page, 5-min timeout. Mirrors the existing gdrive flow.
- `src/publish/meta_auth.py` — FB Login → short token → **long-lived token (~60d)** → `/me/accounts` → picks the Page whose `instagram_business_account` will receive posts.
- `src/publish/tiktok_auth.py` — OAuth 2.0 + PKCE (S256).
- `src/publish/accounts.py` — token store at `memory/connections.json`, expiry tracking, `status_line()`.
- `src/publish/storage.py` — Supabase Storage upload (date-partitioned + uuid key), public URL, best-effort delete after publish.
- `src/publish/instagram.py` — Graph API. Single + carousel. **Polls container `status_code` until FINISHED before publishing** — publishing an unfinished container is the classic "works manually, fails from a script" bug. Caption/carousel validation, `content_publishing_limit` quota read.
- `src/publish/config.py` — prefers the OAuth connection, falls back to `.env`; refuses expired tokens with a reconnect hint.
- `src/publish/http.py` — stdlib urllib only. **No new dependencies were added**; `requirements.txt` is unchanged.
- `src/templates/carousel.py` — new `carousel` template. Slide kinds `cover` / `point` / `cta`, progress dots, swipe hint, `normalize_slides()` validation.
- `posts/blog_carousel.json` — PI.1, the 5-slide blog promo, with a full written caption.
- `supabase-marketing-bucket.sql` — creates the public `marketing-public` bucket. **NOT YET RUN.**
- `.env.example` — Supabase keys only now (IG keys are legacy fallback).

## Files modified
- `src/renderer.py` — multi-slide path (`render_slides` when a template exposes it) + new `_slug_source()` so carousels name files off the first slide's hook. Without that fix every carousel wrote to `carousel_square_post_NN.png` and collided.
- `src/templates/__init__.py` — registered `carousel`.
- `README.md` — appended full Instagram publishing + carousel docs (now 279 lines).

## Verified working
- `python connect.py` → correct "not connected" status for both.
- `python publish.py --post posts/blog_carousel.json --dry-run` → renders 5 slides, prints caption (377/2200 chars).
- Missing-credential path fails with a clear, actionable message.
- All `.py` files parse clean.
- **Slides visually reviewed** — on-brand. Two layout fixes applied after review: `point` slides start at `H*0.24` (were hugging the top with a huge dead zone) and the `cta` tagline moved to `-140` off the footer (was crowding the progress dots).

## 🔴 BLOCKED ON TRE — cannot be done from code
1. **Meta app**: developers.facebook.com → Create app (Other → Business) → add Facebook Login → add redirect URI **exactly** `http://localhost:8723/callback` → save App ID + secret to `tre-forged-marketing/memory/meta_app.json` as `{"app_id": "...", "app_secret": "..."}`.
2. **IG account must be Business or Creator and linked to a Facebook Page.**
3. **Run `supabase-marketing-bucket.sql`** in the Supabase SQL editor (project `mdtosrbfkextcaezuclh`). It is additive (one public bucket + a read policy) but was deliberately **not** applied without Tre's say-so since a public bucket is outward-facing.
4. **`.env`**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

Tre said "you can go in chrome if needed" — he is open to being walked through step 1 via Chrome MCP. That had not started when the gate hit.

## TikTok caveats (real, not code bugs)
- TikTok documents redirect URIs as **HTTPS-only**, so `http://localhost:8723/callback` may be rejected. Fallback is a hosted callback on treforged.com.
- **Direct posting needs TikTok's app audit** for `video.publish`. Until approved, only `video.upload` (drafts finished in the app) works. The code already stores `can_post_directly` and says so on connect.

## ⏭️ NEXT (Part A) — the prioritization Tre asked for, in order
1. **Finish MB.1**: walk Tre through the Meta app in Chrome, run the bucket SQL, then `connect.py instagram` and post `blog_carousel.json` for real. Highest value: it unblocks everything else and turns the standing "every app update gets a post" commitment into something automatic.
2. **MB.3 — newest blog post on the app's main page.** Cheap, compounding, and reuses the blog pipeline. **Open question for Tre before building: does "main page" mean `Landing.tsx` or the logged-in Dashboard?** Needs a JSON feed emitted by `publish-next.mjs` (different repo) + a CSP check.
3. **MB.2 — brand SEO.** Add Organization + WebSite JSON-LD and `sameAs` to treforged.com root. Small, and it feeds MB.4. Sitemap/`llms.txt` are already done — do not redo.
4. **MB.5 — Reddit.** Cheapest immediate reach, but **confirm paid-vs-organic with Tre first**; the existing playbook is organic-only.
5. **MB.4 — AI chat tool recommendations.** Genuinely slow, no guaranteed lever; it is downstream of 2/3/5, so do it last.
6. **MB.6 — free-tier car builds.** Route to `project_roadmap`, not marketing. It is a product change (`Builds.tsx` is still premium) and depends on FB.6 + FB.7.

Also open: the **Reddit Scout double-schedule** (local Thursday-9PM Task Scheduler vs Supabase twice-daily cron) may be running redundantly, risking duplicate digests and doubled Gemini spend. Never resolved. See `marketing_reddit_scout` memory.

## Memory updated this session
`marketing_backlog.md` created (MB.1-6 + PI.1/PI.2, with MB.1 and PI.1 marked built), indexed in `MEMORY.md`, cross-linked from `marketing_plan.md`.

---

# PART B — Session 33 leftovers (STILL OPEN, higher stakes)

Session 33 shipped items 4 & 5 and pushed through `515fe48a`. Both store builds succeeded; **Android auto-deployed to Play production**. The code is live but **two Supabase dashboard steps were never done, so the email-verification work has no visible effect yet.**

## 🔴 DO THESE FIRST IF WORKING ON THE APP
Tre had already authorized these ("go into supabase and do it for me"). **Nothing was changed in Supabase.**
1. **Site URL** → project `mdtosrbfkextcaezuclh` → Authentication → URL Configuration → set `https://getforgenta.com`. Required because the template now uses `{{ .SiteURL }}`.
2. **Confirm signup template** → Authentication → Email Templates → Confirm signup → replace with `supabase-email-templates.html` **lines 9–122** (between the START/END markers, markers excluded).
   - ⚠️ Until BOTH are done, confirmation emails still use the old `supabase.co/auth/v1/verify` redirect and none of the app-link work does anything.

## ⏭️ ALSO STILL OPEN (Part B)
- **`supabase/functions/delete-account/index.ts` is STILL NOT DEPLOYED** (edited in `cd48de32`). Both deletion gaps — `subscriptions` rows + public `build-photos` objects — remain open **in production**. Deploy via Supabase MCP `deploy_edge_function` or CLI.
- Magic Link / Reset Password / Change Email / Invite templates share the same latent `token_hash` flaw as Confirm Signup; only Confirm Signup was fixed. Flag as follow-ups.
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
- Branch `main`, **working tree clean**, pushed through `515fe48a`. (Note: the `src/App.tsx` / `AuthCallback.tsx` / `supabase-email-templates.html` modifications listed at session start are no longer showing as dirty — they were committed and pushed in session 33.)
- Supabase project `mdtosrbfkextcaezuclh`.
- iOS signing risk is CLOSED — the regenerated profile with Associated Domains built successfully. No need to re-verify.
- Chrome MCP tab IDs do NOT survive `/clear` — call `tabs_context_mcp` fresh.
