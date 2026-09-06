# CLAUDE.md

## ROUTING TABLE — start here, do not grep first

Verified against a real directory listing on 2026-09-03. **If a path here is
wrong, fix it in the same commit as whatever moved it** — a routing table with one
bad row is worse than none, because it sends the next session confidently to the
wrong place.

Scale, so you know when a listing is worth reading: 74 migrations, 33 edge
functions, 234 test files under `src/lib/__tests__` alone. Reading a directory is
rarely the cheap move here.

| If the ask is about | Start in |
| --- | --- |
| Forecast numbers, month-0 cash, payoff dates | `src/lib/forecast-engine.ts`, then `src/lib/forecast-convergence.ts` |
| The credit-card simulation the Dashboard reads | `src/hooks/useCardProjection.ts` (+ `src/hooks/cardProjectionResim.ts`) |
| "Why is this month short?", save-up months, reserves | `src/lib/floor-protection.ts` |
| Card interest, statements, cycling, payoff order | `src/lib/credit-card-engine.ts`, `src/lib/debt-payoff-order.ts` |
| Paychecks, pay frequency, bills before payday | `src/lib/pay-schedule.ts` |
| Recurring rules, dates, occurrences | `src/lib/scheduling.ts` — `toLocalDateStr` lives here, USE IT |
| "Already paid?", sync cutoffs, settlement | `src/lib/sync-cutoff.ts`, `src/lib/transaction-matching.ts` |
| The shape the engine consumes | `src/lib/debt-model-types.ts`, `src/hooks/useForecastEngineInputs.ts` |
| Wiring the sim and engine together for a page | `src/contexts/CardProjectionContext.tsx` |
| The money pages themselves | `src/pages/Dashboard.tsx`, `src/pages/Forecast.tsx`, `src/pages/DebtPayoff.tsx` + `src/components/debt/CreditCardEngine.tsx` |
| Bank sync, account matching, duplicate accounts | `supabase/functions/_shared/sync-handler.ts`, `supabase/functions/_shared/account-claim.ts` |
| Providers (Plaid, Akoya) | `supabase/functions/_shared/providers/` |
| Subscriptions, premium, OG cohort | `supabase/functions/stripe-webhook/`, `revenuecat-webhook/`, `_shared/og-*.ts`, `docs/og-cohort.md` |
| Database shape or a new column | `supabase/migrations/` (74 files — grep, never list) |
| What is in flight right now | `handoff.md` — read it before anything else |

### Table 2 — WHAT TO PASTE INTO A FREE LOCAL MODEL

A local model cannot explore. It gets exactly the files you paste, so this table
exists to stop you grepping to work out what to send — which is the cost table 1
was meant to remove, just moved one step later.

| Slice shape | Paste exactly these |
| --- | --- |
| A pure money helper + its tests | `src/lib/cash-floor-warning.ts` and `src/lib/__tests__/cash-floor-warning.test.ts` as the style pair, plus the one file being changed |
| A date bug anywhere | `src/lib/scheduling.ts` (holds `toLocalDateStr`) and `src/lib/sync-cutoff.ts`, plus the offending file |
| A money-page UI change | `src/contexts/CardProjectionContext.tsx` (what the page can see) and `src/lib/debt-model-types.ts` (the shapes), plus the one page file |
| An edge function | `supabase/functions/<name>/index.ts` and only the `supabase/functions/_shared/` files it imports — check its import block first |
| A migration | `supabase/migrations/20260903_og_consent_tokens.sql` as the house style, plus the table's current shape from the DB |
| A failing test | the test file and the single source file under it. Never the engine |

⛔ **Never paste `src/lib/forecast-engine.ts` (≈2,900 lines) or
`src/hooks/useCardProjection.ts` (≈2,300).** Paste the function and its callers.

### What the free tier CANNOT do here — and what is simply UNMEASURED

**Be honest about which is which.** As of 2026-09-03 there are NO scored
free-executor runs for this repo — `~/.claude/ollama/playbook.md` has no
getforgenta entries, because every slice this session was done directly. So this
section states reasoning, not measurement, and says so.

