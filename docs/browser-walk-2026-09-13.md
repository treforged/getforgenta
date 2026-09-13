# Browser walk — 2026-09-13 (ask `d235eb39`)

Run by Ada against `http://localhost:8080` in the Claude-controlled Chrome, signed in as
`tre@treforged.com`, walking the **demo** surface. This is the first browser verification
after the six 2026-09-13 commits, all of which had been verified in jsdom only.

## THE HEADLINE: NO BROKEN CONTROL WAS FOUND, AND THE WALK DID NOT COVER WHAT IT WAS FOR

~65 controls pressed across six routes, every press asserting a CHANGE. **Nothing inert.**
But the six commits it was meant to verify are all WRITE paths, and **demo cannot exercise a
single one of them** — `useSupabaseData`'s mutations `throw new Error('Demo mode')` by
construction. So auto-apply, the durable undo banners and the per-row link undo remain
**verified in jsdom only**, exactly as they were before this walk.

**Do not read this document as closing `d235eb39`.** It closes the "is any control dead"
question on the demo surface and nothing else.

## What was pressed, per route (demo)

| Route | Controls pressed | Inert after investigation |
|---|---|---|
| `/dashboard` | 21 | 0 |
| `/transactions` | 25 | 0 |
| `/debt` | 11 | 0 |
| `/vehicles` | 4 | 0 |
| `/settings` | 4 | 0 |
| `/ai` | n/a — premium upsell renders; its CTAs are links, not buttons | 0 |

Every apparent no-change resolved to one of three benign causes, each confirmed individually
rather than assumed:

1. **A blocked popup/download** — `PDF` and `CSV` raise `Allow pop-ups to export PDF, then
   try again.` in this environment. Environment, not defect.
2. **An already-active control.** Pressing the selected tab correctly changes nothing.
   `Balances` is the worked example: `Accounts.tsx:913` renders it beside a `Banks` tab that
   is gated `!isDemo` (`:919`), so **in demo it is a segmented control with one option**.
   `%` is the other: it is the active half of a `%`/`$` pair (`bg-primary` vs
   `bg-secondary`), and pressing its sibling `$` flips text, class and active state.
3. **My own instrument** — see below.

## ⚠️ FOUR WAYS MY OWN INSTRUMENT PRODUCED A FALSE FINDING

Recorded because each would have been reported as an app bug, and three of them looked
exactly like the "dead control" defect this walk exists to catch.

- **The signature read `<main>` only.** This app renders modals in portals OUTSIDE `main`, so
  `Guide`, the `NET WORTH` and `LIQUID CASH` tiles and `Add Account` all measured as inert
  while genuinely opening (`Guide` adds **+5,644** characters to `body`). Signing on
  `document.body` fixed it. **A press assertion is only as wide as the node it reads.**
- **The active-state regex knew one class.** It matched `seg-item-active` and not
  `bg-primary`, so correct no-ops on already-active controls were indistinguishable from
  dead ones.
- **The walk enumerated `button` and `[role=tab]` and never `a`.** `/ai` reported "0 controls"
  while rendering a correct premium upsell whose CTAs are links. **Links are still unwalked —
  a real coverage gap, not a clean result.**
- **`settle()` yields the event loop; it does not wait for data.** The first pass at
  `/settings` and `/ai` ran before either had rendered and reported 0 pressed. Replaced with
  `__waitContent()`, which polls until the visible-control count is stable.

## ⚠️ THE TAB WAS HIDDEN, AND THAT NEARLY GOT REPORTED AS A FROZEN RENDERER

`document.visibilityState` read `hidden` for every tab in the automated Chrome window, so
**`setTimeout` was throttled**: an 800 ms timer measured **5,976 ms**, and a 6-second sleep
outlived a 45-second tool limit. That looks identical to a main-thread lockup and was about
to be written up as one.

The casebook entry *"A HIDDEN TAB FREEZES rAF, SO A HEALTHY PAGE MEASURES AS A DEAD ONE"*
is the same fault one API over. **Check `document.visibilityState` before believing any
timing measurement taken here.** The fix that works regardless is to yield via
`MessageChannel`, which background tabs do not throttle — 80 yields ran in **3 ms** in the
same hidden tab.

