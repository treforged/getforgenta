# Maintenance log on the share link — private/public switch — 2026-08-12

**Branch `docs/version-scheme`, local only. ⚠️ THE MIGRATION IS NOT APPLIED.**
`supabase/migrations/20260812_car_builds_maintenance_public.sql` is written, rehearsed on the real
schema inside `begin … rollback`, and **not applied** — an unattended session does not apply
migrations. It is purely additive (one `boolean not null default false` column on `car_builds`) so it
cannot destroy anything, but until it runs the toggle in the share panel will error and the Edge
Function's `select` of `maintenance_public` will 400.

**Deploy order matters, in one direction only:** apply the migration FIRST, then deploy the
`public-build` function, then the web app. Each step is safe ahead of the next — a shared build
defaults to private, so nothing publishes until Tre taps the switch.

## What Tre asked, and the two decisions taken for him

> "add a maintenance log to the build page, which can be set as private or public to go with the
> share build link."

Both halves already existed. What was missing was the join: a shared build said nothing about whether
its service history was visible. Session 10 had deliberately left maintenance off the public page and
noted "if Tre wants it shared, that is a deliberate follow-up". This is that follow-up.

### Decision 1 — the switch is PER BUILD, not per entry

`car_builds.maintenance_public`, one flag, travelling with the share link — which is literally what
"to go with the share build link" describes. A per-entry flag was the alternative and it was rejected:
it makes the owner re-audit every row forever, and **its failure mode is silent** — forget to mark one
receipt private and it ships, with no signal that anything went wrong. Per build is one thing a person
can hold in their head, and it matches how sharing already works (`share_token` is per build).

**Do not build the per-entry version on top of this.** If a specific entry must stay private, the
answer is a future "hide this entry" flag layered *inside* an already-public log, not a second global
model.

### Decision 2 — cost, vendor and notes NEVER leave the account, even when public

This was checked before publishing anything, and it changed the shape of the feature. A maintenance
row carries `cost`, `vendor` and free-text `notes`. **Showing that the oil was changed at 92,400 miles
is a build log. Publishing what someone paid, plus the name of their local shop and whatever they
typed in the notes, is a different feature nobody asked for.**

So the public projection is a **column allowlist**: `id, service, service_date, odometer,
next_due_date, next_due_odometer`. The private columns are not fetched at all, so a cost never crosses
the network rather than being sent and hidden in the browser. The "Total Spent" / "Last 12 Mo" stats
on the owner's page are absent from the share page for the same reason.

### Decision 3 — NO anon RLS policy. This is the security core of the change.

⚠️ **The brief called this an RLS change. On this codebase it is deliberately not one, and that is the
safe answer.** `20260615_fix_public_rls.sql` DROPPED the anon policies from `car_builds`,
`car_build_phases` and `car_build_items` precisely because a policy predicated on
`share_token is not null` let **anyone holding the anon key enumerate every shared build and its
token**. Public reads were re-routed through the service-role `public-build` Edge Function, which
validates the exact token server-side.

Adding an anon `select` policy to `car_maintenance_logs` — the obvious way to "make it visible to
public builds" — would have re-opened that exact hole. So:

- `car_maintenance_logs` keeps **one** policy, `users manage own maintenance logs`
  (`auth.uid() = user_id`). Unchanged, and the migration adds none.
- **anon reads zero maintenance rows through PostgREST in every case**, shared or not.
- The gate lives in the Edge Function, next to the token check, like every other shared field.

## 🔬 Evidence — run against the REAL schema inside `begin … rollback`

The migration was applied inside the transaction, fixtures seeded (two shared builds owned by Tre —
one with `maintenance_public = true`, one `false`; two maintenance rows on the public one, one on the
private one), probed, and rolled back. **A passing build is not evidence for this one, so none of the
below is a build result.**

### RLS layer — role-switched with `set local role` and real JWT claims

| # | probe | expected | actual |
|---|---|---|---|
| 1 | **anon** reads maintenance of the **PUBLIC-log** shared build, direct | 0 | **0** |
| 2 | **anon** reads maintenance of the **PRIVATE-log** shared build, direct | 0 | **0** |
| 3 | **anon** enumerates ALL maintenance rows | 0 | **0** |
| 4 | **anon** enumerates shared builds (the 2026-06-15 hole, re-checked) | 0 | **0** |
| 5 | **OWNER** reads their public-log build's maintenance | 2 | **2** |
| 6 | **OWNER** reads their private-log build's maintenance | unaffected by the flag | **1 private + 2 public** |
| 7 | **OWNER** still sees cost/vendor on their own rows | 184.32, Bobs Garage | **184.32, Bobs Garage** |
| 8 | a **DIFFERENT authenticated user** reads the public-log build's maintenance | 0 | **0** |

Rows 5-6 are the owner-sees-their-own-either-way requirement: **the flag is a publishing switch, not
an access control on the owner.**

### The share gate — the Edge Function's logic, transcribed and run