- **UNMEASURED, no data either way:** pure helper + tests, a mechanical date
  sweep, a migration written to a template. These look like reasonable first
  experiments. Score them into the playbook rather than assuming.
- **REASONED, not measured — poor fit:** anything spanning the engine, the sim and
  floor-protection at once. Today's bugs needed all three read together plus a live
  database check, and a model that cannot open a file cannot do that. Delegate the
  helper, not the diagnosis.
- **NEVER delegate:** the decision to write to production data, anything reading a
  secret, and the final read of a money diff. Those are the manager's regardless
  of how good the executor is.

### Gates — run these by name

- `npm run test:tz` — the suite under UTC, America/New_York and Asia/Tokyo. **This
  is the real gate.** A single-timezone run has missed a live money bug before.
- `npx tsc --noEmit` and `npm run lint`.
- `npm run build` — needed when the change touches build config or `browserslist`.
- CI is `.github/workflows/tests.yml`. It asserts a test-count FLOOR, so a
  collapsed suite fails instead of passing quietly.
- ⚠️ **The real-data fixtures are gitignored, so the golden/convergence tests SKIP
  in CI.** A green badge says nothing about the money engine. Run `test:tz`
  locally.
- Live UI verification needs the `dev-signin` skill. A green suite is not a
  pressed button. `/demo` needs NO credentials and is the fastest route in.
- ⚠️ **A JSDOM GREEN ON ANYTHING GEOMETRIC IS NOT EVIDENCE.** jsdom reports
  `scrollHeight` and `clientHeight` as **0** and does **not clamp** `scrollTop`, so a
  test can pass against a feature that is completely inert in a browser. Measured
  2026-09-05 on scroll restoration: eight green tests, three failures to work in
  Chrome, and four real constraints the harness could not observe at all — the wrong
  scroll target, a silent `scrollTop` clamp against a page whose data has not loaded,
  and a programmatic `scrollTop` assignment firing **no scroll event** (0 events for
  an assignment read back as 400).
  **Any test depending on scroll position, element size or layout must MODEL the
  geometry** — define `scrollHeight`/`clientHeight` and a clamping `scrollTop` setter
  on the element — **or be verified in a browser.** This is not a scroll-restoration
  problem; it applies to every size- or layout-dependent test in this repo.
- ⚠️ **GREP FOR THE CALLER, NOT THE DEFINITION** before scoping anything as "not
  built". Four times on 2026-09-05 a feature was found already written, exported and
  documented — and never called: the OG seat test's `is_comp`, the review prompt,
  `setMoneyDisplay`, and `useLumpSumTransfers`. In three of them the surrounding
  comment described the behaviour as if it were happening.
  `grep -rn "theFunction" src/ | grep -v export` is the whole check.
  ⚠️ **AND THE RECORD LIES IN BOTH DIRECTIONS — grep before you BUILD, not only before you
  scope.** On 2026-09-05 two sections of `handoff.md` said "Not built yet" and "NEXT SLICE,
  SCOPED AND READY" about work that was already shipped, called and tested — the null-APR
  ranking (`0d91028b`, down to the `AvalancheOrderList` row mounted at
  `CreditCardEngine.tsx:1608`) and the cash-floor warning (`d97f00d4`, down to the exact
  `saveUpReason` gap that section was written to close). A session trusting the record rebuilds
  a feature on top of itself, and the rebuild passes its own tests. **One `grep -rn` for the
  symbol, before the first edit, is the whole check** — a command rather than a slice. A file
  saying a thing is missing is a claim, and claims here get verified.
  ⚠️ **AND CLOSE IT IN THE RESUME QUEUE, not only in the section above it.** The i18n item went
  stale within the hour of shipping because the top of `handoff.md` was updated and queue item 5
  was not. The queue is what a cold session reads first, so it is the copy that has to be right.