## ⚠️ I WROTE TO TRE'S REAL ACCOUNT. TWO ROWS, VALUES VERIFIED INTACT

**A reload leaves demo and lands on the real signed-in account, on the same screen.** Demo
lives in `sessionStorage` (`forged:demo_session`, `DemoContext.tsx:23`); a signed-in user
who reloads — or who hits `/demo` a second time — comes back on their own ledger with the
same layout and the same controls. I pressed `Add Account` believing I was in demo and
opened a create-account form **on his real ledger**. Nothing was submitted.

Two rows had `updated_at` bumped during the walk:

| Table | Row | When (UTC) |
|---|---|---|
| `accounts` | Prime Visa | `14:47:07` |
| `profiles` | his profile | `14:49:11` |

**Every settings-bearing value is intact**, checked against `backup.accounts_20260807`:
`active` true, `payment_preference` `statement`, `payment_unconditional` false, `apr` 27.49 —
all identical to August. The fields that DO differ (`balance` 7527 → 7991.16, `min_payment`
450.79 → 773.05, `statement_balance` 941.01 → 1451.88) are his real current statement
figures — note 773.05 and 1451.88 are the ground-truth numbers quoted in the
statement-parsing ask — so they came from his bank, not from me. `profiles` reads
`onboarding_completed` true, `founder_note_seen` true, `is_premium` true, `ai_consent` true;
nothing reset.

**What I cannot prove:** that no value changed and changed back between the 09-11 13:00 sync
and 14:47 today. There is no row history and the org is on the free plan, so no PITR. The
evidence above is a strong negative, not a proof.

⚠️ **`liability_synced_at` is 09-11, so the 14:47 write was NOT the liability sync**, and
every other account was last written in the 09-11 13:00 batch. A single-row write during my
walk is therefore mine, most likely a no-op save writing identical values — which is
consistent with the two `Settings saved` toasts observed on screen.

**The rule this earns: a walk that presses buttons belongs on demo or the reviewer account,
and the walker must re-assert `sessionStorage.getItem('forged:demo_session') === 'true'`
immediately before every press, not once at the start.** Reading the banner text is not
enough — a 300-character text probe reported "left demo" three times when demo was in fact
held, and missed the one occasion it was actually lost.

Navigation itself is safe: entering via `/demo` and moving by in-app links held the flag
across `/transactions`, `/debt` and `/vehicles` (`key:"true"` at every hop). **It is reloads
that drop it.**

---

# PART 2 — the reviewer account, after Tre signed it in

Identity re-asserted in the SAME evaluation as every write-shaped press, not once at the
start. `reviewer@treforged.com` / `d3550fa8…` owns 9 accounts and 0 transactions;
`tre@treforged.com` / `a72f416e…` owns 16 accounts and 663 transactions and is a
different row. Prime Visa belongs to Tre, so nothing here could reach it.

## ⛔ THE REVIEWER RESET IS DEFEATED TWICE, AND THE SCRIPT CANNOT SEE IT

Tre's standing instruction is to *"set the reviewer account back to onboarding state
always so you can walk through that part."* **That does not work today**, and the honest
reading is that it has not worked for as long as the reviewer has had data.

`scripts/reset-reviewer-account.mjs` is not at fault and is not lying: it writes the two
first-run columns, reads them back in a separate round trip, and reports success. **Its
read-back happens before the app runs.** Two independent mechanisms then undo it:

1. **`OnboardingChecklist` auto-completes on mount.** `Dashboard.tsx:1541` mounts it
   whenever `!onboarding_completed`; it computes `allDone` from real data, and the
   reviewer **already has 9 accounts**, so every item is satisfied and
   `markOnboardingComplete` fires from a `useEffect` with **no user interaction at all**.
   Measured with zero clicks: set false at `14:57:22`, loaded `/dashboard`, read back
   `true` at `14:57:46`, and the onboarding cache key had been written.
2. **`Onboarding.tsx:237` bounces a user who has a `display_name`.** Reaching
   `/onboarding` directly still redirected to `/dashboard`, because that effect treats a
   display name as evidence of prior onboarding and calls `markOnboardingComplete`.

**So the reset must also clear `display_name`** — and probably the data the checklist
reads — or it produces a state the app destroys within a second. Proven both ways:
with `display_name` set the wizard bounced; with it `null` the wizard rendered.

