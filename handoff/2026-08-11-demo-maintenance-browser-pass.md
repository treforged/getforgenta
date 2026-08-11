# 2026-08-11 — relay s1 — 🟢 Maintenance-log BROWSER PASS done (demo mode) + real DateScrollPicker bug found and FIXED

Session 11 left the `/builds` maintenance UI click-through owed. This session ran it with
**Playwright in DEMO mode** (script at `backups/2026-08-11_demo-maintenance-verify/verify.mjs`,
gitignored, screenshots beside it) — no sign-in, zero real rows touched, so it was safe unattended.

## What the rendered pass proved (19/19 checks)

Entered demo from `/auth` → clicked the app's own "Builds" nav link → Maintenance Log section
renders with: "2 due" badge, Total Spent / Last 12 Mo / Odometer stats, Coming Due strip with
OVERDUE and Due-soon badges, history rows (Valvoline, Discount Tire). "Log Service" modal:
odometer pre-fills from history (91,900), typing "Oil Change" auto-fills 6 mo / 5,000 mi, due
odometer = 96,900, **due date picker displays service date + 6 months**, and "＋ New" transaction
reveals Amount/Payment Method with the files-under-Car caption.

## 🐛 The pass CAUGHT A REAL BUG, fixed on this branch (`1ced5614` + follow-up commit)

First run was 18/19: the form STATE got the +6-month due date (due odometer proved it) but the
**Due Date picker still displayed today**. Root cause in `src/components/shared/DateScrollPicker.tsx`
(shared, 6 callers): it initialised its columns from `value` once and never synced when the parent
changed it programmatically, AND its mount effect emitted `onChange` unconditionally — writing a
due date the user never chose into an untouched optional field (a new entry with no intervals would
have silently gained `next_due_date = today`).

Fix: render-phase prop sync (react.dev "adjusting state when a prop changes" pattern — an effect
trips `react-hooks/set-state-in-effect` and races the emit), and the emit effect only fires when the
composed date differs from the prop. Empty-value mount still backfills today (callers rely on it).
Do NOT move the sync into an effect and do NOT add `value` to the emit effect's deps — the emit
would fire the stale composed date back at the parent before the sync lands.

**Proof:** 5 new tests in `src/components/shared/__tests__/DateScrollPicker.test.tsx` (display,
no-emit-on-mount-with-value, empty-value backfill, prop-change re-sync without echo, user click
still emits; jsdom needs an `Element.prototype.scrollTo` stub). `npx tsc --noEmit` 0, eslint clean,
**full suite 851/851 across 108 files**, and the Playwright pass re-run **19/19** — the picker now
displays "Feb 11 2027" after the preset. Backup: `backups/2026-08-11_120000/`.

Note: session 11 recorded 834/834 (106 files); this tree runs 851/851 (108 files) BEFORE counting
my +5 — a parallel session added tests. All green.

## Still owed (needs Tre's signed-in browser — demo mutations are auth-gated by design)

Save/edit/delete round-trip on `/builds` against real data: log a service, confirm it persists,
"＋ New" files a Car expense visible on the ledger, delete the entry and the transaction survives
(the DB half of delete-safety is already proven in session 11). Everything render-side is now proven.

## Next session

1. The four unfiled fix branches + `feat/build-maintenance-log` PR filing happen at relay end.
2. Finding 4 still blocked on card `20648b6f` (`conductor answers` this session: nothing outstanding).
3. Signed-in live passes listed in earlier sections (N9/N10/N11, maintenance save/delete).