- ⚠️ **A WIDGET THAT WILL NOT RENDER: CHECK WHICH DASHBOARD TAB YOU ARE ON, FIRST.**
  The dashboard's customisable widget stack lives under the **Overview** tab only. On 2026-09-06
  the new Trophy Case looked absent and was chased through three wrong layers in order — the data
  (`achievements` rows), then the merge (`mergeSavedLayout`), then the query (`useAchievements`).
  **All three were correct.** The dashboard was simply on the **Accounts** tab, which does not
  render the stack at all. Registration is provable without a browser
  (`grep -n "<id>" src/lib/dashboard-widgets.ts src/pages/Dashboard.tsx`), so when that grep is
  green the next thing to doubt is the SURFACE, not the code. This is the same rule as grepping
  for the caller — aim the check at the right object — pointed at a UI tab.


## SYSTEM EXECUTION OVERRIDE

Default to `/multi-plan` for any non-trivial task.

Use multi-agent execution only when:
- the task spans multiple files, systems, or concerns
- work can be parallelized safely
- specialist review is likely to improve outcome

For focused work, prefer:
- one plan
- one executing agent
- one reviewer if needed

Never jump straight to implementation on complex work.
If unsure, plan first.

This rule overrides all other heuristics.

You are ALWAYS running with the Everything Claude Code framework.

- Use structured thinking (audit → plan → implement → verify)
- Use multi-agent reasoning where applicable
- Default to production-grade decisions, not quick patches
- Always check for system-wide impact before making changes
- Never solve issues in isolation if they affect other systems

## Purpose

This is a real Git repository connected to GitHub. Treat it as a
production-adjacent project. Make changes carefully, preserve existing
working behavior unless explicitly asked to refactor, and prioritize
safety, clarity, reviewability, secure defaults, and reliable local
backups.

Do not make any changes until you have high confidence in the solution.

If confidence is below threshold:
- first run a focused audit to gather missing information
- ask follow-up questions only if the missing detail cannot be resolved from the codebase

## VERIFY-FIRST RULE (Tre is the LAST resort)

Before asking Tre anything, try to establish it yourself with the tools
available. He is a solo operator; a question you could have answered with
one tool call spends his attention for nothing and stalls an authorized
session.

Reach for, in rough order:
- **Supabase MCP** — SQL for any DB fact (row counts, schema, RLS, grants,
  `cron.job_run_details`), `list_edge_functions` for what is actually
  DEPLOYED and its `verify_jwt`, `get_organization` for the plan tier,
  plus `get_logs` / `get_advisors`.
- **Claude in Chrome** — DOM/live-app verification instead of asking "does
  this render correctly?"
- **Vercel MCP** for deploys/runtime errors; git, `gh`, and the filesystem
  for anything in the repo's own history.

A checklist item inherited from a runbook or handoff that says "confirm
with Tre" means **confirm the fact** — if a tool can establish that fact,
use the tool. It is not a licence to stop.

If a prerequisite genuinely cannot be verified, check whether you can
**create** the missing condition rather than block on it. (2026-08-07: the
§1 runbook required a PITR checkpoint before a table rename; the org plan
turned out to be `free`, where no PITR or automated backup exists at all,
so the session snapshotted the irreplaceable rows into a locked-down
`backup` schema inside the DB and proceeded.) Never write secrets to disk
as part of such a safety net — keep them in the database, in a schema
revoked from `anon`/`authenticated`.

Escalate to Tre only when proceeding under any assumption would be unsafe
AND you cannot construct the safety net yourself. Then ask once,
specifically, and lead with a recommendation — **and do not wait for the
answer**. See the AMBIGUITY RULE below.

## AMBIGUITY RULE — ask, and keep working

**Rewritten 2026-08-09.** It used to end "state the ambiguity, list the
options, and wait for an answer." The instinct was right and the cost was
wrong: a stopped session spends Tre's attention *and* the session, and a
question sitting in a terminal he is not looking at has not been asked.

