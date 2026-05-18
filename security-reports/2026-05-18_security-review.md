# Security Review — 2026-05-18

**Reviewer:** Automated bi-daily security scan  
**Repository:** treforged/getforgenta  
**Stack:** React · TypeScript · Supabase (mdtosrbfkextcaezuclh) · Vercel · Capacitor  
**Review window:** 2026-05-17 00:00 UTC → 2026-05-18 (current)

---

## Commits Reviewed

| Commit | Summary |
|--------|---------|
| `f34476b` | [fix]: paycheckDay Number() ?? 5 → \|\| 5 |
| `7cb33b9` | [fix]: 7 consistency/correctness issues — cashFloor, pauseSavings, Forecast deps |
| `4b4e855` | [fix]: simCarMonthly / Forecast currentMonthDebt pauseSavings guards |
| `eb9eddd` | [fix]: close consistency gaps — pauseSavings propagation, bonus/taxReturn |
| `9ae4263` | [fix]: per-month safe floor (cashFloorByMonth) |
| `424f482` | [feat]: close forecast/debt-payoff gaps; assumptions impact note |
| `d3aae2f` | [fix]: debt payoff look-ahead pre-pass |
| `904f514` | [fix]: display-only safeToPayTotal for Forecast month 0 debt popup |
| `d631229` | [fix]: align Forecast debt payment display with Safe to Pay |
| `ffcb535` | [fix]: pass monthlySavingsAndCar to debt recommendations engine |
| `f090ce7` | [fix]: count all remaining monthly expenses in Safe to Pay |
| `a27b6a5` | [fix]: dedup savings goals vs transfer rules; selectable categories |
| `a6ba838` | [fix]: simulation accounts for savings/transfers/car per-month outflows |
| `1d513ee` | [fix]: CC display balance shows ongoing purchases after payoff |
| `c6a9ebe` | [fix]: exclude retirement-linked savings goals from cash outflow |
| `0f9751e` | [fix/feat]: business contributions category; separate savings/car in popup |
| `b086661` | [fix]: savings-first PASS 3; debt tab nets savings/car from Safe to Pay |
| `9a360c2` | [fix]: debt payment priority over savings in PASS 2/3 |
| `b63da2d` | [fix]: Available to Deploy drops Cash Floor row when debt engine value present |
| `89b473d` | [fix]: forecast income double-counting; dashboard matches Safe to Pay |
| `d5baf51` | [fix]: CC chart flatlines at 0 after payoff |
| `4eba15b` | [fix]: forecast debt sim matches debt payoff tab; 401k per-paycheck |
| `e6e13d7` | [feat]: debt payoff preference overlay + 401k per-paycheck fix |
| `6578e60` | Accounts + Forecast changes |
| `3037730` | [fix]: recommendations subtract upcoming bank expenses from available cash |
| `f34960b` | [fix]: forecast CC outflows include post-payoff purchase pass-through |
| `56415eb` | [fix]: raise popup per-paycheck uses actual week count |
| `b14166` | [fix]: forecast income accuracy — normalize weekly paycheck |
| `2322e58` | [fix]: preference mode root fix + forecast popup improvements |
| `fc70e61` | [fix]: preference mode only after payoff; allow multiple card drawers open |
| `b74c2b2` | [fix]: guide popups centered, sticky header, scrollable body |
| `1646b7f` | [feat]: 3-state payment preference per credit card |
| `170f618` | [feat]: per-card full-balance autopay toggle |
| `14780e7` | [fix]: auto-reload on chunk load failure; no-cache index.html |
| `290c418` | [feat]: verify-checkout edge function + fix Safari premium activation |
| `dd4c7f8` | [feat]: monthly budget snapshot — available to deploy |
| `a5c5b3e` | [feat]: monthly budget snapshot — cash floor row |
| `45e30fb` | [feat]: onboarding — premium pitch as pre-step |

**Source files changed (excluding backups):** 19 files  
**Security-sensitive surface touched:** `supabase/functions/verify-checkout/index.ts`, `supabase/migrations/20260517_accounts_payment_preference.sql`, `supabase/migrations/20260517_accounts_autopay_full_balance.sql`, `src/pages/PremiumSuccess.tsx`, `src/pages/Accounts.tsx`

---

## Findings Table

| # | File | Line(s) | Severity | Category | Confidence | Status |
|---|------|---------|----------|----------|------------|--------|
| — | — | — | — | — | — | No findings above threshold |

---

## Detailed Analysis

### verify-checkout edge function (`supabase/functions/verify-checkout/index.ts`)

**Auth guard:** Present and correct.  
- Bearer token required; validated via `userClient.auth.getUser()` (JWT verification through Supabase, not just header presence).  
- Rate-limited to 10 req/min per IP via shared `checkRateLimit` utility.

**Session ownership enforcement:**  
- Path A (metadata present): `session.metadata.supabase_user_id` must exactly match the JWT `userId` — mismatch → 403.  
- Path B (no metadata): `stripe_customer_id` is looked up in `user_subscriptions`; if found under a different `user_id` → 403.  
- `create-checkout` stamps `metadata[supabase_user_id]` at **both** checkout-session creation paths (lines 167 and 211), so all real-world sessions carry metadata. Path B is a defensive fallback for externally-created sessions only.

