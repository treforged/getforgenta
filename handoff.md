# Handoff — 2026-08-09 — session 128 — 🟢 **`3ec7c725` FULLY LIVE-VERIFIED, BOTH SIDES. Anomaly SOLVED — it was never a bug.**

> **START HERE.** **No app code changed.** The read-side debt session 127 handed on is **CLOSED**.
> Tre's account is **restored byte-for-byte**: `imported 55 · linked_plan 1 · linked_rule 11 ·
> linked_txn 2` = **69**, **0 rows carry `occurrence_date`** — re-SELECTed after the probe.

## ✅ THE PHONE BILL ANOMALY — SOLVED. Stage 4A is NOT inert. Do not re-investigate.

**Root cause: `Phone Bill to Mom` has `start_date = '2026-10-10'`.** `generateScheduledEvents`
anchors at `max(today, start_date)`, so the rule generates **no August occurrence at all** — its first
event is Oct 10, 2026. Session 127's probe suppressed an occurrence that did not exist. That was the
**fifth** insensitive instrument in a row, not evidence of a broken read path.

Both surviving hypotheses from 127 are **DEAD**:
- ❌ "expense events may not carry `ruleId`" — they do. `scheduling.ts` sets `ruleId: rule.id` on all
  four frequency branches (:111, :125, :155, :177).
- ❌ "§1B Stage 4A is inert in the forecast" — **disproved by live measurement below.**

### 🧮 The `baseExpenses = 120` puzzle — RECONCILED TO THE DOLLAR

August has **zero** rule expenses. Every TOTAL CHECKING cash rule is due on day 1-3 and today is
Aug 9, so `e.date > todayStr` drops them all; Phone Bill (day 10) does not start until October.
The 120 is **entirely `planExpensesByMonth`** (`forecast-engine.ts:756`) — the `Carnival Ultimate
Package` plan, $120/mo, cash-funded on TOTAL CHECKING. Verified against live chart data:

| Month | `baseExpenses` | Reconciliation |
|---|---|---|
| Aug 2026 | **120** | 0 rules + 120 Carnival |
| Sep 2026 | **2872** | 2524 rules (Rent 1915, Groceries 300, Electricity 100, Internet 85, Life Ins 54, Smart Home 40, Water 30) + 348 plans (Carnival 120 + payback-to-mom 228, starts 09-20) |
| Oct 2026 | **2902** | Sep + **exactly 30** = Phone Bill's first occurrence. Independent confirmation of the start-date finding. |

⚠️ **THE REAL LESSON, worth keeping:** *nothing in August was ever testable.* After the 9th there is
not one remaining cash-funded rule occurrence on the forecast funding account. Any future month-0
probe in this account will read Δ 0 for that reason alone. **Probe SEPTEMBER or later.**

## ✅ READ SIDE — LIVE-VERIFIED. The `occurrence_date` key path works end-to-end.

Retargeted review `33354d22…` (Life Insurance, `9a0950c1…`, $54, due day 3) from its legacy
`2026-08`/NULL to **`occurrence_month='2026-09'` + `occurrence_date='2026-09-03'`** — the NEW
date-keyed path shipped in `3ec7c725` — reloaded, and diffed `baseExpenses` off the fiber:

| | Aug | **Sep** | Oct | Nov |
|---|---|---|---|---|
| baseline | 120 | 2872 | 2902 | 2902 |
| with date-keyed confirmation | 120 | **2818** | 2902 | 2902 |
| Δ | 0 | **−54.00, exact** | 0 | 0 |

That is the whole feature demonstrated at once: the confirmation **fires**, it removes **exactly** the
named occurrence's amount, and it is **scoped to its own month** — no leakage into Oct/Nov.
**The row was restored to `2026-08` / NULL immediately and the 69/0 counts re-verified.**

**`3ec7c725` is now verified on both sides. Neither side needs re-testing.**

## 📌 Tell Tre (not acted on)

- **`Phone Bill to Mom` starts 2026-10-10.** So the app shows no phone-bill charge in Aug or Sep by
  design. Probably intentional, but it is the data point that cost two sessions — worth one question.

---

# Handoff — 2026-08-09 — session 127 — 🟡 (superseded above; read side now CLOSED). Anchor DECIDED.

> **No app code changed** — `2ff1347b` is HEAD, `3ec7c725` is still the last app commit.
> **Tre's account is CLEAN**, re-SELECTed after cleanup: `imported 55 · linked_plan 1 · linked_rule 11 ·
> linked_txn 2` = **69**, **0 rows carry `occurrence_date`**. Both test rows deleted; `imported` never
> left 55, so no ledger row was created or deleted at any point. Sign-in lapsed at session start and
> Tre re-authenticated manually — the app tab is parked open, leave it that way.

## ✅ WRITE SIDE — LIVE-VERIFIED THROUGH THE REAL UI. Do not re-verify.

Linked bank row `f8beb45b…` (2026-07-10, settled, previously unreviewed) to **Weekly Paycheck** via
the real `Link to a bill` picker on `/transactions`. The DB got:

`status='linked_rule' · rule_id=3a30b089… · occurrence_month='2026-07' · occurrence_date='2026-07-10'`

That is the first `occurrence_date` ever written by the app: correct value, **inside** its
`occurrence_month`, and equal to a real generated Friday occurrence of the rule. `ruleOccurrence()` /
`resolveRuleOccurrenceDate` work end-to-end against live data.

## ~~🔴 READ SIDE — COULD NOT BE DEMONSTRATED~~ — ✅ **CLOSED in session 128, see top of file.**

> ⚠️ **Everything in the rest of this session-127 section is SUPERSEDED.** The cause was
> `Phone Bill to Mom`'s future `start_date` (no August occurrence exists), not a broken read path.
> Kept only for the method notes at the end. **Do not re-run any probe described below.**

**Every probe returned Δ 0, including probes that SHOULD have moved.** Do not read that as "the fix
works" — three of the four are explained by scope, but **the fourth is not, and it is the one that
matters.** Method was a full 213-key numeric diff of the forecast chart data (all keys, first 4
months), review present vs review absent.

| Probe | Result | Explanation |
|---|---|---|
| `Weekly Paycheck` (weekly, income) | Δ 0 | **Inert by design.** `paycheckIncome` comes from the PAYCHECK CONFIG, not this rule (Aug `2546.67` = 3 × 848.89 is a coincidence of equal amounts). `otherIncome` is a flat `1152` = the two GF income rules only. This rule reaches no forecast key. |
| `Fuel` (biweekly, $65) date-keyed `2026-08-07` | Δ 0 | **Correct AND untestable.** Fuel is funded by **Prime Visa**, and `useForecastEngineInputs.ts:265` excludes every CC-funded rule (`allCcRuleIds`) from month-0 expenses. |
| `Fuel` month-keyed (`occurrence_date` NULL) | Δ 0 | Same exclusion. ⚠️ **So the A/B I ran proves nothing** — the instrument was insensitive in BOTH arms. Recorded here so nobody cites it as evidence. |
| `QUO` ($22, due 12, monthly) | Δ 0 | Sits on **`General Operations`**, not the forecast funding account → excluded by `otherAccountRuleIds`. |
| ⚠️ **`Phone Bill to Mom`** ($30, due **10**, monthly, **TOTAL CHECKING**), `occurrence_date='2026-08-10'` | **Δ 0 — UNEXPLAINED** | Cash-funded, on the forecast funding account, month-0, due AFTER today (Aug 9) so it is a remaining obligation, date exactly on the generated occurrence. **It should have dropped Aug expenses by $30 and moved nothing.** |

### ⚠️ THE NEXT SESSION'S FIRST JOB — chase that last row

Staleness is **ruled out**: after the SQL insert the Bank Activity row visibly collapsed to a linked
badge with `Undo`, so the app was reading the new review. Remaining hypotheses, untested:
1. `scheduledEvents` may not carry `ruleId` on rule-generated expense events, in which case
   `isRuleOccurrenceConfirmed` can NEVER fire and **§1B Stage 4A is inert in the forecast** — the
   serious possibility, and the reason this is not being written off.
2. The chart's `baseExpenses` may not be downstream of the `expenses` memo at
   `useForecastEngineInputs.ts:257-269` at all. Aug `baseExpenses` = **120**, but the only remaining
   Aug cash rule on TOTAL CHECKING is Phone Bill at **$30** — **those numbers do not reconcile**, which
   is itself a clue worth pulling.
3. Some earlier filter drops the event before the confirmation test is reached.

I tried and FAILED to read `scheduledEvents` off the fiber twice (plain prop walk, then hook-chain
walk). **Do not repeat those two attempts.** Cheaper next moves: a temporary `console.log` in that
memo, or a unit test that feeds real-shaped `scheduledEvents` through it.

### 🔬 CHASED FURTHER (Tre asked, same session). TWO HYPOTHESES NOW DEAD — start from here.

- ❌ **DEAD — "`baseExpenses` isn't downstream of the suppression".** It is.
  `useForecastEngineInputs.ts:166` `forecastMonthEvents` is the suppression-aware memo (the one with
  `isRuleOccurrenceConfirmed` at :264); `forecast-engine.ts:745` does
  `const filteredExpenses = forecastMonthEvents[i]?.expenses ?? 0` and `:747-751` assigns that to
  `baseExpenses`. The separate un-filtered `monthlyAggregates` (:83) feeds other fields, NOT this one.
- ❌ **DEAD — "the stored `occurrence_date` disagrees with the forecast's generated date".** This was
  my best theory (the forecast builds events with **`generateScheduledEvents`**, a DIFFERENT function
  from the `getRuleOccurrenceDatesInMonth` the writer uses — exactly the two-copies danger that
  function's own docstring warns about). **Disproved:** re-ran Phone Bill with
  **`occurrence_date = NULL`, month-key only** — the legacy path that cannot possibly mismatch — and
  it ALSO moved 0 of 213 keys. A key mismatch would have shown a delta here.
  ⚠️ The two generators are still an unaudited duplicate and worth checking on their own merits, but
  they are **not** the cause of this anomaly.
- ✅ **RULED IN — funding account is not the explanation.** `tre:debt:fundingAccount` =
  `933cbc10-bceb-4c20-8227-4a02e6db728a` = **TOTAL CHECKING**, which IS Phone Bill's `payment_source`.
  So the rule is genuinely inside the forecast's scope and `otherAccountRuleIds` does not exclude it.

**What survives, and it is the serious one:** rule-generated expense events may not carry `e.ruleId`,
so `isRuleOccurrenceConfirmed(e.ruleId, …)` at `:264` always returns false and **§1B Stage 4A never
suppresses anything in the forecast** — i.e. the whole Stage 4A feature is inert on this surface,
independently of `3ec7c725`. Both surviving hypotheses (missing `ruleId`, or the event not landing in
`eventsInMonth`) predict the Δ 0 that was observed, so they must be separated directly.

**Do this first, it is one cheap step:** temporarily `console.log` inside the `:238` `eventsInMonth`
filter for `monthKey === '2026-08'` — dump `{date, ruleId, type, amount}` — and answer two questions
at once: (a) is Phone Bill's $30 event present, and (b) does it carry a `ruleId`? Also reconcile the
standing puzzle that **Aug `baseExpenses` = 120** while the only remaining Aug TOTAL CHECKING cash
rule is Phone Bill at **$30**; whatever makes up the other $90 will likely explain the shape.

## 🟢 ANCHOR DECIDED — Tre picked **"Both: derive now, ask later"** (2026-08-09)

For the biweekly phase bug measured in 126b. **Two commits, in this order:**
1. **Derived anchor, silent** — fixes count and spacing for every customer with no form and no action.
2. **Optional "first occurrence" field** in the rule editor, so anyone who cares can pin their true phase.

Do not re-ask. ⚠️ Still true from 126b: this **moves projected numbers for every biweekly rule**, so
it needs its own commit and its own live pass, and it interacts with `3ec7c725` — re-phasing can
strand a stored `occurrence_date` on a date no occurrence lands on any more (cheapest honest
migration: null out `occurrence_date` on biweekly rules' links).
⚠️ **Sequencing:** the read-side debt above is unresolved. Resolving it should come FIRST — building a
second number-moving change on top of a suppression path that may be inert would stack two unverified
behaviours.

**Anchor choice for NULL `start_date` (my recommendation, not yet Tre's call):** use the rule's
`created_at` rather than a global epoch — per-rule, stable, already stored, and it means "the rule
started existing then". `Fuel.created_at` = 2026-03-22. Requires adding `created_at` to the
`Pick<RuleRow, …>` the generator takes.

## 📌 Findings worth telling Tre (none acted on)

- ⚠️ **§1B Stage 4A does not cover credit-card-funded rules at all.** Confirming a link on Fuel — the
  exact rule the occurrence-date fix was built for — cannot move the forecast, because CC rules are
  excluded from month-0 expenses by design. The fix is still correct; its **reach** is narrower than
  the handoffs imply. Worth a scope conversation.
- **Two checking accounts exist**: `TOTAL CHECKING` (forecast funding) and `General Operations`
  (business). `QUO`, `Claude` and `Google Workspace` are on the business one and are invisible to the
  forecast's month-0 expenses. Expected, but easy to mistake for a bug — it cost this session a probe.
- **All unreviewed August rows are `pending`**, and BankActivity excludes pending rows by design, so
  **there is no live-month row that can be linked through the UI today.** Any live-month test must go
  through the scoped-UPDATE retarget.
- Latent, unrelated: `getRuleOccurrenceDatesInMonth` builds dates with `new Date(y, m, d)` (LOCAL) then
  `.toISOString()` (UTC). For a customer in a **UTC+** timezone every rule occurrence date lands **one
  day early**. Harmless for Tre (UTC-4). Not raised, not fixed.

## 🧪 Method notes that worked — reuse these

- **Find a bank row's DOM node by React fiber `key`**: walk `document.querySelectorAll('div,tr,li')`,
  read `__reactFiber$…`, then `f.return` up to 8 hops looking for `f.key === <syncedTransactionId>`.
  Text matching does not work — amounts and row containers come back `[BLOCKED: Base64 encoded data]`.
- **Forecast chart data off the fiber**: walk from `#root`, find the first fiber whose
  `memoizedProps.data` is an array whose `[0]` has an `endingCash` key. 60 months, ~65 keys each.