If an ambiguity is hit — unclear requirements, conflicting instructions,
multiple valid interpretations, or a decision that changes scope or
behaviour — **ask it in the chat reply and carry on**.

The question goes in the closing **"Actions for me"** list; he answers in
chat. Do NOT use `AskUserQuestion`; it halts the session on the keyboard,
which is the thing being removed.

⚠️ **DO NOT WRITE TO THE CONDUCTOR.** Tre, 2026-08-31: *"nothing should be
filling ot conductor anymore for now."* (STANDING; recorded in
`claudecontext/asks-completed.md`.) The old instruction here was
`conductor ask "<question>" --options a,b,c`. A session that still runs it
files into a switched-off board and then carries on believing it asked —
the failure is silent, which is why this says so instead of just dropping
the line. The mechanism is kept collapsed in `AGENT.md` in case the hold
is lifted; the RULE it served — never stop and wait — is unchanged.

Then, in this order:

1. Everything that does not depend on the answer.
2. What does depend on it, under an assumption you **state out loud** and
   mark in the code or the handoff — so the answer either confirms the
   work or redirects one clearly-labelled piece.
3. Something else: the queue, `handoff.md`'s next steps, a known bug.

He replies in chat, so there is nothing to poll and no boundary to collect
at. Fold his answer in when it arrives, and if it contradicts an assumption
you already built on, fix that piece and say so rather than leaving both.

Still true: do not guess silently, and do not implement multiple variants.
Pick the more conservative reading, say which one you picked, and make it
easy to switch.

This rule governs genuine ambiguity — questions of intent, scope, or
preference. It does NOT cover facts that a tool can check; those go
through the VERIFY-FIRST RULE above, and most "ambiguities" turn out to be
those.

Unattended sessions have a harder boundary still: see `AGENT.md`.

## USAGE CAP — RE-VERIFY, NEVER QUOTE THE STALE NUMBER

Tre, 2026-09-02: *"set rules to always check cap reset when i ask. not use the
stale number."*

The usage line arrives on a prompt as a SNAPSHOT. By the time he asks, the
five-hour window may already have reset — that is exactly when he asks. Answering
"you are at 91%, I am paused" from a number that was true an hour ago tells him
his own machine is blocked when it is not, and costs a whole round trip to
correct.

So when the cap is relevant — he asks about it, he says it reset, or a turn is
about to stop because of it — **read the CURRENT figure from the usage line on
THIS prompt** and say the number and its reset time out loud. If this prompt
carries no usage line, say that instead of reaching for the last one seen.
Never carry a cap reading across turns, and never let a stale one be the reason
work stops.

This happened on 2026-09-02: the cap had reset to 24% and the session reported
91% and refused to work.

## CONTEXT GATE (handoff loop)

After every completed step (TDD gate, plan item, commit), check context
usage. A PostToolUse hook (`.claude/hooks/context-gate.mjs`) injects a
`CONTEXT GATE` reminder when context reaches 150k tokens — treat that
reminder as mandatory, not advisory.

When context is between 150k and 200k tokens:
1. Stop starting new work, even mid-phase. Finish only the atomic action
   in flight.
2. Run the `context-handoff` skill: write/refresh `handoff.md` at the
   repo root with goals, current state, active files, changes made,
   failed attempts, and next steps. Commit it locally.
