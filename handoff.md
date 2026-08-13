# Handoff — Forgenta

> ▶ 2026-08-13 — **Internal transfers collapse to one row, and the import trap on them is closed** — `0e1c4f9e` on `job/51fac1bb`, local only. 🔬 **MEASURED ON THE LIVE DB WITH THE SHIPPED DETECTOR, and the number is bigger than the card's: 62 pairs, 124 legs, out of 719 settled synced rows** — not 44/88. (Method: the 140 rows involved in any amount+date+different-account candidate join were dumped to a gitignored probe under `backups/2026-08-13_transfer-pairs-probe/` and run through `detectTransferPairs` itself; rows in no candidate join cannot change its output, so the reduced input is exact rather than a sample. The probe test was deleted before the commit — real account uuids, public repo.) Spread: 2026-08 ×6, 07 ×7, 06 ×9, 05 ×14, 04 ×7, 03 ×8, 02 ×9, 01 ×2. **Every case the card named is in the output** — Chase autopay $941.01 TOTAL CHECKING → Prime Visa, the Discover e-payments $1000/$725/$82.78/$79.78, the Zelle $60/$12/$50s, HYS+savings $350/$200/$45, and the $5,037.73 on 2026-06-21. ⚠️ **That last one reads `Discover it Card → Prime Visa`, which is not a contradiction of the card's "Prime Visa → Discover"** — the DEBT moved to Discover, so the MONEY left Discover and landed on Prime Visa. Both descriptions are of the same event from opposite ends. **The card's corrected premise is confirmed and restated in both new files' headers: nothing here is double-counted today** — `synced_transactions` is not the ledger, and no imported transfer pairs exist in `transactions`. What is fixed is queue noise, a live trap, and attribution. **What shipped:** the previous run's uncommitted `src/lib/transfer-pair-detection.ts` (kept as written — it is sound, and it reuses `matchCharge`'s `AMOUNT_EXACT_TOLERANCE` and the newly-exported `daysBetween` rather than growing a second comparator) now has **19 tests, most of them REFUSALS built from Tre's own rows**: the $50 7-Eleven charge that a naive rule collapses (saved by mutual-best, because the credit prefers a same-day transfer), the Aamc $36 and patent $350 fees equal to a third-party Zelle (saved by the category gate), a tie yielding NO pair. `planLedgerImport` gains **`isTransferLeg`, checked BEFORE the suggestion guard so "Not this" cannot reach it** — every other refusal there means "something already describes this charge" and is a user's to overrule, whereas a transfer leg has no correct ledger row at all (+3 tests). `BankActivity.tsx`: pairs render as ONE row (`TOTAL CHECKING → Prime Visa`, neutral colour, both dates), the inflow leg is hidden **only when the outflow is also on screen** so an account filter never makes a real bank row vanish; **no category picker on a transfer** (every option is a kind of spending or earning) — where the money landed on a card the row names that card's payment, and the rule picker stays for the three `transfer` rules Tre already tracks (HYS, Emergency Fund, Owners Contribution), with linking one leg also clearing its partner. **Decisions, do not re-litigate:** (1) **pre-checked batch, confirmed in one tap, never silent** — a silent auto-apply is indistinguishable from a bug the moment it mispairs, since the rows would simply be gone; (2) **recording writes `'ignored'` on BOTH legs and NOT a new `'transfer'` status** — `ReviewStatus` is mirrored by a DB CHECK, so a sixth value is a migration an unattended session may not apply, and `'ignored'` already means "nothing about this belongs in the ledger", which is literally true here; the badge still reads **"recorded · transfer"** because the pairing is re-derived on every read; (3) **detection runs over ALL history, never the filtered rows** — legs straddle months (the $5,037.73 posts 06-21/06-23) and are on different accounts by definition. tsc 0, eslint clean on all 6 files, **1079/1079 across 128 files** (1057 + 19 + 3), build green; verified the tests bite (dropping the tie guard fails the tie test). Backup at `backups/2026-08-13_transfer-pairs/`. ⚠️ **NOT browser-verified — no Claude-in-Chrome tooling in this session, so the requested "Bank Activity for 2026-07 rendering them as single rows" was not screenshotted.** The 7 July pairs are proven from the real rows; what is unproven is only the rendering. ⚠️ **A PARALLEL SESSION is mid-flight in this tree** (`src/lib/charge-obligations.ts` untracked, `src/lib/bank-activity-queue.ts` modified) — deliberately NOT staged; only this slice's 6 files were committed. ⬜ **Owed: the Push button + PR, and one browser pass on `/transactions`** (confirm the transfer panel lists 62, that a pair renders as one row, and that "Add to my ledger" is absent on it).

> ▶ 2026-08-13 — **The review backlog is reachable. The suggestions always worked; nobody could see them** — `230662e1` on `sweep/getforgenta-2026-08-13`, local only. 🔬 **MEASURED ON THE LIVE DB, and the cost is worse than the card reported: 12 undecided charges carry a live suggestion and ZERO of them are in the current month.** All 12 were unreachable from the default view, spread over **6 months**, oldest **2026-02-17** — six months stale. Context: **719 settled rows, 8 months, 648 unreviewed (90%)**. (Method: the shipped matcher's four gates reproduced in SQL — account, direction, amount, ±5 days — plus BOTH ambiguity rules. It is a **lower bound**: exact-cent tolerance rather than the wider `strongTolerance`, and monthly rules only. 10 of the 12 are rule matches, 2 are ledger matches.) The matcher was never the problem, exactly as the card said. ⚠️ **THE COUNT IS NOT AN "UNREVIEWED" COUNT AND THAT DISTINCTION IS THE WHOLE DESIGN — do not "simplify" it.** `BankActivity.tsx`'s standing rule (Tre, 2026-08-08) is that unreviewed means nothing at all and most rows are permanently unreviewed by design; badging 648 would be a number nobody can drive to zero. What is counted is **suggestions awaiting a decision** — charges where the app already computed an answer and is waiting for a yes/no, which is 12 and which the user drives to zero by deciding. The 08-08 rule **stands**; both file headers now say so and say why. **What shipped:** new pure `src/lib/bank-activity-queue.ts` (all the rules, one matcher run feeding the row, the tab count and the sidebar badge, so the three can never disagree); default view is **"Needs a decision" across all months**, suggestion-carrying rows sorted to the top, **month select kept as a filter rather than the door**; counts on the Transactions tab, the sidebar rail (dot when collapsed) and the mobile bar; **"Accept all N suggested"** with a two-step confirm that states it adds nothing to the ledger. 🔬 **TWO REAL DEFECTS FOUND ON THE WAY, both fixed and both made worse by the batch button:** (1) accepting a **suggested** rule link wrote **no `occurrence_date`** while the picker path always did — per the file's own doc a month-wide link suppresses BOTH of a biweekly rule's charges and over-raises projected cash by the one never confirmed, and Tre's `Fuel` rule ($65, biweekly) is exactly that shape; one `acceptRuleInput` now serves the button and the batch. (2) **`matchCharge` guards ambiguity on the candidate side only** — it is called once per charge, so three identical **$10.00 CFX tolls on 2026-08-03** each saw the single $10 ledger entry and were each confidently told it was theirs; a ledger row claimed by several charges is now suggested to **none**. That is a **tightening, not the loosening the card forbade**, and it is load-bearing now that one click accepts a batch. **Decision recorded:** the sidebar badge makes the all-history synced query run on **every page**, not just `/transactions` — accepted deliberately, because "reachable only once you are already on the page that hides it" is the bug; react-query serves every consumer from one cache. Badges return **null, never 0** (a zero and a failed read look identical). tsc 0, eslint clean on all 8 files, **1057/1057 across 127 files** (1041 + 16 new), build green; the claimant guard was written **test-first and seen RED** (`expected 3 to be 0`). Backup at `backups/2026-08-13_bank-activity-review-queue/`. ⚠️ **NOT browser-verified — no Claude-in-Chrome tooling in this session, so the requested SCREENSHOT of the needs-a-decision view was not taken.** ⬜ **Owed: the Push button + PR, and one browser pass** on `/transactions` (confirm the queue opens by default, the badge reads 12, and "Accept all" links them) — the numbers above are proven, the rendering is not.

> ▶ 2026-08-13 — **PR #97's net-worth dedupe was MERGED AND INERT for a day; the link now actually fires** — on `sweep/getforgenta-2026-08-13`, local only. 🔬 **A field-name mismatch, invisible to `tsc` by construction:** `vehicle-loan-engine.ts:157/342` emits `linkedLoanAccountId`, `net-worth.ts` read `v.linkedAccountId`, and because that property was declared **OPTIONAL** on `NetWorthVehicleLoan`, `CarLoanPaymentInfo` still structurally satisfied the interface — green build, `undefined` at runtime, explicit-link branch never taken, fall through to `sharesDistinctiveToken`, which still fails on `FIXED RATE LOAN` vs `2004 Chevorlet C5`, so the loan stayed double-counted. **Fixed by renaming to `linkedLoanAccountId` AND making it required (`string | null`)** — the file's own comment says the two types are coupled deliberately with no adapter, which is exactly why an optional field is the wrong shape: with no adapter, a required field is the only thing that turns drift into a compile error. A note in the interface's doc comment now says so, naming this bug. 🔬 **The dedupe chain is verified end to end against the live DB, not asserted:** `car_funds.linked_loan_account_id = bcbc52b8…` is set on the C5 fund, `bcbc52b8…` is an **active `auto_loan`** account (`FIXED RATE LOAN`, $16,254.49), and the code now reads the field the producer writes. ⚠️ **The exact on-screen totals in the card no longer reconcile and that is not a second bug** — today's 13:00 UTC Plaid sync moved balances (asset accounts stamped 13:00:09→13:00:41), so the card's `-42,529 / 51,438` predates it; live liability accounts now sum to $41,351.78 + one $8,000 manual row. What is proven is the dedupe, not a specific total. **Test that would have caught it:** every test shipped with #97 hand-built the `NetWorthVehicleLoan` literal, which is precisely why they passed while the feature did not — so `net-worth.test.ts` gains a block that runs a **real `CarFund` through `getActiveCarLoanPayments` and into `buildNetWorthBreakdown`**, asserting ONE liability row for the real pair, plus the unlinked control asserting two (if that control ever goes to one, the name heuristic was loosened and needs review). Verified it bites: reintroducing the old read fails 3. ✅ **(c) snapshot backfill re-checked and the decision STANDS, now on evidence** — `useNetWorthSnapshotRecorder` writes at most one row per 7 days, last row `2026-08-11`, next due `2026-08-18`, so **the broken window produced zero snapshot rows to correct**; the 08-11 row also predates the link existing at all, making it a faithful record of the pre-link rule. Recorded in `net-worth.ts`. 🎁 **Bonus, closes an item four handoff sections owed:** `cron.job_run_details` jobid 22 now has a **Thu 2026-08-13 13:00:00 UTC `succeeded` row** (and Wed 08-12) — a Thursday is what distinguishes daily from the old Mon/Wed/Fri/Sat, and the balance timestamps above prove it did real work. tsc 0, eslint clean on both files, **1041/1041 across 126 files** (1039 + 2 new), build green. Backup at `backups/2026-08-13_net-worth-link-fieldname/`. ⚠️ **NOT browser-verified** (no Claude-in-Chrome tooling this session) — the Accounts tiles should be re-read once this is merged. ⬜ **Owed: the Push button + PR.**

> ▶ 2026-08-13 — **A hand-entered row that duplicates a generated payment now says so** — `a2ee3831` on `sweep/getforgenta-2026-08-13`, local only. Tre's manual `transactions` row `49fd7128…` (2026-09-08, $422.89, note `2004 Chevorlet C5 Payment (13/29)`, `origin=manual`) sits beside the `car_funds` amortization installment for the same month; September is charged twice, which is what drags Sep 2026 ending cash to ~$709 and trips "Cash below safe minimum" (~$1,132 without it). New pure `src/lib/duplicate-transaction-detection.ts` pairs a manual row to a generated one on **same month + amount within a cent + same direction + same account when BOTH name one**; `useDismissedDuplicates` (localStorage, one key app-wide) remembers "both are real"; `DuplicateTransactionWarning` renders on **/transactions** (follows the month filter) and in the **Forecast Monthly Breakdown** (panel above the table, ⚠ *counted twice* badge on the month row, and a first drawer line saying every figure below it is short by that amount). 🔬 **Proven on the live rows, not asserted:** ran the detector against the real car fund + the real transaction — it pairs with `carloan:0f75dec9…:1` (2026-09-07, $422.89). **The two notes DISAGREE** — the manual one says `(13/29)` from an older 29-month loan config while the live fund is 48 months and generates `(2/48)` — so any matcher keyed on the note would have missed this exact case. That probe was a throwaway and deliberately NOT committed (real account uuids, public repo). **Decisions, do not re-litigate:** (1) **never auto-delete and never net the two out** — a second real payment of the same amount in a month is ordinary, so the user decides; (2) **pairing is one-to-one**, which is what lets a legitimate second payment be kept without the two rows accusing each other; (3) **rule occurrences the stream already SUBSTITUTES** (exact `date:note:amount`, per `mergeWithGeneratedTransactions`) are suppressed — those are replaced, not doubled, and warning there would flag working behaviour as a bug; (4) **card/debt-payment rows are OUT of v1** — the engine's month-0 recommendation is variable by design and would cry wolf; (5) dismissals are **per device** (localStorage, no migration — an unattended session must not apply one), stated rather than hidden. ⚠️ **NOT live-verified in a browser** (no Claude-in-Chrome tooling this session) — what is unproven is only that the panel renders where intended; the detection itself is proven on the real rows above. tsc 0, eslint clean on all 6 files, **1025/1025 across 124 files** (1006 + 19 new), build green; verified the tests bite (dropping the one-to-one claim fails 2). Backup of the two modified pages at `backups/2026-08-13_duplicate-transaction-warning/`. ⬜ **Owed: the Push button + PR** (unattended sessions cannot push), and one browser pass on /transactions and /forecast.
> ▶ 2026-08-12 — **TypeScript 7 evaluated: NOT YET, and the blocker is upstream, not this codebase** — see `handoff/2026-08-12-typescript-7-evaluation.md`. 🔬 **#65's Vercel deploy never reaches the compiler.** Reproduced on its own head (`ab650ec7`) rather than read off the page: `npm ci` dies `ERESOLVE`, `peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.66.0` vs `Found: typescript@7.0.2`. The **audit check is the same install step** in `dependency-audit.yml`, so it carries **no security signal** — the audit itself exits **0** on this tree (3 moderates, the known capacitor→xcode→uuid chain, below the `high` gate). 🔬 **The app itself is TS 7 clean: 0 errors in ~1.0s vs ~9.1s under 5.9.3 — ~9× — with zero application-code changes**, needing only two tsconfig fixes: `baseUrl` was REMOVED in TS 7 (`TS5102`), and TS 7 stops inferring `@types/node` ambiently (65 errors: `node:fs`, `__dirname`, `process`, all in fixture-reading tests). Both **shipped and pinned** by `tsconfig-ts7-readiness.test.ts` because both are invisible under the 5.9.3 we ship — nothing goes red today if someone puts `baseUrl` back. ⚠️ **The blocker is typescript-eslint, which hard-refuses at runtime** ("typescript-eslint does not support TS 7.0"), and **no published release supports it — `latest` 8.67.0 AND `canary` both cap at `<6.1.0`**; their target is TS >= 7.1, which is nightly-only. Forcing it was tried and NOT shipped: `--legacy-peer-deps` installs fine and `npm run build` goes **green**, which is exactly the trap — it would have traded away every lint rule, including the 1094→0 `no-explicit-any` baseline, invisibly. Also found: `@supabase/auth-js`'s `webauthn.dom.d.ts` is the one dependency not TS 7 clean (21 errors), masked by the pre-existing `skipLibCheck` — relevant before anyone proposes turning that off. tsc 0, build green, **1014/1014 across 125 files** (not comparable to the 953/119 floor: a parallel session's uncommitted `builds/__tests__/` is in this checkout; 4 are the new file). ⬜ **Owed, needs Tre: CLOSE #65** — `gh`, WebFetch and the GitHub API are all permission-denied in this session, so it could not be closed from here; a suggested closing comment is at the bottom of the evaluation doc. Retry condition, written down: `npm view typescript-eslint@latest peerDependencies` stops ending at `<6.1.0` (typescript-eslint#10940).

> ▶ 2026-08-12 — maintenance log now rides the share link, with a per-build private/public switch — on `docs/version-scheme`. **Migration written, NOT applied.** Cost/vendor/notes are never published. See `handoff/2026-08-12-maintenance-log-share-switch.md`

> ▶ 2026-08-12 — **The campaign tooling now lives under `marketing/`** (`8483b66f`, same branch). Tre: *"move this data/plan to the marketing folder. it should have been created there in the first place."* The plan, drafts, counts and research were already there; the six files that RUN them were not. `git mv`'d, so history follows: `marketing-report.mjs`, `register-marketing-report-task.ps1`, `lib/marketing-metrics.mjs` + its 27 tests, and `research/{reddit-rss-pull,reddit-digest}.mjs` → `marketing/scripts/…`. Every reference moved with them — eight campaign docs, both `.gitignore` entries (the report log is now `marketing/scripts/marketing-report.log`), the scheduled-task script's node path *and* its description, and the report's own repo root, which resolved `..` and now resolves `../..`. ⚠️ **`public/answers/` and `public/sitemap.xml` deliberately did NOT move, and both READMEs now say why:** they are files the web server serves and their URL *is* campaign 5 — moved under `marketing/`, nothing is left at `getforgenta.com/answers/` to rank. Verified rather than assumed: the report runs from the new path (`--targets` and `--this-week` both print, `counts.csv` still resolves at the repo root), the moved test file is still in the default vitest run at **953/953 across 119 files — the same count as before the move** — and the build is green. **The ⬜ owed list below is unchanged, except that the scheduled-task command is now `powershell -ExecutionPolicy Bypass -File marketing\scripts\register-marketing-report-task.ps1`.**

> ▶ 2026-08-12 — **Six free marketing campaigns, designed and committed** (`af08de3c`, branch `autopilot/getforgenta-0811-173709`). Zero spend, aimed at car enthusiasts 18-26, every campaign carrying a number and a free dashboard to read it from: Pit Crew (Reddit advice), Project Ledger (build thread with receipts), 60-Second Teardown (Shorts/TikTok/Reels), The Payment Letter (Google Form → Resend), Answer Engine (`/answers/` static pages), Real Numbers Carousel (existing IG/FB pipeline). North star: 5 signups/wk by wk 8 from GA4 `sign_up`. 🔬 **This was a RETRY of a session that died on its usage limit — and it had left real work on disk, contradicting the "nothing was salvaged" premise.** `PLAN.md`, `measurement.md`, the answer pages, the sitemap and `marketing-report.mjs` were all written and sound; what was missing was everything they *referenced* (`week-01/README.md`, `shorts.md`, `email.md`, `utm.md`) plus the commit. Verified before trusting: the 72-month loan tables in the answer pages re-derive exactly (payment $504.72, 24-month balance $20,282), and the metrics test file IS in the default vitest run (**953/953 across 119 files**, the 926/118 floor + 27). 🔬 The audience research was sitting unread as a raw 289-post dump; digesting it gives the plan's premise a number — **117 of 271 unique posts (43%) raise insurance unprompted, versus 3% for build costs**, which is why the wedge is the build and the lead is always insurance (`marketing/research/FINDINGS.md`). ⚠️ **Two things gitignored deliberately, this repo is PUBLIC:** the live counts CSV (business figures) and `marketing/research/raw/` (289 real Reddit posts with usernames — aggregate counts are ours to quote, other people's posts are not). ⬜ **Owed, all needing Tre's own accounts, ~35 min:** verify Search Console (**records nothing retroactively** — every day unverified is a day of campaign-5 data that cannot be recovered), confirm `VITE_GA_MEASUREMENT_ID` is actually set in production (a missing ID makes the north star measure nothing), Google Form + Resend audience, IG → Professional, Reddit profile bio link. Optional: `scripts\register-marketing-report-task.ps1` for the Monday 8 AM board post (a change to his PC, not the repo, so it was not run).

