# Security Review — 2026-06-13

**Project:** TRE Forged Budget OS (Forgenta)  
**Repository:** treforged/getforgenta  
**Reviewer:** Automated bi-daily security agent  
**Review window:** 2026-06-11 → 2026-06-13  

---

## Commits Reviewed

| Commit | Description |
|--------|-------------|
| `3970ae7` | [builds/share]: add print-to-PDF support |
| `ac52a7c` | [builds]: fix stale dragItemOrder |
| `b3a04e2` | [free-tier]: expand free preview windows |
| `c30015d` | [fixes]: resolve console warnings on Transactions |
| `33361b9` | [builds]: optimistic updates, fix item sort order |
| `d342bd4` | [builds]: revert phase title to truncate |
| `4d67c98` | [builds/share]: add border container to Disable button |
| `9ff8a94` | [builds/share]: fix panel layout + use Browser.open |
| `88fe78d` | [builds/share]: fix broken share links |
| `11ef13d` | [builds/share]: restore 'Powered by Forgenta' text |
| `5051ad2` | [builds/share]: button styling + exclude planned |
| `5326ec0` | [builds/share]: toggle to include planned phases |
| `c24acfc` | [builds/share]: exclude hidden-phase items from budget |
| `6a3cdc0` | [builds/share]: show owner display name |
| `0ee13f2` | [debt]: add statement balance phase toggle |
| `fcea223` | [builds/share]: fix scroll + collapsible phases |
| `497d14b` | [builds/share]: show all phases including planned |
| `027403f` | [debt]: include current-month CC plan charges |
| `2981b43` | [builds]: fix drag insertion + shareable build links |
| `b87a7b7` | [debt]: inject CC payment plan charges into accordion |
| `90673db` | [payment-plans]: inject CC-sourced plan charges |
| `ff185c5` | [payment-plans]: fix plan expenses missing from month 0 |
| `15ef8f7` | [payment-plans]: wire plan cash expenses into CC engine |
| `ba1905d` | [transactions]: add payment plans feature |
| `aba8a6c` | [builds]: validate item URL — block save if not http(s) |
| `fa99bbc` | [builds]: fix phase hide/show optimistic update |
| `4ba5935` | [builds]: fix phase/item reorder |
| `e50555` | [builds]: remove C5 seed check |
| `eba44bb` | [builds]: update header label |
| `9b75006` | [builds]: guard C5 seed against DB-injected data |
| `ed575a1` | [builds]: add Car Build Tracker with Supabase persistence |
| `605027b` | [security]: add 2026-06-11 bi-daily security review report |

**Files analyzed:** `src/pages/BuildShare.tsx`, `src/pages/Builds.tsx`, `src/hooks/useSupabaseData.ts`, `src/components/builds/PhaseBlock.tsx`, `supabase/migrations/20260612_car_builds.sql`, `supabase/migrations/20260612_payment_plans.sql`

**Live DB consulted:** Yes — Supabase project `mdtosrbfkextcaezuclh` (column schema + RLS policies verified)

---

## Findings Table

| # | File / Location | Line | Severity | Category | Confidence |
|---|----------------|------|----------|----------|------------|
| F1 | `profiles` table — public RLS policy (live DB) | — | **CRITICAL** | Sensitive Financial Data Exposure | 95% |
| F2 | `car_builds` / `car_build_phases` / `car_build_items` — public RLS policies (live DB) | — | **HIGH** | Authorization Bypass / Enumeration | 92% |
| F3 | `supabase/migrations/20260612_car_builds.sql` | all | **MEDIUM** | Schema Drift — untracked security policies | 100% |

---

## Detailed Findings

---

### F1 — CRITICAL: Public RLS on `profiles` exposes full financial profile

**Severity:** CRITICAL  
**Category:** Sensitive Data / PII Exposure  
**Confidence:** 95%

#### What was applied to the live database

A public SELECT policy was added directly to the `profiles` table (not tracked in any migration file):

```sql
-- Policy name: "Public can view display_name of shared build owners"
using (EXISTS (
  SELECT 1 FROM car_builds cb
  WHERE cb.user_id = profiles.user_id
    AND cb.share_token IS NOT NULL
))
```

#### The problem

This policy grants anonymous (unauthenticated) SELECT access to the **entire `profiles` row** for any user who has enabled build sharing. The profiles table contains highly sensitive financial data:

