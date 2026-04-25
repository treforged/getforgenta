# Implementation Plan: Budget OS Full Overhaul
## TRE Forged Budget OS — April 2026

---

## CONTEXT (read before starting ANY phase)

- Repo: treforged/webappredesign | Branch: main
- Stack: React + TypeScript + Supabase + Capacitor (iOS/Android) + Vercel
- Supabase project: mdtosrbfkextcaezuclh
- **Never auto-push.** Commit locally only. User reviews before push.
- **Backup all modified files** to `./backups/YYYY-MM-DD_HHMMSS/` before editing.
- Mobile and web are SEPARATE environments — never mix native-only features into web paths.
- This is a financial app — data integrity is highest priority.
- **Phase tracking:** When a phase/step is finished, move it to COMPLETED with a one-line summary and DELETE its detail section from the plan. Never leave stale instructions for completed work.
- **Supabase migrations:** Never tell the user to run `supabase db push`. Always provide the raw SQL to paste into the Supabase SQL Editor (Dashboard → SQL Editor, project mdtosrbfkextcaezuclh).

### COMPLETED — DO NOT TOUCH
- Horizontal overflow (AiAdvisor, BudgetControl, Forecast)
- MFA bypass + passkey button relabel
- Typography standardization
- Android versionCode/versionName
- iOS CI pbxproj fix
- Full code audit for regressions
- 2FA audit (password login requires 2FA; passkey bypasses it — confirmed correct)
- **Phase 1 — Plaid Sync** (commit aee87a0)
  - 1A: Post-link sync scoped to newly added institution only
  - 1B: Daily cron fixed — premium gate added to plaid-sync-all; cron re-scheduled via Vault secret
  - 1C: Sync Now button removed; per-institution relative-time + amber stale indicator added
- **Phase 2 — Auth Page Redesign** (Auth.tsx)
  - 2A: Landing view added — animated FORGED logo + staggered CTAs (Start Free / Sign In / Try Demo); demo login wired to setIsDemo
  - 2B: No biometric UI found on web — passkey is WebAuthn (correct); no changes needed
  - 2C: Passkey expired UX — auto-switch to login mode + amber banner on token expiry/missing
  - 2D: Trusted devices — migration (trusted_devices jsonb on profiles), MFA skip for trusted device, trust prompt after MFA verify, Settings revoke list
- **Phase 3 — Onboarding + Founder's Note** (commit ff640e3)
  - 3A: FounderNoteModal — first-login-only full-screen modal with Tre's founder note; writes founder_note_seen=true on dismiss
  - 3B/C: OnboardingWizard — 4-step dashboard overlay for new users; step 1 has 2-stage premium upsell (Plaid for premium, skip for free); steps 2–4 navigate to /budget, /debt, /savings; sessionStorage dismissal
  - 3D: OnboardingChecklist — replaces old inline widget; dynamic check of plaid_items/accounts/income/debts/goals; auto-fades + writes onboarding_completed=true when all done

---

## PHASE 4 — COSMETIC FIXES

### 4A. Anvil logo redesign

**Current state:** No SVG anvil logo component exists. Auth page and Sidebar use text "FORGED" only.

**Target:** SVG anvil matching the favicon silhouette (flat top face, horn on left, stepped base).

**New file:** `src/components/shared/ForgedLogo.tsx`
- Export a React SVG component with `width`/`height`/`className` props
- Silhouette must match `public/favicon.ico` — read the favicon visually and trace the shape
- Classic anvil profile: flat top, left horn, trapezoidal body, wide stepped base

**Usage locations:**
- `src/pages/Auth.tsx` — replace "FORGED" text in all 4 mode headers with `<ForgedLogo />` + wordmark
- `src/components/layout/Sidebar.tsx:44` — `<ForgedLogo />` + "FORGED" when expanded, icon-only when collapsed
- `src/components/shared/AppLockScreen.tsx:72` — add to lock screen branding

---

### 4B. Remove hover styles from decorative feature cards

**Search:** `grep -r "cursor-pointer" src/pages/Premium.tsx src/pages/Accounts.tsx`

**Fix:** Remove `cursor-pointer`, hover background, hover border classes from cards that have no `onClick`. Keep hover only on genuinely interactive elements.

---

## PHASE 5 — EXPORT PDF/CSV ON MOBILE NATIVE

**Root cause:**
- `src/lib/exportPdf.ts`: uses `window.open('', '_blank')` — blocked on Capacitor WebView
- `src/lib/exportCsv.ts`: uses `<a>.click()` with `createObjectURL` — doesn't trigger download on native

**Fix:** Use `@capacitor/share` + `@capacitor/filesystem` for native paths; keep existing web paths.

**Check if already installed:** `grep -i "@capacitor/share\|@capacitor/filesystem" package.json`
If not: `npm install @capacitor/share @capacitor/filesystem`

**exportCsv.ts — native path:**
```ts
if (Capacitor.isNativePlatform()) {
  const { Filesystem } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  await Filesystem.writeFile({ path: filename, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title: 'Forged Transactions', url: uri });
} else {
  // existing <a>.click() path
}
```

**exportPdf.ts — native path:**
- Build HTML string as before
- Write to `.html` temp file via Filesystem, share via Share plugin
- On web: keep existing `window.open` + print flow

---

## PHASE 6 — ACCOUNT CONNECTION LIMIT (change to 10)

**Audit first:**
```bash
grep -r "account.*limit\|max.*account\|3 account\|5 account\|free.*account\|MAX_FREE" src/ supabase/
```

**Files likely involved:**
- `src/components/shared/PremiumGate.tsx`
- `src/pages/Accounts.tsx`
- Any UX messaging strings about account counts