> ▶ 2026-08-12 — **Plaid cadence re-verified live, and the last surface still claiming the OLD schedule is fixed** — see `handoff/2026-08-12-plaid-daily-cadence-caption.md`. Schedule lives in **pg_cron** (`cron.job` `plaid-daily-sync` → `plaid-sync-all` edge fn), not n8n/Vercel. **Before:** jobid 16, `0 13 * * 1,3,5,6`, 42 runs, last 08-10 13:00 UTC, run rows never a Tue/Thu/Sun. **After:** jobid 22, `0 13 * * *`, active, command re-asserted by predicate (hits `plaid-sync-all`, sends `x-cron-secret`, reads the vault dynamically). 🔬 **The real find: `Accounts.tsx:912-913` still told every premium customer "Syncs Mon, Wed, Fri & Sat at 9 AM ET"** — the schedule the app left on 08-11. And the hour was wrong even before that: 13:00 UTC is **8 AM EST** in winter, and something else entirely outside Eastern. Now derived from `PLAID_SYNC_HOUR_UTC` and rendered in the **viewer's own timezone** ("Syncs daily at 9 AM EDT"). New `plaid-sync-cadence.parity.test.ts` reads the shipped SQL + the shipped page (the `migrationParity` idiom) and pins day-of-week `*`, hour agreement, and **no weekday in the caption**; verified it bites — the old string fails it. tsc 0, **926/926 across 118 files**, build green. ⚠️ **Firing is NOT yet proven and I did not fake it:** at check time it was 05:17 UTC and job 22 next fires 13:00 UTC today; a manual trigger would have skipped that run via the 23.5h cooldown and destroyed the proof. What IS shown: pg_cron fired other jobs at 05:15, and the last real plaid run stamped 7 of 8 `financial_connections` at 13:00:03→13:00:28 on 08-10. ⬜ **Still owed: the Thu 2026-08-13 13:00 UTC row for jobid 22** (Wed fires under both schedules) and a browser look at the caption — no Claude-in-Chrome tooling in this session. `AGENT.md`: test floor 922/117 → **926/118**, and the cron carve-out now requires every place that *states* the cadence to change in the same commit.