| Column | Sensitivity |
|--------|-------------|
| `monthly_income_default` | User's net monthly income |
| `gross_income` | User's gross income |
| `tax_rate` | User's effective tax rate |
| `weekly_gross_income` | User's gross weekly pay |
| `cash_floor` | User's target cash buffer |
| `paycheck_frequency` / `paycheck_day` | Paycheck schedule |
| `deduction_401k_value` | 401k contribution amount |
| `deduction_hsa` | HSA contribution amount |
| `deduction_fsa` | FSA contribution amount |
| `deduction_medical` | Medical deduction amount |
| `paycheck_deductions` | Full deductions JSONB |
| `trusted_devices` | Device fingerprint JSONB (security-sensitive) |
| `forecast_assumptions` | Forecast config JSONB |

The application code correctly requests only `select('display_name')` at `useSupabaseData.ts:1078`. However, RLS in PostgreSQL is row-level — it controls which **rows** are visible, not which **columns**. The anon key is embedded in the JavaScript bundle and is publicly visible to any user who inspects the app.

#### Exploit scenario

```http
GET https://mdtosrbfkextcaezuclh.supabase.co/rest/v1/profiles?select=*
apikey: <anon_key_from_js_bundle>
Authorization: Bearer <anon_key_from_js_bundle>
```

Returns the **full financial profile** of every user who has enabled build sharing: income, tax rate, 401k/HSA/FSA deductions, device trust list.

No brute force or token guessing required. This is a direct read against a table the anon role can now SELECT from.

#### Fix

The correct approach is one of the following (in order of preference):

**Option A — Recommended: Denormalize `display_name` onto `car_builds`**
```sql
ALTER TABLE public.car_builds ADD COLUMN IF NOT EXISTS owner_display_name text;
-- Remove the profiles public policy entirely
DROP POLICY "Public can view display_name of shared build owners" ON public.profiles;
-- When a build is shared, copy display_name to car_builds.owner_display_name server-side
```
No cross-table join needed at query time, no profiles exposure.

**Option B: Use a SECURITY DEFINER view**
```sql
DROP POLICY "Public can view display_name of shared build owners" ON public.profiles;

CREATE VIEW public.public_build_owner_names
  WITH (security_barrier = true) AS
  SELECT p.user_id, p.display_name
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.car_builds cb
    WHERE cb.user_id = p.user_id AND cb.share_token IS NOT NULL
  );

GRANT SELECT ON public.public_build_owner_names TO anon;
```
The view restricts to only `display_name`, and `security_barrier` prevents filter push-down leakage.

**Option C: Column-level privileges**
```sql
DROP POLICY "Public can view display_name of shared build owners" ON public.profiles;
-- Grant anon role column-level SELECT only on display_name
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (user_id, display_name) ON public.profiles TO anon;
-- Re-add the policy restricted to those two columns
```
Note: PostgREST respects column-level grants, so `select=*` would only return `user_id` and `display_name` to anon callers.

---

### F2 — HIGH: Public RLS on build tables allows full enumeration without token

**Severity:** HIGH  
**Category:** Authorization Bypass / Information Disclosure  
**Confidence:** 92%

#### What was applied to the live database

Three public SELECT policies were added directly to the live database (not in migration files):

```sql
-- car_builds
using (share_token IS NOT NULL)

-- car_build_phases
using (EXISTS (
  SELECT 1 FROM car_builds cb
  WHERE cb.id = car_build_phases.build_id AND cb.share_token IS NOT NULL
))

-- car_build_items
using (EXISTS (
  SELECT 1 FROM car_builds cb
  WHERE cb.id = car_build_items.build_id AND cb.share_token IS NOT NULL
))
```

#### The problem

The intended security model for public sharing is a **"secret link"** pattern: a UUID token is generated and embedded in the share URL. Only someone who has the URL can view the build. This is a reasonable pattern when the token is a 128-bit UUID (astronomically hard to guess).

However, these RLS policies don't enforce that the requester knows the token. They only check that **a token exists**. Because the Supabase anon key is embedded in the public JavaScript bundle, any user can query PostgREST directly without a WHERE clause:

#### Exploit scenario

```http
# Step 1: enumerate all shared builds and their tokens
GET /rest/v1/car_builds?select=id,name,year,make,model,notes,share_token,user_id
apikey: <anon_key>

# Step 2: retrieve all items for any enumerated build
GET /rest/v1/car_build_items?select=*&build_id=eq.<any_build_id>
apikey: <anon_key>
```

This returns: build name, car year/make/model, notes, all modification items (names, brands, prices, product links), and the `share_token` itself (usable to construct valid share links).

Exposure per build: item names, brands, prices (financial data), external product links, build notes (potentially containing sensitive info).