**Change everywhere:** free tier limit → 10. Update display strings, validation, gating logic.

---

## PHASE 7 — DASHBOARD VALUE DENSITY

**Audit `src/pages/Dashboard.tsx` first.** Then add:

1. **"What's changed"** — this month vs last month for key metrics (cash, net worth, expenses)
2. **"On Track" indicator** — meeting savings rate / debt paydown target?
3. **Proactive action items** — "You're $240 over in Dining", "Auto loan pays off in 8 months"
4. **Goal progress** — mini progress bars for active savings goals
5. **Onboarding checklist** (Phase 3D) mounts here when incomplete

---

## PHASE 8 — TRANSACTION CATEGORIZATION

1. **Quality audit** of current category assignment logic
2. **Inline correction:** single tap on category → dropdown picker, saves immediately (no modal)
3. **Rule learning:**
   - New table: `categorization_rules (id, user_id, merchant_pattern text, category text, created_at)`
   - On correction: upsert rule for that merchant pattern
   - On transaction import: check rules before applying default category

---

## PHASE 9 — PREMIUM UX SURFACES

Contextual, honest upgrade surfaces:
- Accounts page: when free user tries Plaid link → explain what premium gets them (inline, not popup)
- AI Advisor: when free user hits limit → upgrade prompt in chat UI
- Forecast: when accuracy limited by no Plaid data → "Connect accounts for live data" callout
- Settings: clean comparison table (free vs premium)

---

## PHASE 10 — IN-APP PURCHASE COMPLIANCE

**RevenueCat is already partially integrated** (`supabase/functions/revenuecat-webhook/`, `supabase/migrations/20260423_add_revenuecat_fields.sql`).

**Path forward:**
1. Complete RevenueCat project setup (link Apple App Store + Google Play + Stripe)
2. Install `purchases-capacitor` plugin for mobile IAP
3. Gate mobile entitlement checks through RevenueCat SDK (not raw Supabase queries)
4. Verify `revenuecat-webhook` correctly updates `user_subscriptions` on purchase events
5. Web stays on Stripe; mobile uses native billing routed through RevenueCat

**This is a large multi-session effort — plan a dedicated session before starting.**

---

## PHASE 11 — NATIVE MOBILE POLISH

1. **Safe areas:** verify `env(safe-area-inset-*)` on all pages, especially notch on iPhone 15 Pro
2. **Keyboard push-up:** form inputs don't hide behind software keyboard on iOS
3. **Bottom nav tap targets:** MobileNav items ≥ 44px
4. **Form inputs ≥ 16px:** prevents iOS auto-zoom on focus
5. **Swipe gestures:** swipe-back must not conflict with horizontal tab swipes

---

## PHASE 12 — COMPETITIVE BENCHMARKING

**Reference apps:** Copilot, Monarch Money, Origin, YNAB

**Deliverable:** `.claude/plan/competitive-analysis.md` with 3-5 specific patterns to adopt
and where Forged differentiates. Research only — no code changes.

---

## EXECUTION ORDER

```
Phase 1A → 1B → 1C   ✓ DONE
Phase 4B              ✓ DONE (no cursor-pointer found — already clean)
Phase 2A → 2B         ✓ DONE
Phase 2C → 2D         ✓ DONE
Phase 3A              ✓ DONE
Phase 3B → 3C → 3D   ✓ DONE
Phase 4A              (Anvil logo — needs favicon reference)
Phase 5               (Export fix — check @capacitor/share first)
Phase 6               (Account limit — audit then change)
Phase 7               (Dashboard value density)
Phase 8               (Transaction categorization)
Phase 9               (Premium UX surfaces)
Phase 10              (IAP — dedicated session)
Phase 11              (Native mobile polish)
Phase 12              (Competitive benchmarking — research)
```

---

## KEY FILES REFERENCE

| File | Phase | Note |
|------|-------|------|
| `src/components/shared/PlaidLinkButton.tsx:112-116` | 1A | Post-link sync needs item_id scoping |
| `supabase/functions/plaid-exchange-token/index.ts` | 1A | Return plaid_item_id in response |
| `supabase/functions/plaid-sync/index.ts:184` | 1A | Add item_id filter to sync loop |
| `supabase/functions/plaid-sync-all/index.ts:61` | 1B | Add premium user filter |
| `supabase/migrations/20260423_setup_plaid_daily_cron.sql:31` | 1B | Placeholder secret — investigate first |
| `src/pages/Accounts.tsx:478-488` | 1C | Remove "Sync now" button |
| `src/hooks/usePlaidItems.ts:118-126` | 1C | Remove syncNow from return object |
| `src/pages/Auth.tsx` | 2A/2B | Full redesign |
| `src/lib/exportCsv.ts` | 5 | Add Capacitor Share path |
| `src/lib/exportPdf.ts` | 5 | Add Capacitor Share path |
| `src/components/shared/PremiumGate.tsx` | 6 | Account limit check |
| `src/pages/Dashboard.tsx` | 7 | Add value-density widgets + checklist |

---

## RISKS

| Risk | Mitigation |
|------|------------|
| Cron secret placeholder = Phase 1B may need Supabase dashboard action first | Verify via MCP before writing any code |
| RevenueCat IAP is a multi-week effort | Scope to dedicated session; don't start mid-session |
| Auth page redesign is high-visibility | Test on web and native before committing |
| Passkey full WebAuthn rewrite is risky | Fix UX only now; defer server-side verification |
| Founder's note copy needs Tre's voice | Use draft above; refine before shipping |

---

**Plan saved. Start each session by stating which Phase you want to work on.**
**Phase 1 has the highest user impact and root causes are already fully identified.**