- **Baselines across a reload**: stash them in `sessionStorage` (and the snapshot fn's `.toString()`),
  since `window.*` dies. A full `location.href` reload IS needed — the SPA will not pick up an
  out-of-band SQL change otherwise.
- ⚠️ **Never `await` across a navigation in one `javascript_tool` call** — the eval dies with
  `Inspected target navigated or closed`. Navigate in one call, act in the next.
- ⚠️ **I mis-copied a uuid** from an earlier query and wasted two calls on a row that did not exist.
  Paste ids from the immediately preceding result, not from memory.
- Session 125/123 notes still hold: direct `navigate` to `/forecast` cold-lands on `/dashboard` (click
  the sidebar `a[href="/forecast"]`); always scope SQL with
  `user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf'`; `http://localhost:8080` is the ONLY origin;
  never paste a counterparty name into this file.

## ⬜ NEXT

1. ~~Resolve the Phone Bill anomaly~~ — ✅ **DONE, session 128. Stage 4A is live.**
2. **Biweekly anchor, commit 1** (derived) then **commit 2** (optional field). Decided, unstarted.
   ⚠️ Its blocker is now gone: 127 said to resolve the read side FIRST, and that is done.
3. **Split link** — authorised, unscoped, unbuilt. Read side needs NO change (confirmed by reading
   `buildConfirmedOccurrences` this session: it already iterates reviews and keys per rule).
   UI side: `BankActivity.tsx:135` `reviewByTxn` is a `Record<string, Row>` and must become
   `Record<string, Row[]>`. Blocker `UNIQUE (synced_transaction_id)` re-confirmed live in `pg_constraint`.

---

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

# 📁 Sessions 125 and 125b — ARCHIVED 2026-08-09 (session 127)

Both are CLOSED: 125's 4B live pass passed, and 125b's biweekly design SHIPPED as `3ec7c725`. Every
load-bearing conclusion from them is restated in the 126/126b sections above. Full text is in git at
commit **`2ff1347b`** (`git show 2ff1347b:handoff.md`). Sessions 112-124 are in
`docs/handoff-archive/2026-08_sessions-112-124.md`.

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