> ▶ 2026-08-12 — **SOURCE MAPS PROVEN on the minified production bundle — the last thing the error-tracking item owed is closed.** New `scripts/verify-sourcemaps.mjs` builds with the flag, serves `dist/` via `npm run preview`, drives `/__error-test` with Playwright, catches the OTLP payload on the wire and resolves every frame through the `.map` files. The stack that left the browser is genuinely minified (`at c (/assets/ErrorTest-BrU4Xtl7.js:1:479)`), and it resolves to **`src/components/debug/ErrorTest.tsx:28:8`** — the `new DeliberateTestError(kind)` throw site, to the column. **10 bundle frames, 10 resolved, 0 unresolved.** Boundary wiring re-confirmed on the production build too (`label`, `source = ErrorBoundary/page`, `highlight.session_id`). 🔬 Maps are not just emitted but **served** — `.map` fetches return 200 (5,920 B / 1,257,095 B) with a linked `sourceMappingURL` — which is the actual basis of the `sourcemap: true`-not-`'hidden'` decision, since the tracker fetches them from the deployed URL. ⚠️ **Tre asked for "push, then a preview deploy via Claude in Chrome" and NEITHER was possible here** — an unattended session cannot push (pre-push hook, by design; the board's Push button is the path) and this session had no Claude-in-Chrome tools. A Vercel preview only exists downstream of a push, so the evidence was taken against the local production bundle instead; spinning up a *throwaway* Vercel project via `deploy_to_vercel` was rejected as a stray second deployment of the app, without the real env vars, to prove what the bundle already proves. **Everything Tre asked for that was still unproven is now proven — what is left needs his Push button, not more work.** ⬜ Only remaining gap: LaunchDarkly's own dashboard symbolication (no dashboard credentials here).

> ▶ 2026-08-12 — **Error tracking + session replay wired to the error boundaries** on `autopilot/getforgenta-0811-173709` — see `handoff/2026-08-12-error-tracking-session-replay.md`. ⚠️ **The queue item assumed Sentry; I did not use it, deliberately.** Two premises were wrong for this repo — it is **Vite + React, not Next.js**, and Sentry was **not the only option because one was already installed**: `@launchdarkly/observability` + `@launchdarkly/session-replay` were already dependencies, already initialized, already keyed. Adding Sentry meant **two replay recorders on a financial app**. Card **`b0c8b701`** filed and **✅ ANSWERED before this session ended — Tre chose "Keep LaunchDarkly"**, so the assumption is confirmed and no rework is owed. (The swap would have been one file regardless: nothing outside `src/lib/monitoring.ts` touches a vendor SDK.) 🔬 The real gap was that **error boundaries reported nothing** — a boundary stops the error reaching `window`, which is exactly the SDK's hook, so the crashes users actually hit were the precise set nobody heard about. 🔬 **Correction I nearly shipped backwards:** the SDK's JSDoc says `privacySetting` defaults to weak regex masking, but the v1.1.17 runtime does `?? 'strict'` — **balances were never leaking**; it is now explicit and test-pinned rather than resting on an undocumented default. Evidence is on the wire, not asserted: `exception.type DeliberateTestError` + the boundary's own `label`/`source` fields reached LD, the replay carries the **same session id** (so it attaches), and decoding all 7 gzipped replay payloads (153k chars) found **none** of the page's synthetic figures. tsc 0, **922/922 across 117 files**, build green. 📌 `AGENT.md`'s 892/115 floor was **stale** — HEAD added `useFormDraft.test.tsx` (+19), so the real baseline was 911/116; floor updated. ⬜ **Owed: a preview deploy with `VITE_ENABLE_ERROR_TEST=1` to prove a MINIFIED stack resolves through source maps** — the captured stack was from the dev server and already readable.

> ▶ 2026-08-12 — **Plaid daily cron re-verified + `AGENT.md` migration rule tightened** on `autopilot/getforgenta-0811-173709`. Live `cron.job` still `0 13 * * *`, jobid 22, active; command re-asserted by predicate; `CRON_SECRET` present. Job 22 has **0 runs and that is correct** — it was created ~03:5x UTC 08-12 and first fires 13:00 UTC 08-12. 🔬 Better proof than `job_run_details` that this cron does real work: `financial_connections.last_synced_at` shows 7 of 8 connections stamped 13:00:03→13:00:28 UTC on 08-10, with `accounts.updated_at` trailing each by ~3s. The 8th (USAA) is **not broken** — it was hand-synced 20h10m earlier, inside the 23.5h cooldown. `AGENT.md` now carves out `cron.schedule`-only changes from the never-apply-a-migration rule, with four conditions, instead of leaving a rule a session is forced to break; test-count floor refreshed 762 → **892/115**. ⬜ **Still owed: a Thu 2026-08-13 13:00 UTC row for jobid 22** — that is the run that distinguishes daily from Mon/Wed/Fri/Sat.

> ▶ 2026-08-12 — **Error boundaries + a real 404 page** on `autopilot/getforgenta-0811-173709` — see `handoff/2026-08-12-error-boundaries-and-404.md`. Ten routes had NO boundary (incl. `/`, `/auth`, Legal, Premium); the fallback named nothing and offered no way back; no widget-level boundaries existed. All closed. 🔬 Found and fixed a real trap: wrapping `{renderWidget(id)}` runs the widget body in the PARENT's render, so half of what the boundary appeared to cover would still have escaped — hence the `<Widget>` component. Screenshots at 390×844 in `handoff/evidence/2026-08-12-error-boundaries/`; isolation measured (23 sibling cards still rendered). tsc 0, build green, **892/892**.

> ▶ 2026-08-11 — **Plaid sync put back on DAILY** (`0 13 * * 1,3,5,6` → `0 13 * * *`, live in `cron.job`) + the Accounts freshness badge that mirrored the old 4-day schedule, on `autopilot/getforgenta-0811-173709` (`812c8379`, `87824ab8`) — see `handoff/2026-08-11-plaid-daily-cron.md`. ⬜ **Owed: confirm a Thu 2026-08-13 13:00 UTC run in `cron.job_run_details` (jobid 22)** — Wed fired under both schedules, so only a Thu/Sun row proves daily.
> ▶ 2026-08-11 — stale card projection after bank sync FIXED on `autopilot/getforgenta-0811-173709` (`d0ac30ac`) — see `handoff/2026-08-11-card-projection-stale-dep.md`
> ▶ 2026-08-11 — N7 (convert transaction → payment plan) SHIPPED on `autopilot/getforgenta-0811-160304` — see `handoff/2026-08-11-n7-convert-txn-to-plan.md`
> ▶ 2026-08-11 — N7 follow-up: convert now fires ONE toast (same branch, `c0f5ea10`) — see `handoff/2026-08-11-n7-single-toast.md`

## ▶ 2026-08-10 — session 11 — 🟢 **THE MAINTENANCE MIGRATION IS APPLIED. DB half verified on real data; UI click-through still owed.**

Tre answered "Run it on my PC", so this session applied the blocker from session 10 and verified
everything that can be verified without a browser.

**Applied:** `20260810_car_maintenance_logs.sql` via `apply_migration`, on `mdtosrbfkextcaezuclh`.
Confirmed after, by query rather than by "it succeeded": `car_maintenance_logs` exists with **RLS on
and 1 policy**, 3 indexes; `transactions.car_maintenance_log_id` exists with **`confdeltype = 'n'`
(SET NULL)** and its partial index; the build FK is `'c'` (cascade). `get_advisors(security)` reports
**no new lint** for the table — every finding it returns predates this change.

🔬 **THE DELETE-SAFETY GUARANTEE IS PROVEN ON THE REAL SCHEMA, not just designed.** Ran the full
path inside a `begin … rollback`: insert a log against a real build → insert a transaction carrying
`car_maintenance_log_id` → **delete the log** → assert the transaction still exists with a NULL link.
It passed, and the rollback was verified clean afterwards: **0 maintenance rows, 0 linked
transactions, 162 total transactions — Tre's ledger untouched.** This is the one thing session 10
listed that could have destroyed data, and it cannot.

**Local gates on Tre's PC:** `npx tsc --noEmit` **0**; full suite **834/834** across 106 files,
including all **27** tests in `car-maintenance.test.ts` (run separately to confirm they are really in
the run); `npm run build` green in 2.10s. ⚠️ **Correction to session 10's claim of 846/846 — the real
count on this tree is 834/834.** All pass either way; the figure below was wrong.

**⬜ STILL OWED — the browser pass. This session had NO browser tooling, so `/builds` was never
clicked.** Dev server is UP on `http://localhost:8080` (`dev-session.mjs check` → serving). The
script: log an oil change with a 6-month/5,000-mile interval → confirm the due fields auto-fill →
confirm the badge → "＋ New" transaction files a Car expense visible on the ledger → delete the entry
and confirm the transaction SURVIVES (the DB half of this is already proven above; what is unproven
is that the UI wires it up).

**Then:** file the PR (still local-only, unpushed) plus the four unfiled fix branches below.

## ▶ 2026-08-10 — session 10 — 🟢 **BUILD MAINTENANCE LOG SHIPPED on `feat/build-maintenance-log` (`9ec7940d`, local only, unpushed). ~~⚠️ MIGRATION NOT APPLIED.~~ APPLIED — see session 11 above.**

Tre asked for a maintenance log on the builds page — oil changes, tire rotations, next-due dates,
cost, and the ability to file a transaction against a service. Built end to end. Branch cut from
`origin/main` (`39b5ea4e`) — deliberately NOT stacked on the N10/N9 fix branches, which touch
Forecast only and merge independently.

**⚠️ THE ONE THING THAT BLOCKS IT: `supabase/migrations/20260810_car_maintenance_logs.sql` is
WRITTEN AND NOT APPLIED.** Until it runs, `/builds` will error on the maintenance query for a
signed-in user (demo mode still works — it reads the in-memory fixture). Applying it was deliberately
left to an attended session: `AGENT.md` forbids an unattended run from applying migrations, and free
tier means no PITR. The migration is **purely additive** (new table + one nullable column on
`transactions`), so it cannot destroy anything and needs no backup — it is safe to apply, it just
was not mine to apply. **Apply it, then live-verify.**

**What shipped, 10 files:**
- **Migration**: `car_maintenance_logs` (build_id, user_id, service, service_date, odometer, cost,
  vendor, notes, interval_months, interval_miles, next_due_date, next_due_odometer) with RLS
  "users manage own maintenance logs", two indexes; plus `transactions.car_maintenance_log_id`
  **mirroring `car_build_item_id` exactly** — FK `on delete set null`, partial index. Deleting a
  service entry can never destroy a ledger row.
- **`src/lib/car-maintenance.ts`** — all the rules as pure functions: `addMonthsToDate` (end-of-month
  clamping, 31 Jan + 1 mo = 28/29 Feb), `daysBetween`, `computeNextDue`, `currentOdometer`,
  `maintenanceStatus`, `upcomingMaintenance`, `totalMaintenanceCost`, `costLast12Months`,
  `SERVICE_PRESETS` (15 services with typical intervals, form pre-fill only).
- **`MaintenanceLog.tsx`** (list + stats + "Coming Due" strip) and **`MaintenanceFormModal.tsx`**
  (service datalist, date, odometer, cost, vendor, intervals, editable due fields, notes, and a
  None/Existing/New transaction section reusing the build-item pattern).
- **`Builds.tsx`**: `useCarMaintenanceLogs(resolvedBuildId)`, `applyMaintenanceTransaction`,
  save/delete handlers, renders below `BuildSummary`.
- **`useSupabaseData.ts`**: `useCarMaintenanceLogs` hook (delete also invalidates `transactions`,
  because the SET NULL leaves a stale link on screen otherwise); `addTransaction` accepts the new
  column. **`demo-data.ts`**: 4 demo entries, dates relative to today so demo always shows one
  overdue, one due-soon and one scheduled. Generated `integrations/supabase/types.ts` hand-extended
  (new table block + the column on transactions' Row/Insert/Update + the FK relationship).

**Design decisions — do not re-litigate:**
- **`next_due_date` / `next_due_odometer` are the SOURCE OF TRUTH** for the due badge. The intervals
  only pre-fill them and remain editable. Deriving the badge from the interval as well would be two
  sources of truth for one number, which is how a due date and its badge end up disagreeing.
- **A mileage interval with no odometer reading yields NO mileage due.** An invented number is worse
  than an empty field. Likewise `currentOdometer` is null, never 0, when nothing is recorded.
- **Date maths runs on the ISO string parts, never `new Date('YYYY-MM-DD')`** — that is UTC midnight
  and shifts a day in every US timezone. There is a test pinning it.
- **"Coming Due" considers only the LATEST entry per service** (case/whitespace-insensitive match):
  once the oil is changed again, last year's change is history, not a pending job.
- **Maintenance is NOT on the public share page.** The `public-build` Edge Function was left
  untouched: service history carries vendor names and free-text notes, and the privacy-preserving
  default is not to publish it. If Tre wants it shared, that is a deliberate follow-up.

**Proof: tsc 0, eslint clean on all 8 touched/created source files, full suite 846/846 (819 + 27
new in `src/lib/__tests__/car-maintenance.test.ts`), `npm run build` green. Verified the tests bite:
removing the end-of-month clamp fails the clamp test.** Backup at
`backups/2026-08-10_maintenance-log/`. **NOT live-verified** — needs the migration applied and a
signed-in browser.

**Next up:**
1. **Apply `20260810_car_maintenance_logs.sql`**, then live-verify on `/builds`: log an oil change
   with a 6-month/5,000-mile interval, confirm the due fields auto-fill, confirm the badge, confirm
   "＋ New" transaction files a Car expense that shows on the ledger, then delete the entry and
   confirm the transaction SURVIVES with a null link.
2. File the PR (push/PR not done here) — plus the four still-unfiled fix branches listed below.
3. Everything from session 9 below is unchanged and still open.
## ▶ 2026-08-10 — relay session 9 — 🟢 **N10 FINDING 3 FIXED on `fix/n10-milestones-panel-scaling` (`860b7413`, local only, unpushed)**

> NOTE: this branch is cut from `origin/main` (`39b5ea4e`), so this handoff copy lacks session 8's
> section — session 8 (N10 Finding 1, engine fix, `2125b1be`) lives on `fix/n10-pct-deductions-scale`,
> local only. Expect the usual trivial handoff prepend conflict when the branches merge.

The milestones-panel half of the audit's contribution-freeze bug is done. Deliberately NOT stacked
on the unmerged N10 engine branch; the two touch different files and merge independently. One
commit, three files:

- **`src/lib/retirement-projection.ts`**: new `incomeMultipliersByMonth` mirrors the engine's income
  multiplier exactly (promotion snap to `newAnnualSalary/annualBase` incl. immediate past-dated
  promotions, annual raise step in `raiseMonth` with the engine's `i > 0` guard, flat-mode raises
  against the CURRENT annual, zero-base guard). New `projectMilestonesWithGrowth` iterates 240
  months scaling only the **pct** share; new `monthlyContribSplitForAccount` splits flat/pct and the
  legacy `monthlyContribForAccount` now delegates to it (NetWorth/auto-update callers unchanged).
- **`src/pages/Forecast.tsx`**: the milestones memo (`:297`) computes the multiplier series from
  `assumptions` and passes the flat share (flat deductions + transfer rules) and pct share
  separately; `assumptions` added to the memo deps. Same flat-stays-flat rule as the engine fix.
- **`src/lib/__tests__/retirement-projection.growth.test.ts`** — 12 tests: all-ones parity with the
  old closed form (the "no growth ⇒ identical numbers" guarantee), raise step/compound + the i>0
  guard, flat-raise mode, promotion snap + past-dated + zero-base, a hand-walked 12-month loop for a
  mid-window promotion, and the flat/pct split summing to the legacy total.

**Proof: tsc 0, eslint clean on all 3 files, full suite 819/819 (807 + 12 new).** Backup at
`backups/2026-08-10_210000/`. Deliberately NOT changed: the panel still compounds at nominal
`apy/12` (the audit called the geometric-vs-nominal gap minor/note-only, and matching
`projectBalance` is what makes the parity pin exact) and `DEFAULT_APY_FORECAST` is untouched here
(that's Finding 2's fix, already on `fix/n9-panel-apy-fallback`; expect a trivial adjacent-line
merge in `Forecast.tsx` when both land). NOT live-verified (needs a signed-in browser: open
Forecast with a raise enabled and confirm the pct-funded account's year-20 milestone exceeds the
no-growth value while a flat-funded account's doesn't move).

**Finding 4 card FILED** (`conductor ask` `20648b6f`): derive the linked goal's contribution from
the pct deduction vs keep manual — recommended derive. Do not build until Tre answers.
`conductor answers` at session start: nothing outstanding.

**Next up:**
1. File FOUR PRs (`fix/n8-forecast-popup-decimals`, `fix/n9-panel-apy-fallback`,
   `fix/n10-pct-deductions-scale`, `fix/n10-milestones-panel-scaling`) — push/PR denied in this
   relay. Delete merged local branches from an interactive terminal.
2. **Finding 4** — blocked on card `20648b6f`; collect with `conductor answers`, then build.
3. Live-verify N11 (Debt page) and N9/N10 (Forecast page, incl. this panel fix) in a signed-in
   browser.
## ▶ 2026-08-10 — relay session 8 — 🟢 **N10 FINDING 1 FIXED on `fix/n10-pct-deductions-scale` (`2125b1be`, local only, unpushed)**

The engine fix from session 6's audit is built, TDD'd, and green. Branch cut from `origin/main`
(now `39b5ea4e` — that tip only added the session-6/7 handoff docs via PR #79; the N9 fix branch
`fix/n9-panel-apy-fallback` is still local and unpushed). One commit, two files:

- **`src/lib/forecast-engine.ts`**: `perCheck401k` / `perCheckRetireByAcct` are now functions of the
  month's `incomeMultiplier` (`perCheck401kAt` / `perCheckRetireByAcctAt`). Pct-mode deductions read
  `paycheckGrossForForecast * incomeMultiplier`; flat stays flat. PASS 1 computes the per-check
  amount per month (`:902-905` sites); PASS 3 step 4a re-derives the per-account map from the
  month's multiplier — carried on `baseData` as a new `incomeMultiplier` field — because a mixed
  flat+pct set changes its SPLIT after a raise, not just its total.
- **`src/lib/__tests__/forecast-engine.pctDeductionScaling.test.ts`** — the first fully SYNTHETIC
  `ForecastInputs` engine test (every other engine test self-skips without the gitignored real
  fixture, so this one runs in CI). 3 tests, all RED before the fix: pct steps up ×1.10 at the raise
  month and compounds ×1.21 at the second; flat deduction and its per-account delta stay flat while
  the pct account absorbs the raise; a promotion snap scales from its effective month.

**Proof: tsc 0, eslint clean on both files, full suite 810/810 (807 + 3 new) — including the
Tier-A golden real-fixture pins, which did NOT move.** Why they couldn't: the deduction credit only
feeds retirement balances and the popup display fields; net income was already computed from the
scaled `adjustedConfig`, so the cash walk (and every debt-payoff pin) is untouched. Backup of the
original at `backups/2026-08-10_193500/`. NOT live-verified (needs a signed-in browser: open
Forecast with a raise enabled, confirm `401k Contribution` in a post-raise month's popup is higher
than month 0's).

**Decision: Finding 3 does NOT ride along.** It is the same class of bug but in the milestones
PANEL (`Forecast.tsx:297-335` + `retirement-projection.ts`), a different surface with a different
horizon (20y), and the panel has no `incomeMultiplier` concept to reuse — bundling it would have put
a UI-layer change inside an engine PR. It is now the top remaining N9/N10 item.

**Next up:**
1. **Finding 3** — milestones panel freezes contributions for 20 years (and compounds at nominal
   `apy/12` vs the engine's geometric rate — minor). Own small slice on `Forecast.tsx` /
   `retirement-projection.ts`.
2. **Finding 4** — goal contribution should derive from the linked pct deduction; design question,
   file a card for Tre before building.
3. File THREE PRs (`fix/n8-forecast-popup-decimals`, `fix/n9-panel-apy-fallback`,
   `fix/n10-pct-deductions-scale`) — push/PR denied in this relay. Delete merged local branches.
4. Live-verify N11 (Debt page) and N9/N10 (Forecast page) in a signed-in browser.

## ▶ 2026-08-10 — relay session 7 — 🟢 **N9 FINDING 2 FIXED on `fix/n9-panel-apy-fallback` (`1074ac90`, local only, unpushed)**

The small display-only slice from session 6's audit is done. Branch cut from `origin/main`
(now `eb24e14f` — **N11 merged as PR #78**; the multiple #75/#76/#77 commits with the same message
are the conductor retries, all the same fix). One commit, one file:

- `src/pages/Forecast.tsx`: the retirement milestones panel's fallback APY for accounts with no
  `apy_rate` is now **`assumptions.investmentGrowth`** (the same fallback the engine uses at
  `forecast-engine.ts:209`), instead of the hardcoded `DEFAULT_APY_FORECAST = 7`, which was removed.
  `assumptions.investmentGrowth` added to the `retirementProjections` memo deps so the panel
  re-computes when the assumption is edited. This closes the surface disagreement where Tre's Roth
  IRA (`apy_rate NULL`) grew at one rate in the chart and another in the panel on the same page.

**Proof: tsc 0, eslint clean on the file, full suite 807/807.** NOT live-verified (needs a signed-in
browser — open Forecast, set Investment % to something other than 7, and confirm the Roth IRA
milestone numbers move). No dedicated test: exercising this needs a full page render with mocked
contexts, scaffolding that does not exist for Forecast.tsx; the change is a two-line fallback swap.

`conductor answers` this session: "nothing outstanding".

**Next up (unchanged from session 6):**
1. **Finding 1 (N10 engine fix)** — pct deductions frozen at month-0 gross; needs its own branch,
   fixture A/B, and a live pass. The biggest remaining piece; a relay session CAN build it but must
   be honest that live verification waits for a signed-in browser.
2. **Finding 3** — the milestones panel also freezes contributions for 20 years (same class as
   Finding 1, longer horizon); decide whether it rides along with Finding 1's fix.
3. **Finding 4** — goal contribution should derive from the linked pct deduction; design question,
   raise with Tre before building.
4. File the PRs for `fix/n8-forecast-popup-decimals` and now `fix/n9-panel-apy-fallback`
   (push/PR denied in this relay); delete the merged local branches (also denied here).
5. Live-verify N11 on the Debt page (Venture X Purchases/Mo $300, chart non-zero after Mar 2027).

## ▶ 2026-08-10 — relay session 6 — 🔎 **N9/N10 AUDIT DONE — report only, NO code changed. Both are real.**

Tre asked (N9): *"is the Retirement & Investment Growth Projections section properly reflecting
everything? it seems off."* Answer: **no, and here is exactly why.** N10 (percentage 401k/Roth must
scale with income) is confirmed as the biggest cause, plus one surface-disagreement bug of its own.
Everything below was read from code + SELECT-only queries; nothing was written.

### Finding 1 — N10 CONFIRMED in the engine: % contributions are frozen at month-0 gross

- `forecast-engine.ts:227-235` computes `perCheck401k` (and the per-account map at `:241-250`)
  **once**, from `paycheckGrossForForecast` — the month-0 gross. The 60-month loop then does
  `month401kContrib = perCheck401k * paychecksThisMonth` (`:902`, `:905`).
- Meanwhile income itself DOES scale: `incomeMultiplier` compounds annual raises (`:697-704`) and
  snaps to promotions (`:689-694`), and `adjustedConfig` (`:706`) carries it into every income call.
  The multiplier is **never applied to the pct deductions**.
- **The asymmetry is the bug:** take-home is computed from `adjustedConfig` (pay-schedule reads
  deductions off the config it is handed, so the net side scales), but the retirement-asset side
  credits a contribution frozen at today's salary. After the first raise the forecast understates
  retirement balances more every year — over 60 months with 3%/yr growth that compounds.
- **Fix shape (NOT built):** recompute the pct portion of each deduction inside the loop from
  `paycheckGrossForForecast * incomeMultiplier`; flat-mode deductions stay flat (that is what flat
  means). ⚠️ This is a number-moving engine change — it needs its own branch, a fixture A/B, and a
  live pass; the golden fixture may or may not move depending on whether its assumptions enable
  income growth. Do not slip it into another PR.

### Finding 2 — N9's own bug: the panel's fallback APY disagrees with the chart's

- `Forecast.tsx:35` hardcodes `DEFAULT_APY_FORECAST = 7` for accounts with no `apy_rate`; the main
  forecast falls back to **`assumptions.investmentGrowth`** instead (`forecast-engine.ts:209`).
- **This bites on real data:** Tre's Roth IRA has `apy_rate = NULL` (his other three retirement/
  brokerage accounts are explicitly 7). So if the Investment Growth assumption is anything but 7,
  the Roth IRA grows at one rate in the chart and another in the milestones panel on the same page —
  and the page's own tutorial text says Investment Growth % is "applied to investment account
  balances in the projection". Fix: pass `assumptions.investmentGrowth` in as the panel's fallback.

### Finding 3 — the panel freezes contributions too, for 20 years

`Forecast.tsx:297-335` + `projectMilestones` (`retirement-projection.ts:29`) compound today's
`monthlyContrib` flat to year 20 — no income growth, no promotions. Same understatement as
Finding 1 but over a longer horizon. Minor also: the panel compounds at nominal `apy/12`
(`projectBalance:20`) while the engine uses geometric `(1+apy)^(1/12)-1` (`:213`) — small, note only.

### Finding 4 — N10's "and goals" half

A goal's `monthly_contribution` is a manual flat number (`SavingsGoals.tsx:298/:715`). Tre's 5%
401(k) Roth deduction is **pct-mode and linked to a goal** (`goalId e0bd7507…`,
`accountId 1a6890a5…` — verified by SELECT), so that goal neither derives today's true dollar
amount nor scales with raises. Any fix should probably derive the goal's contribution from the
linked deduction rather than duplicating the number.

### What this session did NOT do, deliberately

No code. N9 was dictated as "audit and report before changing anything", the engine fix is
number-moving (needs fixture A/B + live pass), and this relay cannot push or live-verify. The next
session with a signed-in browser should: (1) branch for Finding 2 (small, display-only, cheap),
(2) branch for Finding 1 (engine, own live pass), (3) raise Finding 4's design with Tre.

**Still open from session 5, all still blocked in this relay:** file the two PRs
(`fix/n8-forecast-popup-decimals`, `fix/n11-later-year-purchases`); delete the four merged local
branches; live-verify N11 on the Debt page; N-ordering card still with Tre (`conductor answers`
returned "nothing outstanding" this session).

## ▶ 2026-08-10 — relay session 5 — 🟢 **N11 FIX SHIPPED on `fix/n11-later-year-purchases` (`9e8291be`, local only, unpushed)**

**What shipped (display-only, deliberately):** session 4's N11 diagnosis (on the N8 branch's
handoff copy) stands, but changing the flat `monthlyNewPurchases` itself was rejected — it feeds
`Math.max(cardPurchasesThisMonth, monthlyNewPurchases)` inside the sim
(`credit-card-engine.ts:1291/:1594/:1628`), so raising it to $300 would wrongly charge Venture X
$300/mo for the months BEFORE its rule starts and move the golden fixtures. Instead:
- **New `CardData.steadyMonthlyPurchases`** (buildCardData): same recurring estimate, but each rule
  is counted in the first month it actually fires at/after max(next month, `start_date`) — probes up
  to 3 months forward because a mid-month start can zero its own start month. Equal to the flat
  number when no rule is future-dated, so every existing card is unchanged.
- **`CreditCardEngine.tsx`**: Purchases/Mo stat and the debt-free caption read the steady estimate;
  the post-payoff chart fallback now reads the real per-month series
  (`variableSim.augmentedCCPurchases[i]`) instead of the flat number — a paid-off statement card
  whose spend resumes later no longer draws a $0 line forever.
- The sim reads `monthlyNewPurchases` everywhere, untouched.

**Proof: tsc 0, eslint clean on the 3 files, 807/807 (804 + 3 new in
`credit-card-engine.steadyPurchases.test.ts` — future-dated rule → flat $0 / steady $300; active
rule → both equal; yearly excluded from both). No fixture pin moved — the display-only claim,
demonstrated.** NOT live-verified (needs a signed-in browser). Also honest: mechanism 2 from the
N11 diagnosis (engine `:482` post-window zero) was NOT changed — the "beyond sim range" regime is a
deliberate, commented, Q8-test-pinned choice; every main UI path already passes a full 60-month
purchases array so the zero is unreachable there, and `debt-transaction-generator`'s projections
without purchase arrays compute REVOLVING totals, where $0 for an in-grace card is correct. If
Tre's actual on-screen surface turns out to be something else, that needs one signed-in repro
naming the page.

**Also this session:** the four squash-merged local branches (`fix/error-boundary-retry`,
`fix/duplicate-link-toast`, `fix/auth-navigate-catch`, `feat/split-link-slice-c`) could NOT be
deleted — `git branch -D` is permission-blocked in this relay. Delete from an interactive terminal.

**Open:** file TWO PRs (`fix/n8-forecast-popup-decimals` — behind 1, trivial rebase over the docs
commit — and `fix/n11-later-year-purchases`, cut from current `origin/main` `b75758b9`); delete the
four merged branches; live-verify N11 on the Debt page (Venture X Purchases/Mo should read $300 and
the chart line go non-zero after Mar 2027); N-ordering card still awaiting Tre.

## ▶ 2026-08-10 — relay session 2 — 🟢 **ALL THREE FIX PRs ARE MERGED. Local `main` synced to `89e6747e`, 804/804 green. Fix workstream CLOSED.**

**The board moved again since section 1c below: Tre filed and merged all three PRs.** Verified by
CONTENTS, not by "it says merged":

- **#71** `f0c56152` ErrorBoundary retry (resetQueries + remount + reload escalation)
- **#72** `cf332a59` friendly duplicate-link 409 messages (`git grep friendlyReviewWriteError origin/main` hits)
- **#73** `89e6747e` AuthContext post-sign-in `.catch()` (`git grep "Post-sign-in navigation chain failed" origin/main` hits)

**Done this session:**
- `conductor answers` — **works in this relay** (previous sessions' permission block is gone) and
  returned "nothing outstanding". Nothing from Tre is pending.
- Confirmed no local branch holds unmerged code: `git diff origin/main fix/auth-navigate-catch -- src supabase`
  is **empty**; the other three branches only LACK what main gained (all diffs are deletions-from-main).
- Local `main` fast-forwarded `82206a05` → `89e6747e` (`git pull --ff-only`), `npm install` re-synced.
- **Verified the merged combination, not just each PR:** `npx tsc --noEmit` 0, **full suite 804/804**
  (104 files) — 788 base + 12 (#72) + 4 (#71), counts reconcile exactly.
- NOT verified: `npm audit --audit-level=high` (command permission-blocked this relay). The gate was
  green pre-merge and none of the three PRs touched deps beyond the lockfile churn from #70.

**Housekeeping still open (needs perms this relay doesn't have):**
- Local branches `fix/error-boundary-retry`, `fix/duplicate-link-toast`, `fix/auth-navigate-catch`,
  `feat/split-link-slice-c` are fully merged and safe to `git branch -d` (deletion was
  permission-blocked here). Remote `feat/split-link-slice-c` can be deleted on GitHub.

**What is actually left on the backlog (nothing else from the fix workstream):**
1. **The upstream dashboard crash** — still unidentified; needs a REAL repro with the console open
   (read the `Page render error:` line ErrorBoundary logs). Cannot be staged unattended.
2. **The N1-N12 standing backlog** (see the 2026-08-09 section below) — session 130's instruction
   stands: **ask Tre which he wants first.** A card was filed via `conductor ask` this session.
3. `@capacitor/cli` moderate-advisory chain — needs an 8.x major + mobile verification. Leave it.
4. TypeScript 7 (Dependabot #65) — still HOLD, build genuinely breaks.
## ▶ 2026-08-10 — relay session 3 — 🟢 **N8 SHIPPED on `fix/n8-forecast-popup-decimals` (local only, unpushed). Forecast popup shows exact cents on every line.**

**Why N8:** `conductor answers` returned nothing outstanding (the N-ordering card from session 2 is
still unanswered). N8 is the smallest verbatim-requested backlog item — cosmetic, no migration, no
live writes, cannot conflict with whatever ordering Tre answers. Assumption stated on the board.

**What changed** (one commit on the new branch, cut from `origin/main` `89e6747e`):
- `src/lib/forecast-engine.ts` — the Month Breakdown popup's balance lines were the only numbers
  still whole-dollar ("not just part of them" = exactly this block). Following the file's own
  `rawEndingCash` pattern: new `rawNetWorth` / `rawTotalAssets` / `rawTotalLiabilities` /
  `rawCcDisplayBalance` / `rawTotalCCPurchases` on `ForecastMonthRow`; the rounded twins are
  untouched so the chart/table/milestones render exactly as before. `assetBreakdown` and
  `nonCCLiabBreakdown` balances are no longer pre-rounded (popup + CSV export are their only
  readers, and the export now matches the drawer to the cent instead of to the dollar).
- `src/pages/Forecast.tsx` — the drawer's asset/liability/CC/net-worth lines render the raws with
  `formatCurrency(..., true)`; the per-card CC balance dropped its `Math.round`. The cash-walk
  lines already showed cents (Tre 2026-08-06 decision) — unchanged.
- **Decision recorded in the engine comment:** the 2026-08-06 "balances stay rounded" call is
  superseded BY TRE'S OWN later N8 ask, for the popup surface only. Chart series stay rounded, so
  the chart hover tooltip still shows whole dollars — it mirrors the plotted line, and unrounding
  the series is a bigger change nobody asked for. If Tre meant the hover tooltip too, that is the
  follow-up: unround the chart series fields or feed the tooltip the raws.

**Proof:** new fixture-gated test `src/lib/__tests__/forecast-popup-decimals.test.ts` — every raw
rounds to its display twin (popup and table can never disagree on dollars), raw assets − raw
liabilities = raw net worth to the cent, and at least one raw carries cents (fails if someone
re-rounds them at the push site). **tsc 0, eslint clean on the 3 files, full suite 805/805** (804 + 1).
**NOT verified live** — the drawer needs a signed-in browser session; the change is string
formatting on an unchanged code path, covered by the test.

**Open:** file the PR for `fix/n8-forecast-popup-decimals` (three steps). Branch cleanup from
session 2 still owed (`fix/error-boundary-retry`, `fix/duplicate-link-toast`,
`fix/auth-navigate-catch`, `feat/split-link-slice-c` all merged, safe to delete). N-ordering card
still awaiting Tre's answer.

## ▶ 2026-08-10 — relay session 1c — 🟢 **AuthContext defensive `.catch()` SHIPPED on `fix/auth-navigate-catch` (`b6f77bc6`), NOT pushed**

The last open non-Tre code item from below is done. New branch **`fix/auth-navigate-catch`**, cut
from `origin/main` (`9190611f`), one code commit:

- **`b6f77bc6`** — the post-SIGNED_IN chain in `src/contexts/AuthContext.tsx`
  (reviewer reset → MFA probe → `navigate('/dashboard')`) now has a `.catch()`: it logs
  `Post-sign-in navigation chain failed:` and **still navigates to `/dashboard`**, because the user
  is authenticated at that point and being silently parked on `/auth` is the worse outcome. The
  MFA-pending path `return`s inside the `.then` (not a rejection), so the catch cannot bypass a
  working MFA challenge — it only fires when the probe itself throws, and that degrades toward the
  common no-MFA case. This is the DEFENSIVE fix from session 134's diagnosis, explicitly NOT the
  dashboard Try-again bug (fixed separately on `fix/error-boundary-retry`).
- **Proof: tsc 0, eslint clean on the file, full suite 788/788** (788 is `origin/main`'s count; the
  800 figure below is the toast branch's +12). No dedicated unit test — nothing in `src/` mocks the
  supabase auth listener today, and building that scaffolding for a 4-line catch was judged not
  worth it. Not live-verified: the catch path needs a failing reviewer-reset/MFA probe, which cannot
  be staged unattended.
- This branch's `handoff.md` was refreshed from `fix/duplicate-link-toast`'s copy, so all three fix
  branches now prepend the same file — **expect trivial prepend conflicts** when merging the second
  and third PRs.

**`conductor` is still permission-blocked in this relay (both shells)** — `conductor answers` was
never collected and no note/card could be filed. Run `conductor answers` from an interactive
terminal.

**Open, needing Tre (unchanged plus one):**
- File THREE PRs now: `fix/error-boundary-retry`, `fix/duplicate-link-toast`, `fix/auth-navigate-catch`
  (all local-only, all based on `9190611f`).
- Delete or leave `feat/split-link-slice-c` (merged via #70).
- The upstream dashboard crash is still unidentified — needs a real repro with the console open
  (read the `Page render error:` line).

## ▶ 2026-08-10 — relay session 1b — 🟢 **DUPLICATE-LINK 409 TOAST FIXED on `fix/duplicate-link-toast`, NOT pushed. Split link (#70) is MERGED.**

**The board has moved since session 134 wrote the section below: PR #70 (split link, Slice C)
is MERGED into `origin/main` (`9190611f`) — verified by CONTENTS** (`git grep fetchChargeReviews
origin/main` hits 6 in `useSupabaseData.ts`), not by "it says merged". So "open the PR" below is
DONE by Tre, and both remaining items were picked up by this relay:

**1. This session shipped item 2 — the friendly 409.** Branch **`fix/duplicate-link-toast`**, cut
from `origin/main`, one commit **`28903a51` `fix: say duplicate-link 409s in the user's language`**:
- `friendlyReviewWriteError` in `src/lib/synced-transaction-review.ts` maps each partial-index
  violation (`one_rule_link` / `one_plan_link` / `one_car_link` / `one_exclusive`) to a sentence
  naming what the user did; unmapped unique clashes on the review table get an honest generic
  ("updated in another tab — refresh"); **anything that is not a unique violation returns null** so
  RLS/network failures keep their original message.
- Wired into the `onError` of `save`, `setCategory` and `importToLedger` in `useSupabaseData.ts`
  (the three paths that INSERT/UPDATE review rows). `remove`/`removeLink`/`undoImport` are deletes
  and cannot 23505 — left alone.
- **Proof: tsc 0, full suite 800/800 (+12).** A parity test parses the shipped migration SQL and
  fails if any created unique index lacks a specific sentence. **Verified the tests bite:** disabling
  the `one_car_link` branch fails 2 of them.
- **NOT verified live** — reaching the constraint needs a write race on real data, which AGENT.md
  forbids an unattended session to stage. The mapping is exercised against the exact Postgres
  message text captured in session 134's live pass.

**2. The ErrorBoundary fix from the parallel relay session was VERIFIED here, not just trusted:**
on `fix/error-boundary-retry`, `tsc` exits 0 and its 4 tests pass. The diff matches the session-134
diagnosis. One accepted tradeoff, noted for the future: `retryPending` re-arms on the first clean
commit, so a crash that only happens after data arrives gets a soft retry per click rather than
escalating — no automatic loop, each click resets the cache.

**Open, needing Tre (filed nowhere — `conductor` is permission-blocked in this relay, both shells):**
- File the two PRs: `fix/error-boundary-retry` and `fix/duplicate-link-toast` (both local-only,
  both based on `9190611f`; both touch `handoff.md` top — expect a trivial prepend conflict on the
  second merge).
- Delete or leave `feat/split-link-slice-c` (merged via #70; remote branch can be deleted).
- Still open from below: the upstream dashboard crash (unidentified — needs a real repro with the
  console open), and the defensive `.catch()` in `AuthContext.tsx:213-221`.
## ▶ 2026-08-10 — relay session 1 — 🟢 **DASHBOARD "Try again" BUG FIXED on `fix/error-boundary-retry` (`84a6a686`), NOT pushed**

The session-134 diagnosis below was implemented as designed, on a fresh branch cut
from `origin/main` (`9190611f`) — kept off the split-link branch as instructed.

**What changed** (`src/components/shared/ErrorBoundary.tsx` + new test file):
- `handleRetry` now calls `queryClient.resetQueries()` (a function wrapper provides
  the client via `useQueryClient`; public API unchanged) and bumps a `key` on the
  children so they get a genuinely fresh mount, not a re-render over crashed state.
- **Escalation:** if a retry crashes again, the button becomes **`Reload page`** and
  calls `window.location.reload()` — Tre confirmed reload always works. The flag
  re-arms after any clean render, so a later unrelated crash gets a soft retry first.
- `reload` is an injectable prop on the exported `ErrorBoundaryInner` (jsdom cannot
  mock `window.location.reload`); the default export behaves as before.

**Proof:** 4 new tests (recover-on-transient + resetQueries called, escalate-on-persistent,
re-arm after recovery, normal render). **tsc 0, full suite 792/792.** No live pass — the
crash needs the real sign-in race, which the handoff says is not reproducible on demand;
the upstream crash (second half of the bug, boundary log at `ErrorBoundary.tsx` catch)
is **still unidentified** — next real repro, read the `Page render error:` console line.

**Not done, still open:**
- Branch is **local only** (push/PR denied for this relay). Filing it is the three-step PR.
- `conductor answers` is **permission-denied in this relay session** (both shells) — run it
  from an interactive terminal; nothing here collected Tre's tapped answers.
- The split-link PR (item 1 below) still needs filing; the 409 message slice (item 2) untouched.
- The missing `.catch()` on `AuthContext.tsx:213-221` — defensive, not this bug, still unfixed.

## ▶ 2026-08-10 — session 134 — 🟢 **SLICE C IS LIVE-VERIFIED AND THE MIGRATION IS APPLIED. Split link works on Tre's real account.**

> **START HERE.** Branch **`feat/split-link-slice-c`**, rebased onto current `origin/main` (jsdom 30
> included) — **`0 7`**, clean rebase. **788/788 tests under jsdom 30, tsc 0.** The migration is
> **APPLIED to the live database**. Account restored byte-for-byte and verified against the backup
> with `EXCEPT ALL` **in both directions: 0 and 0**. Nothing pushed, no PR yet.

### 🔬 THE FINDING THAT MATTERS — the handoff's ordering premise was WRONG, and the live pass proved it

Sessions 131-133 all asserted that Slice C's code was a **pure no-op under today's UNIQUE**, so the
UI could ship and be live-verified BEFORE the migration. **It is not, and it cannot.** Measured, not
reasoned:

| sequence, pre-migration | result |
|---|---|
| set a category on a clean charge | ✅ works (`categorized` row, INSERT) |
| change that category | ✅ works, **same row id** (UPDATE branch) |
| **then link it to a bill** | ❌ **POST 409** — `duplicate key value violates unique constraint "synced_transaction_reviews_synced_transaction_id_key"` |
| link a bill on a CLEAN charge | ✅ works (one `linked_rule` row) |
| **then set a category on it** | ❌ **POST 409**, same constraint |

**Root cause:** Slice C routes the exclusive decision and the link to **two different rows** by
design. Any charge needing two rows violates `UNIQUE (synced_transaction_id)`. Before Slice C the
link write UPDATED the single row and carried `category_override` forward, so the sequence worked.
**So the code and the migration are ONE deployable unit** — shipping `9c2fb6bc`/Slice C without the
migration is a live regression on the ordinary path "categorize a charge, then link it to a bill".
The 409 does surface (a toast), but as raw Postgres text a user cannot act on.

⚠️ **Do not restore the old ordering advice.** The migration must land with or before the code.

### ✅ THE MIGRATION IS APPLIED — and it was safe to apply ahead of the code

`supabase/migrations/20260810_synced_transaction_reviews_split_link.sql`, applied via
`apply_migration`. Verified after: the old `synced_transaction_reviews_synced_transaction_id_key`
constraint is **gone**, and all four partial indexes exist —
`one_exclusive`, `one_rule_link`, `one_plan_link`, `one_car_link`.

🔬 **Checked before trusting it, because the migration is now live while production still runs
`main`:** `origin/main` already contains Slice B, so **no review write path on main passes
`onConflict`** (the only three hits are two explanatory comments and an unrelated
`user_id,snapshot_date` upsert on net-worth snapshots). Production's SELECT-then-UPDATE-or-INSERT is
unaffected by the relaxed constraint, and `one_exclusive` preserves import idempotency exactly. **The
live app is not broken by this migration sitting ahead of the code.**

### ✅ THE SECOND LIVE PASS — the feature demonstrated on Tre's real data

Same test charge `1cf1cd2a…` (Dave & Buster's, 2026-07-25, past month so no forecast can move):

| step | result |
|---|---|
| category, **then** link (the 409 case, re-run post-migration) | ✅ **no error**, badge `linked · Chewy` |
| **the category SURVIVED the link** — the one flagged regression risk | ✅ select still reads `Groceries`; DB shows `categorized` row holding the override and `linked_rule` row with `category_override` NULL |
| "Link another bill" → a second rule | ✅ **two badges**: `linked · Chewy` and `linked · Claude` |
| `Undo all` appears only at ≥2 links | ✅ appeared on the second link, absent on the first |
| exclusive destinations hidden while links exist | ✅ only "Link another …" offered; "Add to my ledger"/"Ignore" gone |
| **per-link ✕ removes one and leaves the other** (`removeLink`'s first live exercise) | ✅ Chewy gone, Claude and the category both intact |
| final undo → charge clean | ✅ **69 rows, 0 `occurrence_date`, 0 on the test charge, EXCEPT ALL 0/0 vs the backup** |

### ⬜ WHAT IS OWED NOW

1. **Open the PR** — `git push -u origin feat/split-link-slice-c` → `gh pr create` → `conductor pr N`.
   The migration is already live, so the PR is the code half catching up to it. Say so in the body.
2. ⚠️ **A better error than the raw constraint name.** The 409 toast printed
   `duplicate key value violates unique constraint …`. Post-migration the reachable version is "the
   same bill linked twice" (`one_rule_link`). That is a real user action with an unreadable message.
   Not blocking the PR; worth its own small slice.

### 🐛 SEPARATE BUG — "dashboard fails to load on initial login sometimes". **Diagnosed, NOT fixed.**

**Kept off the split-link branch deliberately — it needs its own branch cut from `main`.**

⚠️ **The first hypothesis was WRONG and is recorded so nobody re-runs it.** I proposed the missing
`.catch()` on the sign-in navigate chain in `AuthContext.tsx:213-221`. **Tre's symptom rules it out:**
he *lands on the dashboard*, so the navigate fired. (The missing `.catch()` is still real and still
worth a defensive fix, but it is not this bug.)

**Tre's actual symptom, and it is the whole diagnosis:** the dashboard shows the
**`Try again` button — `src/components/shared/ErrorBoundary.tsx:66` — and clicking it does nothing.
Reloading the page always works.**

**Root cause, in `handleRetry` (:37):**

```ts
handleRetry = () => {
  sessionStorage.removeItem(RELOAD_FLAG);
  this.setState({ hasError: false, error: null, reloading: false });
};
```

It clears the boundary's own flag and nothing else, then re-renders **the same children over the same
state that just crashed** — so the render throws again, `getDerivedStateFromError` fires again, and
the user sees the identical screen. "Clicking does nothing" is exactly what a retry that resets
nothing looks like. A full reload works because it rebuilds the QueryClient cache and the module
state from scratch.

🔬 **Checked, so the fix is not designed against a guess:** there is **no `throwOnError`, no
`useSuspenseQuery` and no `suspense: true` anywhere in `src/`**, so React Query is *not* throwing
into this boundary. The thrower is an ordinary render crash — most likely a component reading
loaded-shaped data during the sign-in race, when the query has not resolved. **That upstream crash is
the second half of this bug and is NOT yet identified** — the retry fix makes it recoverable, it does
not make it stop happening.

**Suggested fix, in this order:**
1. Make retry actually reset the data layer: `queryClient.resetQueries()` (needs the client — either
   a `useQueryClient` wrapper around the class, or `QueryErrorResetBoundary`), plus a `key` bump on
   the children so they get a genuinely fresh mount.
2. **Escalate on a second failure.** If a retry throws again, `window.location.reload()` — Tre has
   confirmed reload always works, so the escape hatch is known-good rather than hypothetical. A
   button that silently does nothing twice is worse than one that reloads.
3. Then find the upstream crash: reproduce on a real sign-in with the console open and read the
   `console.error('Page render error:', …)` at **:26** — the boundary already logs the message and
   component stack, so the offending component is one login away from being named.

---

## 2026-08-10 — session 133 — 🟡 ~~SLICE C IS BUILT, REHEARSED AND GREEN. ONE THING BLOCKS IT: SIGN-IN.~~ (live pass DONE — see above)

> **START HERE.** Branch **`feat/split-link-slice-c`**, now **rebased onto `main`** (the 6 dependency
> bumps, including framer-motion 13 and react-resizable-panels 4 — clean rebase, no conflicts).
> **788/788 tests, tsc 0, eslint clean, tree clean.** Three commits: `9c2fb6bc` (Slice C part 1, from
> session 132), **`dbebf460`** (the owed routing tests), **`8f77decd`** (the migration, WRITTEN AND
> NOT APPLIED). Nothing pushed, no PR.
>
> **The live UNIQUE constraint is still in place and the live table is untouched: 69 rows,
> `imported 55 · linked_rule 11 · linked_plan 1 · linked_txn 2`, 0 rows carry `occurrence_date`.**

### 🟢 THE BLOCKER IS CLEARED — Tre signed in. **START THE LIVE PASS IMMEDIATELY.**

Probed and confirmed at the end of session 133: **signed in as `tre@treforged.com`** on
`http://localhost:8080`, refresh token present, tab parked open on `/dashboard`. Board card
`c1532724` can be closed.

⚠️ **The live pass was NOT started, and the reason was context, not doubt.** Session 133 hit ~178k
tokens right as the sign-in landed. A live pass writes to Tre's real account and then restores it, so
being compacted halfway through would strand test rows on his data with no session left to clean
them up. **Nothing is unknown about it — the full script is in the section directly below. Just run
it.** If sign-in has lapsed again by then, see the demo-mode warning below (demo is NOT a fallback).

⚠️ **Demo mode is NOT a fallback here, and this was measured rather than assumed.** `/transactions` →
Bank Activity in demo renders **"No bank activity yet"** — the demo fixture has no synced
transactions at all. So *nothing* about split link can be verified in demo. (Session 130's demo-mode
pass worked because Budget Control has demo data; Bank Activity does not.) Also: demo is in-memory
with no route, so a hard `navigate` after "Try Demo" drops straight back to `/auth` — enter demo,
then move by clicking the app's own links.

### ⬜ WHAT IS STILL OWED — the live pass, then the apply. In that order.

**1. THE LIVE PASS**, unchanged from session 132 and still the right test: under today's UNIQUE this
should be a **pure no-op** on Tre's account. Test charge is ready and unreviewed again:
**`1cf1cd2a-37a3-44fd-a6c5-d621e77f63ba`** (Dave & Buster's, 2026-07-25, $7.50 — a past month, so no
forecast can move). Drive on `/transactions` → Bank Activity:
- unreviewed row → set a category → one `categorized` row, override set (`setCategory` INSERT);
- change it again → **same row id** (UPDATE branch);
- link it to a bill → badge reads `linked · <rule>`, and the **✕ on the badge** removes just it
  (`removeLink`'s first live exercise — it had no caller before `9c2fb6bc`);
- ⚠️ **the category must SURVIVE the link.** The link write no longer carries `category_override`
  forward; the label is supposed to stay on the exclusive row. **If the category disappears when you
  link, that is the one regression this commit could plausibly have introduced — check it first.**
- Undo → row gone; re-verify **69** and **0 `occurrence_date`**.

**2. APPLY THE MIGRATION** — `supabase/migrations/20260810_synced_transaction_reviews_split_link.sql`.
Then the second live pass that actually demonstrates the feature: link one charge to two rules with
**different `occurrence_month`s** (the arrears case), confirm two badges, confirm per-link undo
removes one and leaves the other.

### ✅ THE BACKUP IS TAKEN — do not take another

`backup.synced_transaction_reviews_20260810`, the whole table (69 rows, and the table holds only
Tre's rows). **Verified rather than assumed:** `EXCEPT ALL` in *both* directions returns 0 rows, and
it carries **zero `anon`/`authenticated` grants**, matching the 2026-08-07 precedent. Free tier means
no PITR, so this snapshot is the only way back. Keep it (see `project_supabase_backup_schema`).

### 🔬 THE MIGRATION WAS REHEARSED ON A CLONE — it is proven, not merely written

Rather than apply it and find out, the four indexes were built on a full copy of the real table and
probed, then the clone was dropped. Two results worth carrying:

- **All four indexes BUILT over the real 69 rows.** That is the finding that de-risks the apply:
  today's live data violates none of the new constraints, so the migration cannot fail partway.
- Behaviour, on real-shaped rows:

| probe | result |
|---|---|
| second link to a **different** rule, different month (the arrears case) | **ALLOWED** — correct, this is the feature |
| the **same** rule twice on one charge | **REJECTED** — correct |
| an exclusive row **beside** links | **ALLOWED** — correct |
| a **second** exclusive row | **REJECTED** — correct, import idempotency preserved |

`backup.split_link_rehearsal` and `backup.rehearsal_log` were dropped afterwards; only the real
snapshot remains.

### ✅ `dbebf460` — the tests session 132 said were owed

19 tests on the routing helpers (`linkTarget`, `findExclusiveReview`, `findReviewRowFor`,
`applyReviewToSet`) in the file that already owns the set rules. **Verified they bite, not just
pass:** stubbing `findReviewRowFor` to return `rows[0]` fails 7 of them.

### ✅ `8f77decd` — and a parity test that makes "one rule written twice" real

The index predicate and `LINK_STATUSES` are the same rule in two languages, and no compiler spans
them. `synced-transaction-review.migrationParity.test.ts` **parses the shipped SQL** and asserts the
`NOT IN` list equals the Set. Verified it bites: removing `'linked_car'` from the predicate fails it.
The drift is quiet in both directions — the app offering a link the database rejects, or a charge
silently holding two exclusive rows, which is idempotency gone.

### 🔬 THE `audit` ADVICE IN THE SECTION BELOW IS NOW STALE — corrected here

Session 132 said "do not treat a red `audit` on a Dependabot PR as signal until the **nanoid**
advisory is cleared". **The six merges cleared it.** `npm audit --audit-level=high` — which is
exactly what `.github/workflows/dependency-audit.yml:33` runs — now **exits 0** on this tree.
**A red `audit` is real signal again.** What remains is 3 **moderate** advisories in one chain
(`@capacitor/cli` → `xcode` → `uuid`); they do not fail the gate, and the only fix is a
`@capacitor/cli` 8.x **major**, which touches native builds and is its own task with its own mobile
verification. Not casual work — leave it.

### ⬜ The two open Dependabot PRs, re-checked live this session

- ✅ **#66 jsdom 30.0.1 — MERGED** (Tre asked directly, end of session 133). Verified by CONTENTS:
  `"jsdom": "^30.0.1"` is in `origin/main`'s `package.json`, not by "it says merged".
  ⚠️ **So `main` has moved again and this branch is 1 behind.** jsdom is the **test DOM** and this was
  a MAJOR bump, so **rebase and re-run `npx vitest run` before opening the PR** — a jsdom major is
  exactly the kind of thing that turns tests red without touching a line of app code.
- **#65 TypeScript 7.0.2 — still HOLD, and now confirmed rather than repeated.** Its base is
  `82206a05`, i.e. current `main`, so it is NOT stale — and it still fails **both `audit` and
  `Vercel`**. The build genuinely breaks. Do not merge it to clear the board.

---

## 2026-08-10 — session 132 — 🟡 **SLICE C PART 1 SHIPPED `9c2fb6bc`.** (live pass still owed — see above)

> **START HERE.** Branch **`feat/split-link-slice-c`**, cut from `origin/main` (**not** from local
> `main` — see the git note below). **763/763 tests (+1), tsc 0, eslint clean on every changed file.**
> Backups: `backups/2026-08-10_010619/`. Nothing pushed, no PR.
>
> The **code** half of Slice C is done and the **schema** half is not. That order is deliberate and
> was decided in session 131: every array is length 1 under today's `UNIQUE`, so the UI renders
> identically until the constraint is relaxed, which means the UI can be live-verified BEFORE the
> irreversible bit.

### ⬜ THE TWO THINGS OWED, in this order

**1. LIVE PASS of the code, under today's UNIQUE.** It should be a pure no-op on Tre's account —
that is the claim to test. Every charge holds ≤1 review row today, so every badge, every category
and every button must look exactly as it did before. What to drive on `/transactions` → Bank
Activity (`http://localhost:8080`, dev server is UP, `user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf'`):
- an unreviewed row → set a category → still one `categorized` row, override set (`setCategory`
  INSERT, now routed through `findExclusiveReview`);
- change it again → **same row id** (UPDATE branch);
- link it to a bill → badge reads `linked · <rule>`, and the **✕ on the badge** removes just it
  (`removeLink`, which had NO caller until this commit — this is its first live exercise);
- ⚠️ **the category must SURVIVE the link now.** Before this commit the link write carried
  `category_override` forward onto its own row; now it does not, and the label is supposed to stay
  on the exclusive row instead. **If the category disappears when you link, that is the one
  regression this commit could plausibly have introduced — check it first.**
- Undo → row gone; then re-verify the account is byte-for-byte:
  `imported 55 · linked_rule 11 · linked_plan 1 · linked_txn 2` = **69**, **0 rows carry
  `occurrence_date`**.

**2. THE MIGRATION — the irreversible half. ⚠️ BACK UP FIRST.** Free tier means no PITR (see
`project_supabase_backup_schema`), so snapshot `synced_transaction_reviews` into the locked-down
`backup` schema exactly as 2026-08-07 did, BEFORE applying anything. The schema, unchanged from the
session-131 design and still authoritative:
- `DROP CONSTRAINT synced_transaction_reviews_synced_transaction_id_key`
- `unique (synced_transaction_id) where status not in ('linked_rule','linked_plan','linked_car')`
- `(synced_transaction_id, rule_id) where rule_id is not null`
- `(synced_transaction_id, payment_plan_id) where payment_plan_id is not null`
- `(synced_transaction_id, car_fund_id, car_charge_kind) where car_fund_id is not null`

⚠️ The predicate of the first index is `LINK_STATUSES` in `src/lib/synced-transaction-review.ts`.
**They are one rule written twice** — if the migration and that Set ever disagree, the app and the
database disagree about how many decisions a charge may hold. The file says so; keep it true.

Then a SECOND live pass — the one that actually demonstrates the feature, which the first cannot:
link one charge to two rules with **different `occurrence_month`s** (the arrears case), confirm two
badges, confirm per-link undo removes one and leaves the other.

### ✅ What `9c2fb6bc` actually changed

| File | Change |
|---|---|
| `src/lib/synced-transaction-review.ts` | `linkTarget` **exported**, + `TargetableReview`, `findExclusiveReview`, `findReviewRowFor`, `applyReviewToSet` |
| `src/hooks/useSupabaseData.ts` | `findChargeReviewId` → **`fetchChargeReviews`** (the SET, `select('*')`); `save` routes via `findReviewRowFor` and runs **both** validators; `setCategory` + `importToLedger` target the **exclusive** row |
| `src/components/transactions/BankActivity.tsx` | `reviewByTxn` → **`reviewsByTxn: Record<string, Row[]>`**; `linkLabel()`; one badge per link with per-link ✕; "Link another …"; `Undo all` at ≥2 links |
| `src/lib/synced-transaction-import.ts` | `ctx.review` → **`ctx.reviews`** (a set); `linked_plan`/`linked_car` added to `BLOCKING_STATUSES` |
| `src/lib/__tests__/synced-transaction-import.test.ts` | renamed to the set shape, +1 test ("refuses when ANY of several decisions blocks") |

### Decisions taken this session — do not re-litigate

- **Routing enforces the set rules; validation is the backstop.** An exclusive decision always lands
  on the exclusive row and a link always on the same-target row, so "two exclusive rows" and "the
  same thing linked twice" are unreachable rather than rejected. `validateReviewSet` still runs — a
  rule enforced in two places survives one of them being edited.
- **The exclusive destinations are hidden once a charge has links.** "Link to an entry", "Add to my
  ledger" and "Ignore" disappear while ≥1 link exists, because "this whole charge is that entry"
  contradicts "this charge paid these three bills". Removing a link with its ✕ brings them back.
  The set validator would ALLOW `linked_txn` beside links; this is a UI choice on top of it.
- **`Undo all` only appears at ≥2 links.** With one link the ✕ already is the undo, and two controls
  doing the same thing differently is how a user ends up unsure which one keeps their category.
- **`linked_plan`/`linked_car` added to `BLOCKING_STATUSES`** — strictly more conservative, and both
  cases were already unreachable via `isHandledReview`. Two lists that were meant to agree.

### ⚠️ TESTS OWED — the new pure helpers have NO tests of their own

`763/763` is green but **+1 only**. The routing functions (`findReviewRowFor`, `findExclusiveReview`,
`applyReviewToSet`) are covered only indirectly. They are the highest-value thing in the commit and
they are exactly the shape `synced-transaction-review.splitLink.test.ts` already tests well — add a
block there: link-another INSERTs, same-target UPDATEs, exclusive always routes to the exclusive row,
and `applyReviewToSet` does not mutate its input.

### ✅ ALSO DONE THIS SESSION (Tre asked directly) — repoint + 6 Dependabot merges

**`main` is repointed and correct.** `git tag pre-squash-main-20260810 main && git branch -f main
origin/main`. `origin/main...main` is now **`0 0`**. The old 35-commit history is preserved on the
tag if it is ever wanted; nothing was lost, because the trees were byte-identical.

**6 of 8 Dependabot PRs merged**, verified by contents (`setup-java@v5.7.0` present in
`origin/main`'s workflows), not by "it says merged": **#61, #62, #63, #64, #67, #68**.
`main` is now `82206a05`.

🔬 **The finding that unblocked them, worth keeping:** every one of those PRs showed a failing
`audit` check, which reads as "six broken upgrades". It is not. `npm audit` fails on **`main` itself**
— a pre-existing **`nanoid <3.3.17`** high-severity advisory in the current lockfile — so `audit` red
is repo-wide noise, present on every PR regardless of content. Their build and test checks were all
green. **Do not treat a red `audit` on a Dependabot PR as a signal until that advisory is cleared**
(`npm audit fix` would do it, and is its own small piece of work nobody has done).

⬜ **Two PRs still open, both deliberately:**
- **#65 TypeScript 7.0.2 — HELD BACK, and this one is real.** It fails **Vercel** as well as `audit`,
  i.e. the build genuinely breaks. A major TS bump across this codebase is its own task with its own
  live pass. Do not merge it to clear the board.
- **#66 jsdom 30.0.1 — lockfile conflict** caused by the six merges landing ahead of it.
  `@dependabot rebase` was posted; it should go green on its own and can then be merged as normal.

⚠️ **`feat/split-link-slice-c` is based on `d1e9afab`, which is now 6 commits behind `main`.** Those
6 are dependency bumps including **framer-motion 13** and **react-resizable-panels 4** (majors).
**Rebase onto `main` and re-run `npx vitest run` + `npx tsc --noEmit` BEFORE the live pass**, or the
live pass verifies a tree nobody is going to ship. `npm install` first — `node_modules` is stale
relative to the new lockfile.

### 🧷 A GIT NOTE — RESOLVED, kept for the reasoning

**Local `main` is 35 commits ahead of `origin/main` and that is a lie.** PR #69 was **squash-merged**,
so `origin/main` (`d1e9afab`) has a tree **byte-identical** to the old branch head — verified by an
empty `git diff origin/main HEAD`, not by "it says merged". The 35 local commits are the same content
under different hashes.

✅ **FIXED this session** — Tre authorised it and `main` now tracks `origin/main` cleanly. Kept here
because the *shape* recurs: after any squash merge, local `main` will look ahead by N while being
content-identical. **Verify by contents (`git diff origin/main HEAD`), never by the ahead/behind
count**, and cut branches from `origin/main` when in doubt.

---

## ▶ 2026-08-09 — this repo is set up for autopilot, and `origin` is finally current

Done from the Conductor session, not from here. Nothing about Slice C changed —
that section is below and still authoritative. **Start there.**

### The 35 commits are pushed

`origin/main` had been **35 commits behind** local `main`, and had been drifting
like that for a long time because nothing in this repo pushes on its own.

That was the single biggest thing standing between this project and unattended
work, and the reason is not tidiness: **a cloud agent only ever sees `origin`.**
It plans against a tree 35 commits old, writes code that assumes the world of a
fortnight ago, and produces conflicts and duplicated work. It is the same root
cause behind the `goal-linkage.ts` mess.

Verified before pushing rather than after: `origin/main...main` was `0 35` — a
pure fast-forward, no divergence — and `npx tsc --noEmit` clean with
**762/762 tests passing** across 101 files. Shipped as one PR rather than a push
to `main`, per the standing rule that opening the PR is what pushes.

**Keep it current from now on.** `git log origin/main..main` before planning
anything, and if that number is climbing again, the autopilot guarantee below
has quietly expired.

### `AGENT.md` — what an unattended session may NOT do

New file, and the important one. `CLAUDE.md` says how to work here; `AGENT.md`
says what is off-limits when nobody is reading the diff.

Three facts drive all of it: **this repository is PUBLIC**, it is a financial
application holding real accounts, and **it has already leaked once** — the real
`forecast-inputs.real.PRE-P0.json` fixture sat here from 2026-07-07 because a
tracked backup copied it past the ignore rule protecting it.

The hard nos: nothing derived from real data, ever, in a commit. No secrets. No
migrations written or applied — free tier means no PITR, so a bad one is
unrecoverable. No writes to live rows. No Stripe or Plaid wiring. No push, PR,
merge or history rewrite from an unattended run. Never delete `handoff.md`.

### The ignore rule protecting the backups was one typo wide

A directory literally named `backups$(date +%Y-%m-%d_%H%M%S)` was sitting in the
working tree — a shell command that never interpolated. **Untracked AND
unignored**, because `.gitignore` said `backups/`, which does not match it. One
`git add -A` from a public repo.

It happened to contain no files, only empty folders, so git could never have
taken it. That is luck, not a control. The glob is `backups*/` now, and the
empty directory is gone. This is the second time a backup has routed around the
one rule protecting it here.

### The AMBIGUITY RULE no longer stops the session

Tre's standing rule as of today, across every repo: **a session never parks and
waits for him.** `CLAUDE.md`'s ambiguity rule used to end "wait for an answer";
it now files the question to the board with `conductor ask` — which returns
immediately — and carries on with what does not depend on the answer, then with
what does under a stated assumption, then with the backlog. `conductor answers`
collects replies at natural boundaries.

The instinct was right and the cost was wrong: a stopped session spends his
attention *and* the session, and a question in a terminal he is not looking at
has not been asked. VERIFY-FIRST still comes first — most "ambiguities" are
facts a tool can settle.

### Still owed, and it is not mine to do

**This terminal does not report to the board.** There is no live session row for
this project. Windows hands user environment variables to a process when it
STARTS, so a window opened before the `CONDUCTOR_*` variables existed will never
see them, and `conductor` cannot authenticate from it. **A new terminal is the
entire fix** — nothing needs reinstalling.

Also open: **8 Dependabot PRs**, several of them majors that would not be safe
to take unattended — TypeScript 7.0.2, framer-motion 13, react-resizable-panels
4. They are noise on the board rather than a blocker, but they are not
autopilot work.

---

## 2026-08-09 — session 131 — 🟢 **SPLIT LINK: SLICES A AND B SHIPPED. B IS LIVE-VERIFIED. Start at Slice C.**

> **START HERE.** `5fa248f0` (Slice A, rules) and `43d807be` (Slice B, the enabler) are committed.
> **762/762 tests (+33), tsc 0, eslint clean, tree clean.** Slice B's four write paths were driven
> through the real UI on Tre's account and the account was restored byte-for-byte — evidence in the
> slice list below. **The `onConflict` blocker is GONE; the migration is now safe to write.**
> Everything else below is the session-130b design, unchanged and still authoritative.
>
> ⚠️ **Slice C is the only slice left, and it is the one that touches the schema. Back up
> `synced_transaction_reviews` into the `backup` schema BEFORE the migration** — free tier means no
> PITR (see `project_supabase_backup_schema`), same as 2026-08-07 did.
>
> Tre asked to "continue to next" after biweekly closed; split link is the next thing he has already
> said yes to, which is why it was picked over the unscoped N1-N12. Tre authorised this in 126b (*"for split links i think
> yes since it can integrate the variable items into cost… forecast can get a better month 0
> picture"*). **Do not re-ask.** His goal is that the **variable** rider (Water/Sewer/Trash, billed
> in arrears) stops being invisible inside the bundled rent charge. Design to that, not to "N rules
> per row".

## 🔬 THE AUDIT — what actually blocks it, measured this session

`UNIQUE (synced_transaction_id)` (re-read live from `pg_constraint`, still present) is doing
**three** jobs, and split link only wants to relax one of them:

1. **Import idempotency** — the migration header says so outright: *"a row already imported cannot
   be imported twice"*. **Must survive.**
2. **The `ON CONFLICT` arbiter for every write path.** ⚠️ **THIS IS THE REAL BLOCKER, and the
   handoff did not know about it.** Three mutations in `useSupabaseData.ts` pass
   `{ onConflict: 'synced_transaction_id' }` — `save` (**:669**), `setCategory` (**:701**),
   `importToLedger` (**:734**). Drop the UNIQUE and **all three fail immediately** with *"no unique
   or exclusion constraint matching the ON CONFLICT specification"*. A partial unique index does
   NOT rescue them: Postgres can only infer a partial index when the statement repeats its
   predicate, and supabase-js `onConflict` takes a bare column list with no `WHERE`.
   **=> The migration CANNOT land before the code. Ordering is not a preference here.**
3. "One decision per charge" in the UI — the only job split link actually wants to relax.

Also load-bearing: **`remove` (:774) deletes by `synced_transaction_id`**, so under multi-row it
silently becomes "remove ALL links on this charge". It needs a per-link sibling, and the existing
whole-charge behaviour is still wanted for Undo-everything.

## ✅ DECIDED — multi-row, NOT a child table

126b floated "drop the UNIQUE **or** add a child table". Multi-row wins, and the reason is
`occurrence_month`: a split link's month must be **PER-LINK** (one bank row settles Rent for THIS
month and Water for the PREVIOUS one). Multi-row gets that for free — each row already has its own
`occurrence_month`/`occurrence_date`. A child table would have to duplicate both columns and leave
the parent's meaningless. Multi-row also keeps 126b's finding true: **`buildConfirmedOccurrences`
already iterates reviews and keys per rule, so the read side needs NO logic change.**

### The schema, once the code is ready

- `DROP CONSTRAINT synced_transaction_reviews_synced_transaction_id_key`
- Partial unique index — **at most one EXCLUSIVE decision per charge**, which is idempotency (1)
  preserved exactly:
  `unique (synced_transaction_id) where status not in ('linked_rule','linked_plan','linked_car')`
- Partial unique indexes so the same thing cannot be linked twice:
  `(synced_transaction_id, rule_id) where rule_id is not null`,
  `(synced_transaction_id, payment_plan_id) where payment_plan_id is not null`,
  `(synced_transaction_id, car_fund_id, car_charge_kind) where car_fund_id is not null`

🟢 **DECIDED — `category_override` stays on the EXCLUSIVE row, and only there.** (Tre, 2026-08-09:
*"do what you think is best"*, having been given this recommendation. **Do not re-litigate.**)

A category describes the CHARGE, not any one of the several things the charge paid — a rent debit
split across Rent and Water has one merchant and one label, not two. So `setCategory` always targets
the single exclusive row (`status not in (linked_rule, linked_plan, linked_car)`), creating a
`categorized` row when none exists, exactly as it does today. Link rows carry `category_override`
NULL and no reader consults them for it.

⚠️ The failure mode this forecloses: with the column left on every row, `setCategory` would write to
whichever row an upsert happened to reach, and a charge could end up asserting two different
categories with no rule for which one wins. Worth a test that pins "N link rows + one category
change = exactly one row holding the override".

## 📋 THE SLICES — each one live-safe ALONE. Do not reorder.

- ✅ **Slice A — rules. SHIPPED. 762/762 (+33), tsc 0, eslint clean.** In
  `src/lib/synced-transaction-review.ts`:
  - `LINK_STATUSES` / `isLinkStatus` — **the one definition of the partial index's predicate.**
    Slice C must use it rather than re-typing `status not in (…)` in the UI.
  - `validateReviewInput` gained **"one row names one thing"** (a `linked_rule` carrying a
    `payment_plan_id` etc.). Load-bearing under multi-row: each link occupies a slot in exactly one
    dedupe index, and `buildConfirmedOccurrences` keys on `rule_id` alone.
  - **New `validateReviewSet(inputs)`** — the rules about the SET, which the per-row validator
    cannot see: at most one exclusive row (= idempotency preserved), no target linked twice, and
    **no `category_override` on a link row**.
  - ⚠️ **Why the category rule is in the SET validator and not the per-row one:** every
    `save.mutate` site in `BankActivity.tsx` today passes
    `category_override: review?.category_override ?? null` when converting a `categorized` row into
    a link, so enforcing it per-row would break the live app before the UI is ready. **Slice C must
    stop passing it and route the category to the exclusive row.** `validateReviewSet` has no
    callers yet — it is the contract Slice C builds against, and Slice C must call BOTH validators.
  - Read side confirmed unchanged by test, not by assertion: N links on one charge, per-link
    months (the arrears case), a date-keyed and a month-keyed link side by side.
- ✅ **Slice B — THE ENABLER. SHIPPED `43d807be` AND LIVE-VERIFIED.** `save`, `setCategory` and
  `importToLedger` in `src/hooks/useSupabaseData.ts` no longer pass `onConflict` — they call the new
  module-level **`findChargeReviewId`** (a LIVE SELECT, deliberately not the cached `query.data`)
  and then UPDATE by `id` or INSERT. Under today's UNIQUE that is exactly equivalent.
  **`removeLink(id)` added** beside the whole-charge `remove`; nothing calls it yet — Slice C's
  per-link undo does.
  - ⚠️ `importToLedger`'s lookup is INSIDE the compensated region (an IIFE returning the error
    rather than throwing). A failed SELECT there would otherwise leave a ledger row with no review
    — the double-count the rollback exists to prevent, reached via the refactor. Do not "simplify"
    that back into a bare `await`.
  - ⚠️ `importToLedger` still writes only the columns the upsert wrote, so an existing row's
    `rule_id` / `occurrence_month` survives an import exactly as before. That may be worth changing
    on its own merits; it was **not** changed here, because widening a write under cover of a
    refactor changes live data silently.

### ✅ SLICE B'S LIVE PASS — done in-app on Tre's real data, all four paths. Do not re-run.

Test charge `1cf1cd2a…` (2026-07-25, $7.50, past month so no forecast could move), driven through
the real Bank Activity UI, each step checked in SQL:

| step | path exercised | result |
|---|---|---|
| set category on an unreviewed row | `setCategory` **INSERT** | new `categorized` row `99402619…`, override `Shopping` |
| change the category again | `setCategory` **UPDATE** | **same row id**, override → `Groceries`, still exactly 1 row |
| Ignore | `save` **UPDATE** | same row id, status → `ignored`, and **`category_override` cleared to NULL** — the "every column is written, including the nulls" claim, demonstrated |
| Undo, then Ignore again | `remove` + `save` **INSERT** | old row gone, **new row id `fb27f6ff…`** |
| Add to my ledger | `importToLedger` | ledger row `b7a5611a…` created, review `imported` pointing at it |
| Undo — deletes the entry | `undoImport` | both gone by FK cascade |

**Account restored byte-for-byte, re-SELECTed after:** `imported 55 · linked_rule 11 · linked_plan 1
· linked_txn 2` = **69**, **0 rows carry `occurrence_date`**, 0 rows on the test charge, test ledger
row gone.
🧪 Method: `updated_at` is CLIENT-generated while `created_at` is a DB default, so a fresh row can
show them ~20s apart. That is clock skew, **not** a second write — do not chase it.

- **Slice C — schema + UI. NOT STARTED, and the only slice left.** `BankActivity.tsx:135`
  `reviewByTxn` `Record<string, Row>` → `Record<string, Row[]>`, a "link another" affordance, and
  multi-badge / per-link undo (call `removeLink`). **:312** `const review = reviewByTxn[txn.id]` is
  the single read to fan out. Then apply the migration.
  - **Use `isLinkStatus` / `LINK_STATUSES` from Slice A** to pick the exclusive row; do not re-type
    the predicate in the UI.
  - **Call `validateReviewSet` as well as `validateReviewInput`** when writing several rows.
  - ⚠️ **Slice C owes the category move:** every `save.mutate` site in `BankActivity.tsx` currently
    passes `category_override: review?.category_override ?? null`. It must stop, and route the
    category to the exclusive row instead — `validateReviewSet` already rejects an override on a
    link row, so the contract is written and tested and waiting.
  - The array shape is safe to build BEFORE the migration (every array is length 1 under today's
    UNIQUE), so the UI can ship and be live-verified first and the migration can land last.

⚠️ **Back up `synced_transaction_reviews` before Slice C.** Free tier = no PITR (see
`project_supabase_backup_schema`); snapshot into the locked-down `backup` schema like 2026-08-07 did.

---

# Handoff — 2026-08-09 — session 130 — ✅ **BIWEEKLY WORKSTREAM COMPLETE. Commit 2 shipped `1b919e04` and LIVE-VERIFIED.**

> **START HERE.** Both commits of the biweekly anchor work are done and verified.
> **729/729 tests, tsc 0, eslint clean, tree clean. Nothing about biweekly is owed.**
> Next is the standing backlog (N1-N12 below, plus split link) — **ask Tre which he wants first.**

## ✅ Shipped `1b919e04` — the rule editor now states the cycle

The field already existed, so this is a relabel plus a caption, not a schema change:

- **Biweekly only:** income → `First Paycheck Date (required)`, expense → `First Occurrence (optional)`.
  Every other frequency renders exactly as before — confirmed live, monthly reverts to
  `Start Date (optional)` with **no** caption.
- **Caption** from `describeBiweeklyAnchor`, in three voices: derived, pinned, and **shifted**.
- `form.start_date` / `form.due_day` / `editCreatedAt` added to the `formFields` deps, or the caption
  goes stale as the user types.
- `editCreatedAt` is new state (set in `openEdit`, cleared in `openAdd` **and `handleDuplicate`** — a
  copy is a new row and gets its own `created_at`, so it must not inherit the original's phase).
- **Still NOT deriving `due_day` from the picked date.** Decided in 129b, unchanged. Do not
  re-litigate without asking Tre.

### 🐛 A REACHABLE TAB HANG, found by wiring this up — fixed in the same commit

`resolveBiweeklyAnchor` did `const dayOfWeek = rule.due_day ?? 5` and then
`while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1)`. **`due_day` holds a DAY OF MONTH on
monthly rules**, so flipping a rule from monthly to biweekly handed it a `15` and the loop hunted
weekday 15 **forever**. The editor calls this on every keystroke while the frequency select and the
due_day input still disagree, so **a two-click UI path froze the tab**. Now clamped to 0-6 with the
module's existing Friday fallback; pinned by a test over `[15, 31, -1, 7, 1.5, NaN]`.
⚠️ The other two `due_day ?? 5` sites (**:224** weekly generator, **:349** count) were checked and are
**bounded** — they return an empty/zero result, they do not spin. Left alone deliberately.

### ✅ LIVE PASS — done in-app, every branch

Sign-in had lapsed, so this ran in **demo mode** against real Vite-served modules (the shipped code,
not a test double). Driving the form's real React state and reading the rendered caption back:

| input | rendered caption |
|---|---|
| no date, due_day 1 | `Repeats every 14 days from Mon, Aug 10, 2026. Set a date to pin your own cycle.` |
| pinned Aug 9, **due_day 0 (matches)** | `Repeats every 14 days from Sun, Aug 9, 2026.` |
| pinned Aug 9, due_day 4 | `Heads up: the schedule will run from Thu, Aug 13, 2026, not the date entered …` |
| **due_day 15** (the hang case) | rendered **instantly**, Fri Aug 14 — no freeze |
| blank due_day | Fri Aug 14 (Friday fallback) |

Labels confirmed live for income and expense, and monthly confirmed to revert with no caption.
Plus `await import('/src/lib/scheduling.ts')` in the browser on **Fuel's real row values**
(`due_day 5`, `start_date null`, `created_at 2026-03-22`) → anchor **`2026-03-27`**, `pinned false`,
`shifted false`. Matches the prediction 129 made from the database.

✅ **THE LAST GAP IS NOW CLOSED (same session, Tre signed in).** Budget Control → Variable →
edit **Fuel** on his real row renders:

> **FIRST OCCURRENCE (OPTIONAL)** — *Repeats every 14 days from **Fri, Mar 27, 2026**. Set a date to
> pin your own cycle.*

That is the derived-from-`created_at` branch, on his data, on his screen, matching both the unit
test and the database prediction. Modal closed **without saving**; the row still reads
`Fuel · Biweekly · Day 5 · From: Prime Visa · $65 · /mo $130`. **Nothing is owed on biweekly.**

### 🧪 Method note worth reusing

The date fields are a `DateScrollPicker`, **not** an `input[type=date]` — there is nothing to type
into. Drive biweekly hint states from the **Day of Week number input** instead (set via the native
value setter + `input` event), which moves the anchor without touching the picker at all. Also:
`[...document.querySelectorAll('select')]` catches the **Income & Tax pay-frequency** select before
the modal's — scope the query to the `.fixed.inset-0` modal first.
⚠️ **Radix tabs and the row action buttons ignore a bare `.click()`** — `aria-selected` never
flips. Dispatch the full sequence `pointerdown,mousedown,pointerup,mouseup,click` as `MouseEvent`s
with `bubbles:true`. Also: `computer` **screenshot timed out** twice on the signed-in Budget page
(heavy paint, renderer NOT actually frozen — `javascript_tool` kept answering). Read the DOM instead
of screenshotting that page.

---

# Handoff — 2026-08-09 — session 129b — ✅ helper SHIPPED `79875125` (the UI wiring it asks for is DONE — see session 130 at the top; kept for its reasoning)

> **START HERE.** The context gate fired mid-commit-2. The tree is **green and clean**
> (728/728, tsc 0, eslint clean) — the atomic action was finished before stopping. What remains is
> one focused edit in one file.

## ✅ Shipped `79875125` — `describeBiweeklyAnchor` in `src/lib/scheduling.ts`

```ts
describeBiweeklyAnchor(rule, today?) -> { anchor: 'YYYY-MM-DD', pinned: boolean, shiftedFromInput: boolean }
```
`anchor` is `toLocalDateStr(resolveBiweeklyAnchor(...))`, `pinned` is "the user set `start_date`",
`shiftedFromInput` is "we moved the date they typed". +6 tests in
`src/lib/__tests__/scheduling.describeAnchor.test.ts`.

## ✅ DONE in session 130 (`1b919e04`) — wire it into the rule editor (`src/pages/BudgetControl.tsx`, ~30 min)

**The finding that shrank this task: the field already exists.** `formFields` (**:781**) already
pushes a `start_date` date field on every rule, and `resolveBiweeklyAnchor` already prefers
`start_date`. So commit 2 is **not** a new column, a new input, or an engine change — it is making
the existing field mean something when `form.frequency === 'biweekly'`. Do this:

1. At **:781**, when `form.frequency === 'biweekly'`, relabel:
   - income → **`First Paycheck Date (required)`** (income already requires `start_date`, :702)
   - expense → **`First Occurrence (optional)`**
2. Add a `hint` (the `Field` type at `src/components/shared/FormModal.tsx:15` already supports one,
   so **FormModal needs no change**) driven by `describeBiweeklyAnchor`:
   - blank `start_date` → "Repeats every 14 days from `<anchor>`. Set a date to pin your own cycle."
   - pinned and unshifted → "Repeats every 14 days from `<anchor>`."
   - **`shiftedFromInput`** → say plainly that the schedule will run from `<anchor>`, not the date
     typed, because `due_day` names a different weekday. **Do not silently swallow this.**
3. For an UNSAVED new rule there is no `created_at`, so pass `{ due_day: Number(form.due_day),
   start_date: form.start_date || null, created_at: null }` and let the `today` fallback answer.
   When editing, pass the real row's `created_at` so the hint matches what the engine will do.
4. `formFields` is a `useMemo` — add `form.start_date` and `form.due_day` to its dep array (**:797**)
   or the hint will go stale as the user types.

**Deliberately NOT doing:** deriving `due_day` from the picked date. It would often be right ("first
paycheck was a Thursday" implies Thursdays), but `due_day` is a field the user also set, and
overwriting one input from another silently is the class of surprise this whole workstream exists to
remove. Show the conflict, let them fix it. **Do not re-litigate without asking Tre.**

Live-verify after wiring: open Budget Control → Variable → edit **Fuel**, confirm the hint reads
**2026-03-27** with no `start_date` set, and that typing a non-Friday date raises the shifted warning.

---

# Handoff — 2026-08-09 — session 129 — ✅ **BIWEEKLY ANCHOR `12d01772` FULLY LIVE-VERIFIED. Live pass CLOSED.**

> **START HERE.** `12d01772` is verified three ways: a before/after A/B on the **real captured
> fixture**, a count of **every biweekly row in the live database**, and an **in-app pass against
> Tre's real data** through the Vite-served module plus a rendered surface. 722/722 tests, tsc clean,
> tree clean. **Nothing about this fix is owed.** Next up is **commit 2** (optional "first
> occurrence" field) and the standing backlog.
>
> 📌 **Phone Bill to Mom starting 2026-10-10 is INTENTIONAL** — Tre confirmed 2026-08-09. Closed.

## ✅ The fixture A/B — the change is NOT inert, and the golden test's silence is explained

Method: temporary diag test (deleted) that ran `generateScheduledEvents` + `calculateForecast` +
`renderProjectionFromFixture` on `forecast-inputs.real.json`, once at HEAD and once with
`src/lib/{scheduling,pay-schedule}.ts` checked out from `12d01772~1`.

| Measure | before | after |
|---|---|---|
| Fuel occurrences, 60-month horizon | **131** | **130** |
| First Fuel dates | 2026-07-24, 08-07, 08-21, 09-04 … | **2026-07-31, 08-14, 08-28, 09-11 …** (all gaps 14) |
| Months whose Fuel count changed | — | **21 of 60** (e.g. 2026-10 3→2, 2027-01 2→3) |
| Sim `allPaymentTotals` (first 18 mo) | — | **3 months moved**: 12 `2417→2346`, 13 `568→633`, 16 `646→581` |
| `calculateForecast(inputs)` rows | — | **identical, every field** |

⚠️ **Why `goldenTierA` did not move — settled, do not re-investigate.** It asserts on
`inputs.cardProjectionData.simRevolvingPayoffMonth`, which is **frozen inside the fixture**, and
`calculateForecast` also consumes the fixture's captured `forecastMonthEvents` / `ccScheduledByMonth`.
That path never regenerates scheduled events, so it is **insensitive by construction** — its silence
was never evidence of a no-op. The sim path (`projection-harness.ts:78`, which *does* call
`generateScheduledEvents`) is the sensitive one, and it moved. Payoff month held at **Jul 2027** on
both arms, so no golden needs re-pinning.

## ✅ Every biweekly row in the live DB — measured, and the risk is real for OTHER users

`select … from recurring_rules where frequency='biweekly'` returns **7 rows, and 6 of them are
INCOME** — five paychecks ($3,900 / $2,000 / $2,185.44 / $624 / $756) plus a $2,925 contribution.
Tre's `Fuel` is the only expense. That is exactly the unsafe direction 126b predicted, and it is
**other people's accounts**, not his.

Counts over the next 12 months, old vs new (diag deleted; rerun by replaying the rows if needed):

| Rule | occ 12mo | months that moved |
|---|---|---|
| $65 expense (Fuel, dd 5) | 26 → 26 | none — but **every date shifts 7 days** (Aug: 07/21 → 14/28) |
| $3,900 income (dd 0) | 26 → 26 | none |
| **$2,925 income (dd 3)** | **25 → 26** | 2026-09 2→3, 2026-12 3→2, 2027-03 2→3 |
| $2,000 income (dd 5) | 26 → 26 | none |
| **$2,185.44 income (dd 3)** | **25 → 26** | 2026-09 2→3, 2026-12 3→2, 2027-03 2→3 |
| **$624 income (dd 4)** | **25 → 26** | 2026-10 2→3, 2027-04 2→3, 2027-07 3→2 |
| $756 income (dd 5) | 26 → 26 | 2026-10 2→3, 2027-01 3→2, 2027-04 2→3, 2027-07 3→2 |

Hand-checked one by arithmetic: the $2,925 rule (`start_date 2026-01-01`, Wednesday) anchors at
**Wed 2026-01-07**; 01-07 + 17×14 = **2026-09-02**, so Sep really does hold 09-02/09-16/09-30 — the
new count of 3 is right and the old 2 was wrong. **A 12-month total near 26 either way is expected**
(365/14 = 26.07); the correction here is *which month* each paycheck lands in, which is what a
month-0 cash picture is made of.

## ✅ IN-APP PASS — DONE. Tre signed in; `12d01772` is LIVE-VERIFIED. Nothing owed.

Run against `http://localhost:8080` with Tre's real data, using `await import('/src/lib/scheduling.ts')`
(Vite serves the module, so this is the **shipped code**, not a test double).

1. **Anchor and dates.** `resolveBiweeklyAnchor(Fuel)` = **Fri 2026-03-27** (created Sun 2026-03-22,
   advanced to the `due_day 5` weekday). Occurrences: Aug **14/28**, Sep **11/25**, Oct **9/23**,
   Nov **6/20** — every gap exactly 14, across every month boundary.
2. **The three call sites agree.** 14 months of `generateScheduledEvents` vs
   `countRuleOccurrencesInMonth` vs `getRuleOccurrenceDatesInMonth` on the live Fuel row:
   **31 events, all gaps 14, ZERO disagreements.** That is the "one definition of the cadence" claim
   demonstrated in the browser.
3. **Rendered surface agrees.** Budget Control → Variable shows
   `Fuel · Biweekly · Day 5 · From: Prime Visa · $65 · /mo $130` = 2 × 65 for August, matching 14/28.
4. **The load-date defect, demonstrated live.** Same rule, same page, varying only the day the app is
   opened:

   | app opened | OLD October | NEW October |
   |---|---|---|
   | Aug 9-14 | Oct 9, 23 | Oct 9, 23 |
   | **Aug 15** | **Oct 2, 16, 30 — three charges, $195** | Oct 9, 23 — $130 |

   The old code re-phased off `max(today, start_date)`, so *the forecast changed because you opened
   the app on a different day.* The new one is stable on every load date.

⚠️ **Honest caveat, worth carrying:** today (Aug 9) the old and new phases **coincide** for Fuel, so
**no rendered number on Tre's account changed today**. Do not read that as the fix being inert — the
A/B above shows it is not, and the four live income rules whose monthly counts move belong to
**other users**. A same-day rendered A/B was simply not available.

---

# Handoff — 2026-08-09 — session 128 — 🟢 anomaly SOLVED + 🟡 **BIWEEKLY ANCHOR SHIPPED `12d01772`, LIVE PASS OWED**

> **START HERE.** Two things landed. `3ec7c725`'s read side is **CLOSED** (details below), and the
> biweekly phase fix Tre authorised is **committed but NOT live-verified**.

## 🟡 BIWEEKLY ANCHOR — commit 1 of 2 SHIPPED `12d01772`. **722/722 tests (+13), tsc 0.**

Tre said **"yes. and go"** (2026-08-09) to commit 1 (derived anchor, silent). It is built.

**What changed.** All three biweekly generators restarted their cycle from scratch — the per-month
one at the first matching weekday of EACH month, the other two at `max(today, start_date)`. Neither
is a phase. Added to `scheduling.ts` as the ONE definition of the cadence:
- **`resolveBiweeklyAnchor(rule, today?)`** — anchor = `start_date ?? created_at`, then advanced to
  the first `due_day` weekday on or after it. ⚠️ **`due_day` wins over the anchor's own weekday** —
  Fuel bills Fridays but was created on a Sunday (`2026-03-22`), so anchoring on the raw date would
  have moved every occurrence to a Sunday. Fuel's real anchor is **Fri 2026-03-27**.
- **`getBiweeklyDatesInMonth(rule, year, month, today?)`** — consumed by all three call sites
  (`generateScheduledEvents`, `countRuleOccurrencesInMonth`, `getRuleOccurrenceDatesInMonth`), so
  they can no longer disagree. New test asserts all three agree month-by-month for 14 months.

**Decisions made — do not re-litigate:**
- **WEEKLY UNTOUCHED.** A 7-day step cannot drift across a month boundary; 126b verified weekly is
  already correct (52/yr, all gaps 7). Pinned by a test.
- **NO MIGRATION NEEDED.** 126b feared re-phasing would strand stored `occurrence_date`s off-phase.
  Checked live: **zero rows in the entire database carry an `occurrence_date`** (all users, not just
  Tre). The concern is moot. Nothing to null out.
- **`created_at` is safe as the fallback** — verified non-null for every row in `recurring_rules`.
- Anchor reads the **date part** of both columns at local noon, so the phase cannot shift with the
  viewer's timezone.
- **26 vs 27 a year is both correct** (365/14 = 26.07); the real invariant is that every gap is
  exactly 14. My first test asserted a flat 26 and was wrong — fixed.

### ✅ ~~THE LIVE PASS IS OWED AND NOT STARTED~~ — DONE in session 129 except the in-app render (see top)

⚠️ **This moves projected numbers for every biweekly rule**, which is the whole point, so it needs a
live pass of its own. Tre's only biweekly rule is **`Fuel`** (`002f7e28…`, $65, Friday, no
`start_date`) and it is **funded by Prime Visa**, so it is **excluded from month-0 forecast expenses**
by `allCcRuleIds` — *do not expect the Aug/Sep `baseExpenses` probe to move.* Look instead at a
surface that shows CC purchases: the **CC engine / Debt Payoff** projection, or Fuel's occurrence
COUNT per month before vs after.

⚠️ **The pinned real-data fixture tests still pass**, meaning the golden payoff month (Jul 2027) did
NOT move. Worth understanding rather than assuming — either the fixture's phase happens to coincide
or those assertions are insensitive to ±$130/yr. **Check before declaring the live pass clean.**

### ⬜ Commit 2 (decided, unstarted)

**Optional "first occurrence" field in the rule editor**, so anyone who cares can pin their true
phase instead of living with the derived one. Tre already chose "Both: derive now, ask later" — this
is the "ask later" half. Writes `start_date`, which `resolveBiweeklyAnchor` already prefers, so it
needs no engine change.

---

## ✅ `3ec7c725` FULLY LIVE-VERIFIED, BOTH SIDES. Anomaly SOLVED — it was never a bug.

> The read-side debt session 127 handed on is **CLOSED**.
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
2. ~~Biweekly anchor commit 1~~ — ✅ **SHIPPED `12d01772`, session 128. LIVE PASS OWED (see top).**
   **Commit 2** (optional "first occurrence" field) still unstarted.
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