| # | probe | expected | actual |
|---|---|---|---|
| 1 | PUBLIC link: token resolves, flag read | true | **true** |
| 2 | **PUBLIC link: the anonymous reader RECEIVES the history** | 2 entries | **2: "EV tire rotation @ 94100 mi \| EV oil change @ 92400 mi"** |
| 3 | PRIVATE link: token resolves, flag read | false | **false** |
| 4 | **PRIVATE link: the anonymous reader RECEIVES NOTHING** | 0 entries | **0 entries** |
| 5 | the private build's rows **do exist** — withheld, not absent | 1 row | **1 row, "EV private brake job" cost 900.00** |
| 6 | **the columns actually on the wire** | no cost/vendor/notes/user_id | **id, next_due_date, next_due_odometer, odometer, service, service_date** |

Row 5 matters: row 4's zero is a gate doing its job, not an empty table. Row 6 is the cost leak,
disproven on real columns.

### The migration's own safety

| # | probe | actual |
|---|---|---|
| 7 | every pre-existing build backfills to private | **3 builds, 3 private — and all 3 are ALREADY SHARED** |
| 8 | the flag is `NOT NULL` (no third "unset" state) | **is_nullable = NO** |
| 9 | policies on `car_maintenance_logs` after the migration | **1: "users manage own maintenance logs"** |

Row 7 is the one that would have been a live privacy incident: **all three of Tre's builds already
have a share token.** A column defaulting to `true` would have published his service history to three
existing links the moment it applied.

**Rollback verified clean afterwards:** 3 builds, 0 `EV %` fixtures, 0 maintenance rows,
`maintenance_public` **gone**, 1 policy. Tre's data untouched.

### ⚠️ One pre-existing thing found, NOT a regression, worth knowing

`car_maintenance_logs` carries blanket table grants to `anon` (`SELECT/INSERT/UPDATE/DELETE/…`) — the
Supabase default `grant all on all tables to anon`. **RLS is the only thing stopping anon reads**, and
probes 1-3 prove it holds. This is true of every table in the project and this change neither creates
nor worsens it. Flagging it because "anon has SELECT" reads alarming in isolation and someone will
find it later.

## Code

| File | Change |
|---|---|
| `supabase/migrations/20260812_car_builds_maintenance_public.sql` | **NEW, NOT APPLIED.** `maintenance_public boolean not null default false` on `car_builds`, plus the reasoning above as comments |
| `supabase/functions/public-build/index.ts` | selects `maintenance_public`; fetches maintenance **only when true**, with the column allowlist; strips the flag out of the `build` object and reports it once as `maintenancePublic` |
| `src/lib/public-maintenance.ts` | **NEW.** `PUBLIC_MAINTENANCE_COLUMNS`, `PRIVATE_MAINTENANCE_COLUMNS`, `PublicMaintenanceEntry`, `toPublicMaintenance`, `shouldPublishMaintenance` |
| `src/hooks/useSupabaseData.ts` | `usePublicBuild` returns `maintenancePublic` + `maintenance`; a response from a not-yet-deployed function reads as **private** |
| `src/pages/BuildShare.tsx` | read-only "Service History" section — service, date, mileage, next-due. No cost, no vendor, no notes, no totals |
| `src/pages/Builds.tsx` | `Private` / `✓ Public` toggle in the share panel, with copy naming exactly what is and is not shared |
| `src/lib/types.ts`, `src/integrations/supabase/types.ts`, `src/lib/demo-data.ts` | the new column |
| `src/lib/__tests__/public-maintenance.test.ts` | **NEW, 13 tests** |

### The test that matters most

The allowlist is **one rule written twice** — in `public-maintenance.ts` and in the Deno Edge Function
that runs the real query. No compiler spans those two, so the test does: it **reads the Edge
Function's own source**, parses its `select` list, and fails if it drifts. Same idiom as
`synced-transaction-review.migrationParity.test.ts`.

**Verified the tests bite, not just pass:**
- adding `cost` to the Edge Function's select → **2 tests fail**
- replacing the `maintenancePublic ?` gate with `true` → **1 test fails**

Both mutants reverted; the tree holds neither.

## Gates

`npx tsc --noEmit` **0** · eslint clean on all 7 touched/created source files · **919/919 across 116
files** (+13) · `npm run build` green in 859ms.

## ⬜ Still owed

1. **Apply `20260812_car_builds_maintenance_public.sql`** (attended), then deploy `public-build`, then
   the app. In that order.
2. **Live click-through, never done:** open a build's share panel → toggle `Public` → open the share
   link in a private window → confirm the history appears with **no cost, no vendor, no notes** →
   toggle back to `Private` → reload the link → confirm the section is gone.
3. Session 11's still-owed browser pass on the maintenance log itself (`/builds` click-through) is
   unchanged and still open.
4. File the PR. Nothing here was pushed — a pre-push hook refuses it in this session; the board's Push
   button does it.