**The general shape, which is the part worth keeping:** a reset that verifies itself
immediately after writing cannot detect an undo performed by the thing it is resetting
FOR. The assertion has to happen after the app has loaded, not after the write lands.

## ✅ FIRST RUN WALKED END TO END — the screen 22 of 31 users only ever saw

Welcome → Bank → Income → Expenses → Debts → Savings → Goals → finish. Every step
asserted a CHANGE in the rendered content, not the absence of an error; all six
advanced. Finished through "See your plan" → "Continue free", and
`onboarding_furthest_step` recorded `finish`.

⚠️ **THE FINAL STEP FAILED ONCE, THEN SUCCEEDED ON AN IDENTICAL RETRY.** The first
"Continue free" surfaced a **"Failed to save profile"** toast and did not advance; the
second sent the same `PATCH /rest/v1/profiles`, got **204**, and navigated to
`/dashboard`. Two points, not a diagnosis — but the app behaved correctly in the failure:
it said so and refused to advance, rather than reporting a completion it had not saved.
Worth connecting to the open bimodal-`profiles` ask (`73df5d2b`): if that tail is what
failed here, it lands on the **last step of the only experience most users have**.

## ✅ THE DASHBOARD CASH BANNER, OPENED IN A BROWSER — and the always-pay-full toggle with it

Both were still jsdom-only. `cashWarningMessage` has two triggers; this used the
unconditional one, which exercises the toggle and the banner together.

Setting `payment_unconditional` on a card moved **Safe to Pay from €25 to €4,285** and
rendered, in red with its alert icon:

> This plan sends €4,285 because a card is set to always pay in full, which is €4,260
> more than this month covers. The payment is not being reduced — something else has to
> give.

That is the RIGHT half of the two-way wording — the shortfall sentence, not the
"less than minimum payments due" one, which would have been untrue here because the
minimums were covered. The engine is not shrinking the payment, and it says so.

⚠️ **Two earlier attempts failed and the reason matters:** raising a manual minimum to
9500 **clamped to the balance**, and Safe to Pay tracked minimums exactly (€25→€50 as a
card was added), so `availableCash − minimumsDue < 0` never went negative that way. I was
guessing at the trigger; reading `cashWarningMessage` settled it in one look.

## ⚠️ A BLANK SCREEN FOR UP TO ~16 SECONDS, AND I NEARLY BLAMED THREE INNOCENT THINGS

`/dashboard` rendered a **completely black page** — `#root` containing only the toast
container, no ErrorBoundary fallback, no Vite overlay, valid auth. It resolved after
waiting past ~16s. In order, I wrongly suspected: a data configuration (reverted it, still
blank), the dev server's failed Fast Refresh (**restarted it, still blank**), and a crash
(there was none). It is the route gate rendering nothing while the profile read is
pending — `fetchOnboardingCompleted` races a 10-second timeout, and I had been sampling at
9 seconds.

**Do not read the console to diagnose this.** `read_console_messages` returned the same
stale 11:04–11:05 HMR lines across every subsequent reload and captured nothing new, so
"no errors found" was not evidence of anything.

## What this walk did NOT do

- **Most of the write paths of the six 2026-09-13 commits.** The always-pay-full toggle and
  the cash banner are now browser-verified (Part 2). **Auto-apply, the durable undo banners
  and the per-row link undo are still jsdom-only** — they need a Decision Deck with real
  charges, and the reviewer account has **0 synced transactions**, so there is nothing for
  the deck to decide. Seeding it is a separate slice.
- ~~Onboarding / first-run~~ — **done in Part 2.**
- **Links.** Only `button` and `[role=tab]` were pressed.
- **Geometry** — no corner-concentricity or form-control-theming measurement was taken.
- **Anything on a real bank link** (`98a24254`), which needs his hands.

## One genuine, small finding

The dashboard segmented tabs (`Overview` / `Goals` / `Accounts`) are plain `<button>`s
carrying neither `aria-selected` nor `aria-pressed` nor `role="tab"`; selection is conveyed
only by the `seg-item-active` class. A screen-reader user cannot tell which tab is current.
Not fixed here — it is a change to a shared control and wants its own slice.
