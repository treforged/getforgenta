# Handoff — 2026-08-09 — session 126b — 🟢 **SPLIT LINK AUTHORISED**; biweekly phase bug MEASURED; harness retuned

> **START HERE.** Same session, after the occurrence-date fix below. **No app code changed** —
> `3ec7c725` is still the last app commit. Two decisions landed and one investigation finished.

## 🟢 SPLIT LINK — TRE SAID YES. Build it. (2026-08-09)

His words: *"for split links i think yes since it can integrate the variable items into cost. the
total for rent would be change but then it would be calculated correctly since it will update the
ledger with these items and forecast can get a better month 0 picture."*

That answers the question left open in 125b. **Do not re-ask.** Note what he added beyond a plain
yes — his goal is that the **variable** rider (Water/Sewer/Trash, billed in arrears) stops being
invisible, so the bundled rent charge reconciles to the right total and **month 0 gets a truer
picture**. Design to that, not merely to "N rules per row".

**Still true and still load-bearing (from 125b):** a split link's `occurrence_month` must be
**PER-LINK, not per-transaction** — one bank row settles Rent/Internet/Smart Home for THIS month and
Water for the PREVIOUS one. Blocked by `UNIQUE (synced_transaction_id)` on
`synced_transaction_reviews`; the build is drop that UNIQUE (or add a child table), a "link another"
picker, and multi-link badge/undo semantics. `buildConfirmedOccurrences` already iterates reviews and
keys per rule, so N links on one row just work in 4A with **no logic change**.
⚠️ Now also give each split link its own **`occurrence_date`** (shipped `3ec7c725`), same as any rule link.

## 🔴 BIWEEKLY PHASE BUG — MEASURED, NOT FIXED. Tre asked me to look at it.

**WEEKLY RULES ARE FINE. Only biweekly is broken.** Every Friday is a Friday no matter which month it
falls in, so the monthly phase reset is harmless at a 7-day step. Verified for 2026: the weekly
`Weekly Paycheck` ($848.89) generates **52 occurrences, every gap exactly 7 days**. That is the
big-dollar rule and it is correct. Do not "fix" it.

**Biweekly drifts because the generator restarts from the first matching weekday of EVERY month**
(`getRuleOccurrenceDatesInMonth`, the `weekly`/`biweekly` branch) instead of anchoring the phase like
the paycheck generator does at `pay-schedule.ts:97` with `(D - anchor) % 14 === 0`.

Measured for Tre's `Fuel` rule (`002f7e28…`, $65, biweekly, `due_day 5` = Friday, **`start_date` NULL**), 2026:

| | Generated | True cadence |
|---|---|---|
| Occurrences in 2026 | **28** | 26 |
| Gaps between occurrences | **23 × 14 days + 4 × 7 days** | 26 × 14 days |
| Months with 3 occurrences | Jan, May, Jul, Oct | (2 or 3 legitimately) |

Four times a year a month ends on a generated occurrence and the next month restarts only 7 days
later, inserting an extra cycle. **+2 occurrences a year = +7.7%.**

### ⚠️ THE REAL RISK IS NOT TRE — IT IS EVERY CUSTOMER WITH A BIWEEKLY PAYCHECK