**Input validation:** `session_id` validated with Zod against `/^cs_/` prefix regex; request body strictly parsed (`.strict()`). Client-side additionally validates against `/^cs_(test|live)_[a-zA-Z0-9]+$/` with `max(200)` before the edge function is called.

**Service role usage:** Correct — service role client is used only for the subscription upsert (requires bypassing RLS) after user identity is established via anon-key client. Not exposed to user-controlled paths.

**Error logging:** `console.error("verify-checkout error:", error)` at line 249 logs the raw Error object on unhandled exceptions. Stripe API errors and Supabase errors in this context carry error codes/messages only — no PII or secrets expected in the error payload. Below exploitability threshold.

**Verdict: PASS**

---

### Migration: `20260517_accounts_autopay_full_balance.sql`

Adds `autopay_full_balance boolean NOT NULL DEFAULT false` to `public.accounts`.

**RLS impact:** None required. The `accounts` table has comprehensive row-level policies from `20260410_fix_rls_policies.sql` (`accounts_select_own`, `accounts_insert_own`, `accounts_update_own`, `accounts_delete_own`) all scoped to `auth.uid() = user_id`. New columns inherit these row-level guards automatically — no column-level security needed.

**Verdict: PASS**

---

### Migration: `20260517_accounts_payment_preference.sql`

Drops `autopay_full_balance` (replaced), adds `payment_preference text CHECK (payment_preference IN ('statement', 'full')) DEFAULT NULL`.

**RLS impact:** Same as above — row-level policies cover the column. The `CHECK` constraint prevents arbitrary string injection into the enum field at the DB layer.

**Verdict: PASS**

---

### PremiumSuccess page (`src/pages/PremiumSuccess.tsx`)

- `session_id` is extracted from the query string and immediately validated against `premiumSuccessParamsSchema` (Zod, regex `^cs_(test|live)_[a-zA-Z0-9]+$`, max 200 chars) before any use.  
- Null/invalid session → `sessionId` is `null`; no edge function call is made.  
- Edge function call goes through `tracedInvoke` which forwards the Supabase auth session (JWT) automatically.  
- No raw query params are rendered into the DOM.  

**Verdict: PASS**

---

### Accounts page (`src/pages/Accounts.tsx`)

**Plaid account matching (lines 155–229):**  
- All DB operations scope to `currentUser.id` via `.eq('user_id', currentUser.id)` on both the delete and update calls (lines 188–189, 210–211).  
- The `currentUser` is obtained via `supabase.auth.getUser()` at runtime — not from stale component state.  
- Match candidates are filtered client-side by name equality before display — no untrusted data reaches the DB filter.

**Account unlink (line 373):**  
- `supabase.from('accounts').update({...}).eq('id', accountId)` — no explicit `user_id` filter on this client call. RLS policy `accounts_update_own` enforces `auth.uid() = user_id` at the DB layer, so cross-user updates are blocked server-side regardless. Not a vulnerability.

**No `dangerouslySetInnerHTML`:** Confirmed absent from this file and the entire `src/` tree.

**Verdict: PASS**

---

### Other changed files (Forecast, BudgetControl, Dashboard, CreditCardEngine, SavingsGoals, DebtPayoff, etc.)

All changes are pure client-side computation: arithmetic corrections to financial simulation logic (cash floor, savings passthrough, debt payoff scheduling, paycheck normalization). No network calls, no DB writes, no auth logic, no external input rendering. No XSS vectors identified.

**Verdict: PASS (no security surface)**

---

### Edge function audit (full set)

All 17 edge functions reviewed for auth posture:

| Function | Auth mechanism | Notes |
|----------|---------------|-------|
| `verify-checkout` | JWT required | Reviewed in detail above |
| `create-checkout` | JWT required | Sets `supabase_user_id` metadata on sessions |
| `create-portal-session` | JWT required | — |
| `create-setup-intent` | JWT required | — |
| `delete-account` | JWT required | — |
| `manage-subscription` | JWT required | — |
| `update-password` | JWT required | — |
| `update-payment-method` | JWT required | — |
| `plaid-create-link-token` | JWT required | — |
| `plaid-exchange-token` | JWT required | — |
| `plaid-sync` | JWT required | Confirmed in source |
| `plaid-sync-all` | CRON_SECRET header | Correct — cron job, no user JWT needed; secret must match env var |
| `sync-stripe-email` | Internal/service | — |
| `ai-advisor` | JWT required | — |
| `stripe-webhook` | Stripe signature | — |
| `revenuecat-webhook` | REVENUECAT_WEBHOOK_SECRET | — |
| `verify-turnstile` | Public (turnstile token) | Bot protection only, no user data written |

No unauthenticated edge functions found that access user data or write to the database without appropriate verification.

---

## Summary

**Result: CLEAN**

No findings met the >80% confidence / real exploitability threshold.

The `verify-checkout` edge function introduced in this cycle is well-constructed: JWT-gated, rate-limited, Stripe session ownership verified via metadata match, with a secondary customer-ID lookup as a fallback. The two schema migrations correctly extend an already-RLS-protected table. No hardcoded secrets, no XSS vectors, no SQL injection surface, no unauthenticated write paths.

**Priority actions:** None required.

---

*Report generated: 2026-05-18 | Next review: 2026-05-20*