#### Why this matters beyond "it's just a car build"

- Item prices aggregate to real purchase intentions (financial data)
- Build notes are free-form text — users may store sensitive context
- `share_token` in the response allows generating valid share URLs for any user's data
- Combined with F1, an attacker can correlate `user_id` from builds to full financial profiles

#### Fix

The correct fix is to route public share requests through a **server-side function** that enforces the token check before returning data:

```typescript
// supabase/functions/public-build/index.ts
// Accepts: ?token=<uuid>
// Uses service role key server-side to query by exact token match
// Never exposes share_token in response, never allows enumeration
serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token || !isUUID(token)) return new Response('Not found', { status: 404 });

  const { data: build } = await serviceClient
    .from('car_builds')
    .select('id, name, year, make, model, notes, user_id')  // no share_token
    .eq('share_token', token)
    .single();

  if (!build) return new Response('Not found', { status: 404 });
  // fetch phases, items, display_name...
  return new Response(JSON.stringify(result), { status: 200 });
});
```

Then update `usePublicBuild` to call this function instead of PostgREST directly, and remove the three public RLS policies from the tables.

---

### F3 — MEDIUM: Schema drift — `share_token` column and 4 public RLS policies not in migrations

**Severity:** MEDIUM  
**Category:** Operational / Schema Drift  
**Confidence:** 100%

#### What was found

The live `car_builds` table has a `share_token uuid` column that does not appear in `supabase/migrations/20260612_car_builds.sql`. Four security-sensitive RLS policies (the three build-table public policies from F2, plus the profiles policy from F1) were applied directly to the database without a corresponding migration file.

| Schema object | In migration file? | In live DB? |
|--------------|-------------------|-------------|
| `car_builds.share_token` column | ❌ | ✅ |
| `car_builds` — "Public can view shared builds" policy | ❌ | ✅ |
| `car_build_phases` — "Public can view phases of shared builds" policy | ❌ | ✅ |
| `car_build_items` — "Public can view items of shared builds" policy | ❌ | ✅ |
| `profiles` — "Public can view display_name of shared build owners" policy | ❌ | ✅ |

#### Risk

1. **Disaster recovery gap**: restoring from migrations would produce a DB missing the `share_token` column entirely — public sharing would silently fail
2. **No audit trail**: these policies were never reviewed in a PR
3. **F1 and F2 were never caught** because they bypassed the migration → review → deploy pipeline

#### Fix

Create a migration for all untracked changes:

```sql
-- supabase/migrations/20260613_car_builds_share.sql
ALTER TABLE public.car_builds
  ADD COLUMN IF NOT EXISTS share_token uuid;

CREATE INDEX IF NOT EXISTS idx_car_builds_share_token
  ON public.car_builds (share_token)
  WHERE share_token IS NOT NULL;

-- NOTE: Do NOT add the overly-broad public policies from the live DB.
-- Instead, add the fixed policies per the F1 and F2 recommendations.
```

---

## Summary

**Status: ⚠️ FINDINGS REQUIRING IMMEDIATE ACTION**

### Priority actions

| Priority | Action | Fixes |
|----------|--------|-------|
| **P0 — Immediate** | Remove or restrict the `profiles` public SELECT policy. Use a security barrier view or denormalize `display_name` onto `car_builds`. | F1 |
| **P0 — Immediate** | Remove the three build-table public RLS policies and route public share requests through a server-side Edge Function that validates the exact token. | F2 |
| **P1 — This sprint** | Create `supabase/migrations/20260613_car_builds_share.sql` with the `share_token` column and the corrected (fixed) RLS policies. | F3 |
| **P1 — This sprint** | Audit how the `share_token` column and all four policies were applied to the live DB without migrations. Add a process guard (e.g., CI check that `supabase db diff` is clean before merge). | F3 |

### What is clean

- `payment_plans` migration: RLS is correct — `auth.uid() = user_id` with both `using` and `with_check`, no public access. ✅
- `PhaseBlock.tsx` URL validation: client-side `http(s)` protocol check is present; public share page uses `rel="noopener noreferrer"` on all external links. ✅
- All other `useSupabaseData.ts` mutations: scoped with `.eq('user_id', user.id)` on both read and write paths. ✅
- No hardcoded secrets, no `dangerouslySetInnerHTML`, no command injection surface in any changed file. ✅
- Edge functions reviewed: `reddit-scout` uses a shared secret for cron invocation; all payment/subscription functions use Supabase service role server-side. ✅