- For a biweekly **expense** (Tre's only case today) over-counting reads cash **LOW** — the safe
  direction. Cost to him: **$130/yr** of phantom Fuel, plus individual charges misplaced by up to 7 days.
- For a biweekly **income** rule it reads cash **HIGH** — the unsafe direction. Biweekly is the most
  common US pay cadence, so a customer on a $2,000 biweekly paycheck is projected **~$4,000/yr of
  income that never arrives.** Tre is insulated only because his paycheck happens to be weekly.

**Recommendation: fix it, and treat it as an income-correctness bug rather than a Fuel rounding issue.**

### The wrinkle that decides the design — there is no anchor to use

`Fuel.start_date` is **NULL**, and an anchor is exactly what the fix needs. Options, in the order I'd
weigh them:
1. **`start_date` when set, else the rule's earliest known occurrence** (or a fixed global epoch).
   Fixes the *count and spacing* for everyone immediately. For a null-`start_date` rule the *phase*
   is arbitrary, so which specific dates it picks will shift — but they are already wrong.
2. **Ask for a start date on biweekly rules in the rule editor** (and backfill-prompt existing ones).
   Correct, but it puts a form in front of the user before their forecast is right.

⚠️ **This MOVES PROJECTED NUMBERS for every biweekly rule in the app**, so it is its own commit and
its own live pass. ⚠️ **It also interacts with `3ec7c725`:** a stored `occurrence_date` names a date
the *current* generator produces, so re-phasing can leave existing links pointing at a date no
occurrence lands on any more, silently degrading them to "suppresses nothing". Decide the migration
for those rows as part of the fix (cheapest honest option: null out `occurrence_date` on biweekly
rules' links so they fall back to month-keying).

## ✅ Harness retuned this session (Tre asked "should I extend the gate?")

- **`.claude/hooks/context-gate.mjs` THRESHOLD 150k → 175k.** A fresh session spends ~65-70k
  rebuilding context before its first useful edit, so 150k left only ~82k of productive room, and
  restart cost is re-billed on **every** request of the new session, not once. Do not exceed ~180k:
  overrunning means auto-compact, which flattens exactly the "do not re-litigate" decisions these
  handoffs carry.
- **`handoff.md` split: 2,081 lines / 139 KB → 411 lines / 27 KB** (~40k tokens → ~7k, saved on every
  request of every future session). Sessions 112-124, all closed or live-verified, moved to
  `docs/handoff-archive/2026-08_sessions-112-124.md`. **Keep it this way** — trim to the current
  session, the previous one, and the standing backlog whenever it grows past ~3 live sections.

## ⬜ NEXT

1. **The `3ec7c725` live pass is still owed** (script in the session-126 section below).
2. **Split link** — authorised, unscoped, unbuilt.
3. **Biweekly phase fix** — measured above, needs Tre's pick between the two anchor options.

---

# Handoff — 2026-08-09 — session 126 — ✅ **BIWEEKLY OCCURRENCE-DATE FIX SHIPPED `3ec7c725`**; live pass OWED

> **START HERE.** Session 126 built the fix session 125b designed and Tre authorised
> (*"do what you think is accurate and best for my customers"*). **709/709 tests (+23), tsc 0,
> eslint clean on every changed file.** The migration is **APPLIED LIVE** and every constraint was
> re-read from `pg_constraint` to confirm.
>
> **Tre's account was NOT touched** — only `select`s. Re-verified after the migration:
> `imported 55 · linked_plan 1 · linked_rule 11 · linked_txn 2` = **69**, and
> **0 rows carry `occurrence_date`** (all legacy, all month-keyed, all behaving exactly as before).
> Backups: `backups/2026-08-09_162505/`.
>
> ⬜ **THE LIVE PASS IS OWED AND NOT STARTED** — the context gate fired right after the commit.

## ✅ Shipped `3ec7c725`

| File | Change |
|---|---|
| `supabase/migrations/20260809_synced_transaction_reviews_occurrence_date.sql` (new) | `occurrence_date date NULL`, a CHECK that it lies inside `occurrence_month`, a `(user_id, rule_id, occurrence_date)` partial index. **APPLIED LIVE** |
| `src/lib/confirmed-capture.ts` | `occurrence_date?` on `RuleOccurrenceReview`; `buildConfirmedOccurrences` adds the DATE key when set, else the month key — **never both**; `isRuleOccurrenceConfirmed` tries the full-date key first, then the month key. No signature change, still a pure `has()` |
| `src/lib/pay-schedule.ts` | **`getRuleOccurrenceDatesInMonth`** extracted (the generator now calls it — one definition of where occurrences land) + **`resolveRuleOccurrenceDate`** |
| `src/lib/synced-transaction-review.ts` | `occurrence_date` on `ReviewInput`; validation: format, needs a month, must be **inside** that month |
| `src/components/transactions/BankActivity.tsx` | `ruleOccurrence()` helper; **both** rule-link write sites (the `Confirm: <rule>` suggestion button and the picker) now store the date |
| `src/hooks/useSupabaseData.ts` | column threaded through the `save` upsert |
| `src/integrations/supabase/types.ts` | one additive column, hand-edited (diff is exactly 3 lines), drift-checked against live `information_schema.columns` |
| 3 test files | +23 tests |

### Design calls — do not re-litigate

- **ONE key per review, never both.** A date-keyed row must NOT also add its month key, or the
  original bug returns intact (the month key suppresses every occurrence of that rule).
- **NULL `occurrence_date` is a FIRST-CLASS legacy value**, not a degraded state — hence no
  `linked_rule implies occurrence_date is not null` CHECK (this time the reason is not
  `ON DELETE SET NULL`; nothing nulls this column — it is that 11 live rows have none). Pinned by a
  "LEGACY: byte for byte" test.
- **The date must lie INSIDE `occurrence_month`** (DB CHECK + `validateReviewInput`). This is a
  deliberate **departure from 125b's plan step 3**, which said to search the previous month too:
  doing so would leave the row asserting a month whose occurrences it does not suppress, and the two
  columns would silently disagree. Cross-month attribution (Tre's water bill riding on the rent
  charge in arrears) is the **SPLIT-LINK** problem, which needs a per-link month and is unbuilt.
- **NEAREST occurrence, not nearest-on-or-before.** Paying two days early is ordinary and
  on-or-before would return null and silently fall back to month-wide suppression. **Ties go to the
  EARLIER** occurrence.
- **Not a count/budget.** Reasoning preserved in the migration header and in 125b below.
- **Mixed key space is safe**: a `YYYY-MM` (7 chars) can never equal a `YYYY-MM-DD` (10).
- **A caller passing only `'2026-08'`** matches ONLY legacy rows. Correct — without a day there is no
  way to say which occurrence is meant. No live consumer does this (all pass event dates).
- **No backfill.** Monthly rules are behaviourally identical either way; the only affected rows are
  Tre's 2 biweekly Fuel links, both in **July, a past month**. Left alone. Mention it to him.

## ⬜ NEXT — the live pass (owed), then Tre picks

**1. The live pass.** It CAN move a number (that is the point), so run it alone.
On `/transactions` → Bank Activity, pick a **biweekly or weekly** rule (Tre's `Fuel`, `002f7e28…`,
$65) and a **current-or-future-month** bank row, then:
- link one row → confirm the DB gets `occurrence_date` set and **inside** `occurrence_month`;
- confirm the forecast drops **exactly one** occurrence of that rule, not the whole month — read
  `baseExpenses` off the React fiber, **NOT `endingCash`** (the cycling-debt engine absorbs freed
  cash);
- ⚠️ **The sensitivity control that makes the result mean anything:** a July `occurrence_month` is
  a past month where Δ 0 proves nothing. Session 125 solved this by retargeting the review row with
  a scoped `UPDATE` to a live month — do the same, or link a row in a live month directly.
- `Undo` → clean up → re-SELECT to **69 / 0 dates**.

⚠️ Method notes from sessions 123/125 that still hold: a direct `navigate` to `/forecast` on a cold
load lands on `/dashboard` (click the sidebar `a[href="/forecast"]` instead); resolve elements in JS
and call `.click()` — **never** click coordinates after a `scrollIntoView`; never hold a DOM node
across an `await`; `http://localhost:8080` is the ONLY origin; **always** scope SQL with
`user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf'`; never paste a counterparty name into this file.

**2. Then Tre picks.** Still open, none started:
- 🟡 **SPLIT LINK** (one bank row → several rules) — **recommended, Tre has NOT answered. Ask him.**
  Full evidence in the 125b section below. Blocked by `UNIQUE (synced_transaction_id)`.
- ⚠️ **Biweekly rules have NO phase anchor** — their phase restarts every month, so generated dates
  need not match real-world biweekly reality. Found in 125b, **still not raised with Tre.** It is a
  separate defect from the one just fixed. The comment on `getRuleOccurrenceDatesInMonth` says so.
- **4B's number-moving half** (`carChargeEvidence`, keys on fund+kind+month) and **4C's**
  (`buildConfirmedPlanOccurrences`) — both specced, unbuilt.
- `useCardProjection.ts` **missing `syncedTransactions` dep** eslint warning.
- **Electricity budgeted $100 but billed $197.93 on 08-05**; Water/Sewer/Trash $30 looks low.
  Mention, do not act.
- **N1-N12 backlog** below.

---

# Handoff — 2026-08-09 — session 125b — 🔵 **BIWEEKLY FIX FULLY DESIGNED, NOT STARTED** (Tre authorised); split-link recommended, UNANSWERED

> **START HERE.** Same session, after the 4B live pass below. **NO CODE CHANGED** — `08b0d4ca` is
> HEAD, `e6dbb5af` is still the last app commit. The gate fired during design research.
> **The whole design is below; the next session should be able to implement it without re-deriving it.**

## 🟢 TRE AUTHORISED THE BIWEEKLY FIX — *"do what you think is accurate and best for my customers"*

That is the long-open **biweekly-rule key problem**. It no longer needs Tre. **Build it.**

### The defect, restated precisely

`buildConfirmedOccurrences` (`src/lib/confirmed-capture.ts:70`) keys on **`ruleId|YYYY-MM`**, and
`isRuleOccurrenceConfirmed` (:90) does **`date.slice(0, 7)`**. So for a **weekly or biweekly** rule
with 2-3 occurrences in one month, confirming **ONE** occurrence suppresses **ALL** of that month's
occurrences of that rule. Live on Tre's account today: rule **Fuel** (`002f7e28…`, biweekly, $65)
carries **two** `linked_rule` reviews, both `occurrence_month='2026-07'`.

### ✅ THE DECISION — store the occurrence DATE; keep every consumer a PURE predicate

Add an **`occurrence_date date NULL`** column. Key on **`ruleId|YYYY-MM-DD`** when present, fall back
to `ruleId|YYYY-MM` when NULL. The mixed key space is unambiguous (7 vs 10 chars after the `|`).

**Why not the obvious alternative — a `Map<key, count>` and a "suppress at most N" budget:** the
consumers are **stateless predicates called inside `.filter()` at 8+ sites**
(`pay-schedule.ts:387/:476/:548`, `useForecastEngineInputs`, `useCardProjection`, `credit-card-engine`,
`Dashboard`, `BudgetControl`, `Vehicles`, `CreditCardEngine`). A consuming budget makes them
**order-dependent and re-entrant inside React memos** — a whole class of bug this codebase does not
have today. A date key keeps every call site a pure `has()` and needs no consumer signature change.

### ⚠️ Why the DATE is load-bearing, not just the count — the case that decides it

The month-0 helpers only count occurrences **after the sync cutoff**. Today is Aug 9; suppose Fuel
lands Aug 3 and Aug 17. Only **Aug 17** is "remaining". The user confirms the bank row for the
**Aug 3** fill-up:

- **Correct:** suppress Aug 3 → already excluded by the cutoff → **remaining cash does not move.**
- **Count-based "suppress any one":** kills **Aug 17** → **wrongly raises cash by $65.**

So a count-only fix trades one wrong answer for another. The date is the fix.

### ⚠️⚠️ FINDING THE IMPLEMENTER MUST READ FIRST — biweekly RULES ARE NOT PHASE-ANCHORED

`generateMonthTransactionsFromRules` (`pay-schedule.ts:1132-1199`) is the **only** place rule
occurrence dates exist. Per frequency:

| Frequency | Occurrence dates |
|---|---|
| `weekly` (:1146) | first `due_day` **as a DAY OF WEEK** (0-6, default 5) on/after month start, step **7** |
| `biweekly` (:1159) | **identical, step 14** — and it **restarts from the first matching weekday of EVERY month** |
| `monthly` (:1172) | `min(due_day \|\| 1, last day of month)` |
| `yearly` (:1183) | `due_month` + `due_day` |

**Biweekly rules have NO phase anchor**, unlike the *paycheck* generator at `:97`, which IS anchored
via `paycheckStartDate` (`(D - anchor) % 14 === 0`). So a biweekly rule's phase **resets every month**
and its generated dates need not match real-world biweekly reality. **This is arguably its own defect
and is NOT in scope** — but do not build anything that assumes "the Nth biweekly occurrence" is stable
across months. **Raise it with Tre separately.** The date fix is strictly better than today either way.

### Implementation plan

1. **Migration** (additive, §1B house style): `occurrence_date date NULL`. ⚠️ **Do NOT add a
   `linked_rule implies occurrence_date is not null` CHECK** — same `ON DELETE SET NULL`/UPDATE trap
   documented for `rule_id`, `payment_plan_id` and `car_fund_id`. Leave the existing
   `link_needs_month` CHECK alone; `occurrence_month` stays and stays required.
2. **`confirmed-capture.ts`**: `buildConfirmedOccurrences` adds `ruleId|occurrence_date` when the
   column is set, else today's `ruleId|occurrence_month`. `isRuleOccurrenceConfirmed` checks the
   **full-date key first, then the month key**. Pure, no signature change.
3. **Write side (`BankActivity.tsx` + `useSupabaseData.ts`)**: on picking a rule, compute the
   occurrence date = that rule's generated occurrence **nearest on-or-before the bank row's date**,
   searching the row's month **and the previous month** (bills settle *after* the obligation, and the
   water case below proves a bill can settle a month late). Store `occurrence_date` alongside the
   existing `occurrence_month`.
4. **Tests**: two confirmations of one biweekly rule in one month suppress **exactly two** occurrences;
   one confirmation suppresses **exactly one** and leaves the other standing; a NULL `occurrence_date`
   row behaves exactly as today (legacy fallback, pinned); a monthly rule is unchanged.
5. **Backfill is optional.** For **monthly** rules month-keying and date-keying are equivalent (one
   occurrence), so the 11 existing `linked_rule` rows are behaviourally unaffected — except Tre's
   **2 biweekly Fuel rows, both July**, a past month. Backfill them or leave them; say which.

## 🟡 SPLIT LINK (one bank row → several rules) — RECOMMENDED, TRE HAS NOT ANSWERED

Tre asked whether his rent transaction (which pays **Rent + Internet + Smart Home + Water**) should
have its rules **combined into one**. **I recommended NOT combining — build split links instead.**
He replied with the water detail but **never answered the build question. Ask him.**

The evidence, dug out this session:

| Rule | Amount | Due |
|---|---|---|
| Rent | $1,915 | 1 |
| Internet | $85 | 1 |
| Smart Home | $40 | 1 |
| *(fixed subtotal)* | **$2,040** | |

Actual bundled charge, 7 months: `2049.95 · 2104.08 · 2082.82 · 2079.48 · 2082.82 · 2117.82 ·
2079.48` — always **$10-78 above** the fixed $2,040.

### ⭐ TRE EXPLAINED THE VARIANCE — and it adds a hard design requirement

*"it also includes the water bill from a previous month."* So the rider is **Water/Sewer/Trash
(budgeted $30), billed IN ARREARS**. That means:

**A split link's `occurrence_month` must be PER-LINK, not per-transaction.** One bank row can settle
Rent/Internet/Smart Home for *this* month **and** Water for the *previous* month. Any design that
hangs a single `occurrence_month` off the transaction is wrong before it ships. (This is also why
step 3 of the biweekly plan searches the previous month.)

Why not combine the rules: the bundle is **not a fixed amount**, so one merged rule would carry a
wrong number every month; per-item visibility is lost; and it muddies the `GF Half of Rent/Groceries`
($1,100 income) reconciliation against a rule that is no longer just rent.

**Blocked today by schema:** `synced_transaction_reviews` has **`UNIQUE (synced_transaction_id)`** —
one review, one `rule_id`, per bank row. Build is: drop that UNIQUE (or add a child table), a
"link another" picker, multi-link badge/undo semantics. **One nice property: `buildConfirmedOccurrences`
already iterates reviews and keys per rule, so N links for one transaction just work in 4A with no
logic change.**

## 📌 Facts Tre volunteered this session — for N2 (merchant auto-categorisation)

- **TECO is an electric company.** (*"let it be know that TECO is also an electric company"*)
- **Duke Energy is electricity, categorised Utilities** — already linked to the Electricity rule.
- Both belong in N2's merchant→category map when it is built. N2 still needs the §1A/§1B
  reversal conversation flagged in its backlog entry below before any code.
- ⚠️ Unrelated open observation, NOT yet raised properly: **Electricity is budgeted $100 but was
  billed $197.93 on 08-05**, and Water/Sewer/Trash at $30 looks low against the $10-78 actuals.
  Tre has not asked for this; mention it, do not act.

---

# Handoff — 2026-08-09 — session 125 — ✅ **4B LIVE-VERIFIED**; §1B verification debt back to ZERO

> **START HERE.** Session 125 ran the owed 4B live pass on Tre's real account. **It passed on every
> check, including a sensitivity test stronger than the one the handoff asked for.** **No code
> changed** — `e6dbb5af` is still the last app commit.
>
> **Account is CLEAN, re-SELECTed after cleanup:** `imported 55 · linked_plan 1 · linked_rule 11 ·
> linked_txn 2` = **69**, and **0 rows carry `car_fund_id` or `car_charge_kind`**. `imported` never
> left 55, so no ledger row was created or deleted at any point.

## ✅ 4B (link half) LIVE-VERIFIED — do not re-verify

Driven through the real UI on `/transactions` → Bank Activity → month `2026-07` (all 24 settled
August rows are already reviewed, so the unreviewed pool is July — same 53 rows session 123 saw):

| Check | Result |
|---|---|
| Picker renders | ✅ placeholder `Which vehicle charge is this?` |
| **TWO destinations, not one** | ✅ `2004 Chevorlet C5 · car payment · $423` **and** `… · car insurance · $173`, as separate options with `<fundId>:<kind>` values |
| Offered on unsuggested rows | ✅ **53** unreviewed July rows each offer `Link to a vehicle charge` alongside the other three link types |
| Write | ✅ `status='linked_car'`, `car_fund_id`=`0f75dec9…`, `car_charge_kind='loan_payment'`, `occurrence_month='2026-07'` — **derived from the row's own 07-22 date, not the current month** — with `rule_id` / `transaction_id` / `payment_plan_id` **all NULL** |
| Badge names the KIND | ✅ row collapsed to `linked · 2004 Chevorlet C5 payment` + plain `Undo` |
| **NO projected number moves** | ✅ Aug/Sep/Oct/Nov 2026 × `baseExpenses`/`totalExpenses`/`endingCash`/**`carLoanPayment`**/**`vehicleInsurance`** = **all Δ 0** |
| UI `Undo` | ✅ deleted the review, badge gone, offer count back to 53 |
| Cleanup | ✅ re-SELECT = 69, zero car columns set |

### ⭐ The sensitivity control — this test was made STRONGER than specced, deliberately

A July `occurrence_month` is a **past** month, so Δ 0 there proves almost nothing: a wrongly-wired
suppression aimed at July would be invisible anyway. So after the UI pass, the review row was
retargeted with a scoped `UPDATE` to **`occurrence_month='2026-09'`** — a month whose
`carLoanPayment` is live at **$422.89** and `vehicleInsurance` at **$173.23** — and the forecast was
re-read. **Still Δ 0 on every key.** That is the real proof the link half is inert. The row was then
restored to `2026-07` before the UI `Undo` so the Undo ran against the true state.

⚠️ **Read `carLoanPayment` / `vehicleInsurance` off the fiber, not `baseExpenses`, when 4B's
number-moving half lands.** The car charges are their **own chart keys** and are NOT inside
`baseExpenses` — that is the signal that will move, and this session captured its exact baseline:
every month Aug-Nov carries `carPay 422.89 · carIns 173.23`.

### Method notes that cost this session time — do not repeat

- **A direct `navigate` to `/forecast` on a cold load lands on `/dashboard`.** Navigate in-app
  instead: click the sidebar `a[href="/forecast"]`. Session 123's fiber recipe otherwise holds.
- **The link destinations are `<button>`s, not `<select>`s** — the picker `<select>` only exists
  *after* clicking `Link to a vehicle charge`. Grepping selects for the placeholder finds nothing.
- **Never hold a DOM node across an `await`.** React re-renders replace the node and the native
  value-setter then throws `Illegal invocation`. Re-query the `<select>` in the same call that sets it.
- The row-container `textContent` comes back `[BLOCKED: Base64 encoded data]`; match the badge by
  exact text on a **leaf** node instead, then walk up for the `Undo`.

## ⬜ NEXT — Tre picks

§1B verification debt is **zero** again. Nothing is half-applied. Remaining known work, none started:
- **4B's number-moving half** — a confirmed `linked_car` feeds `matched: true` into
  `carChargeEvidence` at all four sites (`forecast-engine.ts:307/:356`, `useCardProjection.ts:587/:1338`).
  ⚠️ Must key on **fund + kind + month**, and it is NOT `buildConfirmedOccurrences`.
- **4C's number-moving half** (`buildConfirmedPlanOccurrences`) — specced, unbuilt.
- The **biweekly-rule key problem** (`ruleId|YYYY-MM`) — needs Tre before designing.
- `useCardProjection.ts` **missing `syncedTransactions` dep** eslint warning — scoped follow-up.
- **N1-N12 backlog** below.

---
# 🆕 NEW BACKLOG — Tre, 2026-08-09, captured verbatim-faithful, NOTHING STARTED

> ⚠️ **None of this is scoped, audited, or estimated.** It was dictated in one message during a usage
> pause. Several items are questions about live data, not build tasks. **Ask Tre which he wants
> first** rather than working top-to-bottom — the ordering below is his dictation order, not a
> priority. Items marked 🔎 need an audit before any code.

### N1 — Link a LOAN ACCOUNT to an active loan 🔎

*"allow users to link a loan account to an active loan. ex: i just added my usaa one and it needs to
link to my car payment. the first payment has passed but the transaction hasn't settled in my
checking account to pull in. but the loan account balance is updated."*

**And the bug riding along with it:** *"the net worth with this now updated should also be reflected
in networth and forecast (the charts dont look like they updated)."* — treat the charts-not-updating
half as a **separate defect to root-cause**, not as a consequence of the missing link. See the
`project_net_worth_snapshots` memory: pre-08-04 history used a credit-card-only liability rule, so a
step change in the chart can be expected rather than broken — verify before "fixing".

### N2 — Merchant auto-categorisation by name 🔎

*"it should auto categorize stores like Costco, sams club, aldi, and publix as groceries. circle k, 7
eleven, wawa, and any other gas station as gas. follow the same concept for recognizable stores.
anthropic is claude. open ai is chat gpt. etc."*

⚠️ **This reverses a standing §1A/§1B call and must be raised with him as such, not slipped in.**
§1A rejected fuzzy merchant-name scoring, and §1B's plan says *"Do not add merchant-name heuristics
to paper over"* `GENERAL_MERCHANDISE` (32% of rows). Tre is now asking for exactly that. He is
entitled to overrule it — but the earlier reasoning was about **fuzzy matching for LINKING**, whereas
this is an **exact-ish merchant list for CATEGORISING**, which is a weaker and safer claim. State
that distinction to him and build the categorising version only. The Anthropic→Claude /
OpenAI→ChatGPT pair is a **display-name** mapping, a different feature from the category map.

### N3 — Link to car insurance and car payment

That is **4B**, already specced below (`car_fund_id` + CHECK + `validateReviewInput` case + a
`'Link to a vehicle charge'` picker, feeding `matched: true` into the two `carChargeEvidence` gates).
Tre naming it again is a priority signal.

### N4 — ⚠️ Same name + same price ≠ same transaction

*"even though things have the same name and price, doesn't mean they are the same transaction. once
its decided for one for category or link, the same even should just occur on the date of the
transaction and also be added to the ledger."*

**This is a correctness constraint on N2 and N5, and the most important sentence in the batch.** A
learned decision must key on the **occurrence** (this merchant, this date), never collapse two
distinct same-amount charges into one event. Read it as the direct counterpart of `occurrence_month`
on the rule/plan links.

### N5 — Auto-link from history, then a confirmation-only flow 🔎

*"based off previous links, start autolinking items. then it would just be a confirmation. make it so
the next time user signs in/open the app, it would just be going through each item and selecting what
its for. they can choose to do it later and it would remind them again next time. starting from when
the first linked there account, just let them know they can go to the transactions page to select
choices to help build the backlog for future decisions which would be more automated."*

⚠️ **Tension with a load-bearing §1B rule.** §1B is explicitly built NOT to be a queue demanding
decisions: *"unreviewed is NEVER a nagging count or badge"*, and most rows are permanently unreviewed
BY DESIGN. This asks for a walk-through-on-sign-in prompt. It is his product and his call, but the
design note exists for a reason — **raise it, propose a shape that keeps "later" genuinely free of
nagging, and get his answer before building.**

### N6 — Prime / Discover: paid-but-not-settled suppression 🔎

*"prime had 0 interest this month and the due date already passed. the transaction for it hasn't come
through yet. the balance on the credit card is updated, but the money hasn't come out of my checking.
prime should [not] have any contribution suggestion again till next month. discover is due on the
first of next month but i do need to know how much to schedule to pay for that."*

This is the **same shape as 4A** — an obligation already met that the app still charges against
month-0 cash — but on the CC engine's contribution suggestions rather than the rule helpers. Likely
touches `credit-card-engine.ts` / `CreditCardEngine.tsx`. See the `project_isb_semantics` memory
before calling any balance stale: a big ISB/balance gap on a 0% promo card is normal.

### N7 — Convert a transaction into a payment plan

*"make it so users can easily convert a transaction into a payment plan."* A new action, presumably
from the ledger row and/or a bank row. Smallest item in the batch.

### N8 — Forecast popups: show full decimals

*"all numbers in the forecast pop ups should show decimal places, not just part of them."*
Cosmetic and self-contained. ⚠️ Check `formatCurrency`'s second arg (the repo passes `false` in
places to drop cents) rather than writing new formatting.