3. **Dispatch your successor BEFORE saying anything to Tre.** A session
   cannot clear itself, so a turn that ends on "run /clear" parks the
   work on his key press — which is exactly what happened on
   2026-09-01 ("Ada got to the clear part but they didnt auto clear and
   continue"). Run `dispatch getforgenta "<the resume brief>" --handoff`
   (`~/.claude/bin/dispatch.py`, on PATH). It opens a fresh tab at this
   desk — same name, empty context — which reads the brief plus
   `handoff.md` and carries on down the resume queue. `--dry-run`
   prints the tab and brief path without opening anything.
   `--handoff` is what arms THIS tab's own exit, and it is opt-in for
   a reason: a bare `dispatch` is also how one desk routes an ask to
   another, and a router that closed itself mid-task would be useless.
   It arms only after the successor's tab has actually launched, so a
   dispatch that fails to open leaves this session alive. Checked in
   dispatch.py directly rather than taken on report.
4. Do not touch the working tree after dispatching; the successor owns
   it.
5. Only then tell the user, and let it be the single action in the
   message: `/exit` this tab — its successor is already running. The
   next agent resumes from `handoff.md` (a SessionStart hook surfaces
   it automatically).

When resuming a session where `handoff.md` exists, read it in full
before doing anything else.

---

## Orchestration layer

Use the following priority order for every task:

1. **ECC multi-agent** — for complex, multi-file, or multi-concern tasks,
   use ECC commands: `/multi-plan` → `/multi-execute`. Let Opus decompose
   the task into a dependency graph before any agent touches files.
2. **ECC single agent** — for focused tasks (one file, one concern),
   delegate to the appropriate ECC specialist agent (e.g. `code-reviewer`,
   `tdd-guide`, `architect`, `security-reviewer`).
3. **Simple edit** — only when the change is clearly a single, low-risk
   line or config tweak with no downstream effects.

Never skip straight to implementation on complex or multi-file tasks.
Always plan first.

---

## SYSTEM CONTEXT (ALWAYS CONSIDER)

This application depends on tightly coupled systems:

- Supabase (auth, RLS, database)
- Stripe (subscriptions, checkout, webhooks)
- Plaid (account connections, transaction syncing)
- Mobile app (Capacitor / native behavior)
- Web app (browser-based behavior)

When making changes:
- Always evaluate impact across ALL relevant systems
- Never assume a change is isolated to one layer
- Validate data flow end-to-end (client → API → DB → external service → back)

---

## ROOT-CAUSE ENFORCEMENT

Before implementing any fix:

1. Identify the symptom
2. Trace upstream and downstream dependencies
3. Identify the true root cause
4. Verify whether other systems share the same issue

Do NOT:
- Patch symptoms
- Add UI fixes for data problems
- Add client logic for server issues

Fix at the correct layer.

---

## PLATFORM SEPARATION RULE

Mobile and Web must be treated as separate environments.

- Do NOT mix mobile-only features into web flows
  (biometrics, native storage, device auth)

- Do NOT assume web behavior applies to mobile
  (routing, auth persistence, viewport)

- Always verify:
  - mobile-specific UX
  - web-specific UX
  - shared logic boundaries

---

## EXECUTION STYLE

- Prefer structured outputs over long explanations
- Use concise, actionable steps
- Minimize unnecessary verbosity
- Optimize for fast iteration cycles with user review

---

## Default workflow

For every request, follow this sequence unless explicitly told otherwise:

1. Identify task complexity — multi-agent or single agent (see above).
2. If multi-agent: run `/multi-plan` first, confirm the plan, then
   `/multi-execute`.
3. Make the requested changes. Keep the diff scoped to the request only.
4. **Before modifying any file**, save a timestamped backup of the
   original to `./backups/` (see Backup policy below).
5. Commit locally after all changes are complete.
6. Do not push to GitHub, open a PR, merge branches, or rewrite history
   unless explicitly asked.
7. After finishing, summarize only:
    - files changed
    - what changed and why
    - backup path
    - commit message
    - manual follow-up steps

---

## Backup policy

Backups exist so any file can be restored to a previous version at any
time. Follow these rules strictly:

- **Back up all files for multi-file or high-risk changes. For trivial edits, backup is optional.** Copy
  the current version to `./backups/`.
- **Folder structure:** `./backups/YYYY-MM-DD_HHMMSS/<original-path>/`
  Preserve the original relative path inside the timestamped folder so
  restoring is unambiguous.
- **Never overwrite a previous backup.** Each backup session gets its
  own timestamped folder.
- **Scope backups to the change.** Only back up files that will actually
  be modified in this session — not the whole repo.
- **Backups are NEVER committed.** `./backups/` is gitignored and must
  stay that way. Durability comes from the Google Drive sync
  (`scripts/backup_drive_sync.py`), not from git.

> **Why this rule reversed on 2026-07-18.** Backups used to be tracked and
> committed. That put ~18 MB of archives in history and, more seriously,
> carried `forecast-inputs.real.PRE-P0.json` — the real financial fixture
> that is gitignored everywhere else — into this **public** repo, where it
> sat from 2026-07-07. A backup of a gitignored file routed straight around
> the ignore rule that was protecting it. Tracking backups is what made that
> possible, so backups no longer go into git at all. Do not re-track them.

### Restoring a file

To restore any file to a previous version:
```
cp ./backups/YYYY-MM-DD_HHMMSS/path/to/file ./path/to/file
```
Then commit the restore as a new commit. Never amend or rewrite history
to undo a change.

---

## Local commit policy

- Always commit locally after every session's changes.
- Use clear, descriptive commit messages:
  `[scope]: what changed and why`
  Example: `[auth]: fix token expiry check in middleware`
- If the commit changes something a **customer** would notice, add a one-line
  `Release-Note:` trailer to the body. It is published verbatim to the Play and
  App Store listings; without one, the generator falls back to a themed sentence
  and never publishes the subject. One line only, and see
  `docs/release-notes-template.md` for how to word it.
- Never push unless explicitly asked.
- Never force push, amend history, or rebase unless explicitly asked.

---

## Agent cost discipline (token efficiency)

- The `lean-fix` workflow applies AUTOMATICALLY to any fix/debug request —
  no manual `/lean-fix` needed. A UserPromptSubmit hook
  (`.claude/hooks/lean-fix-router.mjs`) flags fix-shaped prompts; treat its
  reminder as mandatory routing, and apply the same workflow even without
  the reminder when the task is clearly a code fix.
- For bug fixes and scoped changes, use the `lean-fix` skill: triage size
  first (small fixes stay inline — agents cost more than they save);
  otherwise Explore agent for search, strongest model for diagnosis+plan,
  Sonnet agent for implementation, cheap reviewer for the diff. The strong
  model always owns root-cause diagnosis — never a cheaper one.
- Keep searches and file dumps out of the main thread: multi-file hunts go
  to an Explore subagent whose tool output never lands in main context.
- Use `/multi-plan` before spawning agents — decomposing upfront saves
  redundant agent calls downstream.
- Independent subtasks → parallel agents via `/multi-execute`.
- Sequential or same-file work → single agent or subagent, not a team.
- Avoid spawning agent teams for tasks that don't require inter-agent
  coordination — the overhead is not worth it.
- If context window is approaching 80%, stop, summarize state to a
  handoff note, and continue in a fresh session.

---

## Security rules

- Never expose API keys, tokens, passwords, or `.env` contents in any
  file, commit message, log, or summary.
- Always use placeholders: `YOUR_API_KEY_HERE`
- If a secret is accidentally staged, STOP — do not commit. Alert
  immediately.
- If a security issue is found during any task: STOP → delegate to
  `security-reviewer` agent → fix CRITICAL issues → rotate any exposed
  secrets → scan codebase for similar patterns.

---

## DATA INTEGRITY RULE

This is a financial application.

- Never assume data is up-to-date without verifying sync logic
- Always check:
  - last updated timestamps
  - sync triggers (cron, webhook, manual)
  - source of truth (Plaid vs database)

If data appears stale:
- investigate sync pipeline BEFORE touching UI

---

## Immutability rule

Prefer creating new objects/files when ambiguity exists. Use in-place edits when clearly safe and intended. Return new copies with changes applied.

---

## Final execution order

```
Plan (ECC /multi-plan if complex)
→ Backup originals to ./backups/YYYY-MM-DD_HHMMSS/
→ Make changes
→ Review diff (scope check)
→ Commit locally
→ Summarize
→ STOP (no push)
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `python -m graphify update .` to keep the graph current (AST-only, no API cost).
