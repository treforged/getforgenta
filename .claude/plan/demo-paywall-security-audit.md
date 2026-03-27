# Implementation Plan: Demo Paywall Bypass + Security Audit

**Date:** 2026-03-26
**Tasks:** 2 — demo paywall bypass (immediate) + security hardening (audit-then-confirm)

---

## TASK 1 — Remove paywall from demo mode

### Diagnosis

`useSubscription.ts:31` explicitly sets `isPremium = false` for demo users:
```ts
const isPremium = isDemo ? false : query.data?.plan === 'premium' && ...
```

`isPremium` then flows to two `PremiumGate` usages:
- `Dashboard.tsx:663` — `<PremiumGate isPremium={isPremium} ...>`
- `NetWorth.tsx:298` — `<PremiumGate isPremium={isPremium} ...>`

`PremiumGate` is the single rendering gate — if `isPremium` is truthy, it renders
children; otherwise it renders the blurred lock overlay.

### Why NOT to change `useSubscription.ts`

Changing `isPremium = isDemo ? true : ...` in the hook would also affect:
- `Premium.tsx` — would show "Your Premium Plan" and "Manage Billing" for demo users
  (which would throw a 404 since there's no Stripe customer in demo mode)
- `Settings.tsx:229` — would show billing subscription details for demo

That would change what "demo mode" means. Not acceptable per requirements.

### Correct fix: change only the two call sites

At `Dashboard.tsx:663` and `NetWorth.tsx:298`, pass `isPremium || isDemo`
as the gate prop. This bypasses the lock in demo mode without touching
`useSubscription` or the billing UI.

```diff
// Dashboard.tsx
- const { isDemo } = useAuth();             // already imported at :99
- const { isPremium } = useSubscription();  // already imported at :100
+ // no new imports needed

- <PremiumGate isPremium={isPremium} message="Unlock advanced analytics with Premium">
+ <PremiumGate isPremium={isPremium || isDemo} message="Unlock advanced analytics with Premium">

// NetWorth.tsx
- const { isDemo } = useAuth();             // already imported at :46
- const { isPremium } = useSubscription();  // already imported at :47
+ // no new imports needed

- <PremiumGate isPremium={isPremium} message="Unlock unlimited account tracking with Premium">
+ <PremiumGate isPremium={isPremium || isDemo} message="Unlock unlimited account tracking with Premium">
```

### Files changed
| File | Operation | Line | Change |
|------|-----------|------|--------|
| `src/pages/Dashboard.tsx` | Modify | :663 | `isPremium` → `isPremium \|\| isDemo` |
| `src/pages/NetWorth.tsx` | Modify | :298 | `isPremium` → `isPremium \|\| isDemo` |

### Risks
| Risk | Mitigation |
|------|------------|
| Other future `PremiumGate` usages won't get demo bypass | Acceptable — they'll need the same one-liner fix when added; no silent regression |
| Demo user could screenshot "premium" content | Expected behavior — demo mode is controlled by the app, not exploitable |

---

## TASK 2 — Security Audit (REPORT FIRST, FIX AFTER CONFIRMATION)

### Audit Methodology

Source code was audited across:
- All Edge Functions (`create-checkout`, `create-portal-session`, `stripe-webhook`)
- All client-side auth and API code
- `src/integrations/supabase/client.ts` and `src/lib/supabase.ts`
- `src/pages/Auth.tsx` (signIn/signUp)
- Database schema via `src/integrations/supabase/types.ts`
- All env var references

**RLS CANNOT be confirmed from source code alone** — no migration files exist in
`supabase/migrations/`. The DB was configured manually. RLS status must be verified
against the live database.

---

### SECURITY FINDINGS

#### FINDING 1 — MEDIUM: RLS status unknown (no migration files)
**Severity:** MEDIUM (could be CRITICAL if RLS is off)
**Location:** All 13 tables in Supabase DB
**Tables with user_id (need RLS + row-ownership policies):**
  `accounts`, `assets`, `budget_items`, `car_funds`, `debts`, `liabilities`,
  `profiles`, `recurring_rules`, `savings_goals`, `subscriptions`,
  `transactions`, `user_subscriptions`
**Tables without user_id (public/reference tables — need read-only policy):**
  `subscription_tiers`

**What to verify:**
Run in Supabase SQL Editor:
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```
Expected: `rowsecurity = true` for every table.
Also check existing policies:
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Proposed fix (if RLS is missing on any user-data table):**
```sql
-- Template for each user-data table (replace TABLE_NAME):
ALTER TABLE public.TABLE_NAME ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_rows" ON public.TABLE_NAME
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- For subscription_tiers (no user_id, public read-only):
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON public.subscription_tiers
  FOR SELECT USING (true);
```

---

#### FINDING 2 — LOW: `VITE_SUPABASE_PUBLISHABLE_KEY` exposed to browser
**Severity:** LOW (by design — this is the Supabase anon key)
**Location:** `src/integrations/supabase/client.ts:5`
**Detail:** The variable name `PUBLISHABLE_KEY` is intentional and correct. Supabase anon
keys are designed to be public and are safe when RLS is properly enforced. This is NOT
a bug — it is the standard Supabase client-side pattern.
**Action required:** None, UNLESS RLS is missing (Finding 1). If RLS is off, the anon
key becomes a CRITICAL exposure because any user can read/write all rows.

---

#### FINDING 3 — LOW: No application-level rate limiting on signIn/signUp
**Severity:** LOW (Supabase provides infrastructure-level rate limiting by default)
**Location:** `src/pages/Auth.tsx:16` (`signInWithPassword`) and `:21` (`signUp`)
**Detail:** The Auth.tsx form has no client-side submission throttle. Supabase's Auth
service has built-in rate limits (default: 30 requests/hour for signUp, 10/minute for
signInWithPassword per IP). However:
- Supabase rate limits are per-IP and can be bypassed with distributed requests
- No CAPTCHA or turnstile on the signup form
- The form does not disable the submit button for a cooldown period after errors

**Proposed fix (if desired):**
- Add a client-side cooldown: after a failed auth attempt, disable submit for 3 seconds
- Optionally enable Supabase's built-in bot protection (Turnstile) in the Supabase dashboard
  under Authentication → Bot and Abuse Protection
- This is a low-priority UI improvement, NOT a code vulnerability

---

#### FINDING 4 — LOW: Open redirect risk in `create-portal-session` return_url
**Severity:** LOW (mitigated by JWT requirement)
**Location:** `supabase/functions/create-portal-session/index.ts:57-58`
**Detail:**
```ts
const { return_url } = await req.json();
const origin = return_url || req.headers.get("origin") || "https://app.treforged.com";
// ... used as: return_url: `${origin}/premium`
```
The `return_url` from the request body is passed directly to Stripe's billing portal
as the `return_url`. Since Stripe whitelists return URLs in the Dashboard settings, this
is partially mitigated. However an attacker with a valid session token could craft a
request with a spoofed `return_url`. Since this requires a valid authenticated JWT, the
attack surface is limited to your own authenticated users.

**Proposed fix:**
```ts
// Whitelist origin — ignore client-provided return_url, use request Origin header
const origin = req.headers.get("origin") || "https://app.treforged.com";
```

---

#### FINDING 5 — CONFIRMED SAFE: User ID derived from JWT, not request body
**Severity:** N/A (no issue found)
**Location:** All three Edge Functions
**Detail:** All functions extract `userId` from `supabase.auth.getClaims(token)`, never
from `req.json()`. This is correct.

---

#### FINDING 6 — CONFIRMED SAFE: No hardcoded secrets in source code
**Severity:** N/A (no issue found)
**Detail:** All secrets (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY)
are read via `Deno.env.get()` in Edge Functions. Client code uses only `import.meta.env`
for VITE_ prefixed vars. No raw tokens or credentials found in `.ts`/`.tsx` files.

---

### Summary Table

| # | Finding | Severity | Requires DB access to verify | Proposed fix |
|---|---------|----------|-------------------------------|--------------|
| 1 | RLS status unknown | MEDIUM→CRITICAL | YES | Enable RLS + ownership policies on all tables |
| 2 | Anon key exposed to browser | LOW | NO | None (correct pattern; only critical if RLS is off) |
| 3 | No app-level auth rate limiting | LOW | NO | Client cooldown + optional Turnstile |
| 4 | Open redirect in portal return_url | LOW | NO | Use request Origin header instead of body value |
| 5 | User ID from JWT ✓ | SAFE | — | None |
| 6 | No hardcoded secrets ✓ | SAFE | — | None |

---

### What must happen BEFORE any fixes

Per requirements: "Report ALL security issues found before making any fixes so I can
review them first."

**This plan IS the report. No fixes will be applied until you confirm.**

After you review, confirm which findings to fix (e.g., "fix all" or "fix 1, 4 only").
The RLS fix (Finding 1) requires verifying the SQL results above first.

---

## Execution Order (after confirmation)

```
TASK 1 (no security review needed — low risk UI change):
1. Backup Dashboard.tsx and NetWorth.tsx
2. Edit Dashboard.tsx:663
3. Edit NetWorth.tsx:298
4. Commit locally

TASK 2 (only after you confirm each finding to fix):
1. You run the SQL verification queries in Supabase dashboard
2. Share results → Claude generates precise migration SQL
3. Backup and apply fixes to confirmed findings
4. Commit locally
```

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