### N9 — Retirement & Investment Growth Projections looks wrong 🔎

*"on forecast is the Retirement & Investment Growth Projections section properly reflecting
everything? it seems off."* **A question, not a task.** Audit and report before changing anything.

### N10 — 401k/Roth percentage contributions must scale with income 🔎

*"the 401k roth contribution scales with income when its a percentage. that needs to be reflected in
forecast and goals."* Real engine work, touching both forecast and goals. Probably related to N9 —
check whether N9's "off" feeling is this.

### N12 — Assign Tre's PAST transactions for him (manual backfill) — Tre, 2026-08-09

*"at some point i want you to go into my account and assign past transactions for me unless we get
the more automated transaction connection working first."*

**Explicitly authorised account work**, but conditional and NOT yet scheduled — he said *"at some
point"*. Two things make it different from every other item here:
- ⚠️ **It is superseded by N5.** If auto-linking-from-history ships first, this becomes unnecessary.
  Check N5's status before starting, and say so rather than doing redundant manual work.
- ⚠️ **It writes to real financial data at volume, by judgement.** Every assignment is a guess about
  what a charge was for. Agree the rules with Tre first (which statuses, how confident is confident
  enough, what to do with ambiguous rows) and work in **reviewable batches**, not one bulk pass.
  A wrong `linked_rule` in a CURRENT month moves projected cash; a wrong one in a past month does
  not. Prefer starting with closed months.
- Note he has already done ~69 himself on 2026-08-09, so the remaining backlog is the older history
  (`synced_transactions` runs to ~571 rows). Scope the actual unreviewed count before quoting effort.

### N11 — Venture X missing full statement balance in later years 🔎

*"can you look at my account and tell me why venture x is missing full statement balance in later
years, and what i can do to fix it?"* **A diagnosis request about live data.** Answer it with SQL +
the engine trace; do not change code first. See `project_isb_semantics`.

---

# 📁 Older handoffs — ARCHIVED, not deleted

Sessions **112 through 124** (§1B Stages 1-4B, all closed or live-verified) moved to
`docs/handoff-archive/2026-08_sessions-112-124.md` on 2026-08-09.

WHY: this file is re-read at the start of every session and sat on the prefix of every request
in it, so 16 stacked sections were costing ~40k tokens per session before the first useful edit.
Nothing is lost — the archive is committed, and git has every version regardless. Read it only
when you need the history of a decision; the live sections above plus the backlog below are
sufficient to resume work.
