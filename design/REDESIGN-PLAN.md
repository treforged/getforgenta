# Redesign Build Plan — implementing "The Build Thread"

> Companion to `DIRECTION.md` (the contract). That file says what and why; this
> file says in what order, with what evidence, and records the decisions a build
> session must not re-make. Grounded in a full survey of the current surfaces
> (2026-08-14); file references below were verified against the tree that day.
>
> Every slice: its own branch off main, its own PR, tsc 0 / full vitest green /
> build green, and a 390px signed-in browser pass as evidence. Engines and queue
> logic are wrapped, never edited (DIRECTION.md "What does NOT change").

## Slice map

| # | Slice | Depends on | Size | Attended? |
|---|-------|-----------|------|-----------|
| 1 | Decision Deck (flagship) | — | L | no |
| 2 | Dashboard hero | 1 (deck ships the type scale) | M | no |
| 3 | Debt page | 1 | M | no |
| 4a | Onboarding consolidation | — | M | no |
| 4b | Rules-from-history deck + quiet backlog | 1 + 4a | L | no |
| 5 | Forecast | 1 | S/M | no |
| 6 | Global store→category learning | 4b | M | **yes — migration** |
| 7 | Token sweep (pages outside 1–5) | any | S | no |

2 and 3 are independent of each other; either or both can run in parallel
worktrees once 1 lands. 5 can run any time after 1. 4a can start immediately.

## Slice 1 — Decision Deck (in flight)

Per DIRECTION.md's flagship section; already briefed and building. One review
requirement recorded here because every later slice leans on it: **the deck
card / swipe / progress / undo-run machinery must land as a reusable primitive**
(full-bleed overlay in the spirit of `AppLockScreen.tsx`, not welded to the
review queue), because slice 4b's "we found these patterns" screen IS a deck.
There is no Radix dialog/sheet in `src/components/ui/` to build on;
`ModalShell.tsx` is centered-modal-shaped, not full-bleed — a new primitive is
correct, a third bespoke overlay is not.

Also shipped by this slice, deliberately: the app's first hero-scale number
(`text-5xl font-display` on the card amount). **No in-app precedent exists** —
today nothing above `text-2xl` renders inside the app (the only `text-4xl+` is
Landing + the Builds share card). The deck sets the scale the other slices copy.

## Slice 2 — Dashboard hero

**The finding that shapes this slice: both numbers DIRECTION.md names as the
hero are computed today and neither is rendered.** The floor comes from
`getAugmentedMinSafeCash` (`src/lib/pay-schedule.ts`, wired at
`Dashboard.tsx:634-647`) but only surfaces inside drawers and as a donut slice.
Months-to-debt-free is not on the Dashboard at all — it exists as a payoff
**date** on /debt (`CreditCardEngine.tsx` "Payoff ETA") and as a milestone
string in `forecast-engine.ts`.

- **Hero (decided): the payoff MONTH, e.g. "Debt free Jul 2028", with the count
  ("23 months") as the supporting line.** The two existing sources agree on the
  month, not on a count; a date is what you can say out loud to a friend. Reuse
  the /debt resolution order (`simRevolvingPayoffMonth ??
  forecastRevolvingPayoffMonth ?? per-card sim`) via a small shared selector —
  do not re-derive. If no debt: hero falls back to **cash above floor** with an
  honest empty-state line, never a zero (rule 3).
- **Second read: cash above floor** as a number, one line under the hero.
- Everything else demotes: the 4×4 MetricCard grids (`schedule_cards`,
  `financial_health`, `wealth_overview`) collapse to ONE row of stat chips;
  widgets keep `useDashboardLayout` reorder but render as `card-forged` cards
  behind the hero. The donut (`MonthlyBudgetSnapshot`) stays — it already leads
  with left-to-spend and is the one widget doing rule 2 right.
- Page header demotes: "Command Center" drops below hero prominence. The hero
  number outranking the `<h1>` is the intent, not a bug.
- Cleanups owed by this slice: the ad-hoc amber 2FA banner
  (`Dashboard.tsx:1390-1402`, raw `amber-*` palette classes → tokens), the
  duplicated local `CalcDrawer` (`Dashboard.tsx:146`) extracted to
  `src/components/shared/CalcDrawer.tsx` (Forecast's copy migrates in slice 5).

Evidence: 390px pass showing hero legible without scroll; hero absent (not $0)
on an account-less profile; demo mode pass.

## Slice 3 — Debt page

Today's /debt hero is a title. The number the audience cares about is four
sections down as one of five equal cells.

- **Hero: total interest this month** (`projectedInterestThisMonth` sum —
  exists) **vs. interest at plan.** "At plan" is NOT currently computed —
  scoped as a **pure selector over the existing sim output** (the recommended-
  payments simulation already projects the schedule; the selector reads next
  month's interest off it). It must live beside the other read-only selectors
  in `src/lib/credit-card-engine.ts`'s export tail, with its own tests; the
  engine itself does not change. If the sim hasn't converged or there's no
  plan, the "at plan" half is absent — never a confident zero.
- **Per-card cards get the marginal-rate badge.** `marginalApr()` exists
  (`src/lib/credit-card-engine.ts:292`) and RANKS avalanche today but is never
  rendered; the card header prints flat `card.apr`. Show both when they differ
  ("16.6% · attacking 7.99% tranche") — removing the flat APR would take
  information away.
- **Avalanche order as a numbered build list** on the credit-card tab. The
  Other Debts tab already renders exactly this pattern (`DebtPayoff.tsx:
  450-494`) — copy its shape, don't invent a second one.
- Trajectory chart, strategy controls, per-card accordions and schedule tables
  all stay — behind the hero, as "receipts".

## Slice 4a — Onboarding consolidation (before any onboarding design)

**The survey's most important finding: onboarding is three overlapping
surfaces with two different completion stores.** The `/onboarding` route
(7-step manual form wizard, hard-gated by `localStorage['forged:onboarding_
done_<uid>']` in `App.tsx:96`) never offers Plaid at all; the `OnboardingWizard`
modal (gated by `profiles.onboarding_completed`) has bank-connect for premium;
plus `OnboardingChecklist`. A patterns deck slotted into one is invisible to
users who completed the other. Building 4b on this ground would bake the fork
in.

- **One completion source: `profiles.onboarding_completed`** (cross-device,
  already the modal's store). The localStorage key is migrated on read and kept
  as a write-through cache for the pre-auth-fetch render gap — same idiom as
  `src/lib/trusted-device.ts`'s two-spelling migration. No schema change.
- **One flow: the route wizard absorbs the modal's steps** (including
  `PlaidLinkButton` as the FIRST step for premium — link the bank before asking
  for manual entry, so most of the form pre-fills or skips). The modal wizard
  retires; the checklist stays (it's a nudge, not a flow) but reads the same
  single store.
- Platform note: this is the signup path on BOTH web and native — verify the
  Plaid step on native uses the hosted-link path (shipped 2026-08-06) and the
  wizard renders inside safe-areas at 390px.

## Slice 4b — Rules-from-history deck + quiet backlog

Tre's 2026-08-14 spec, now designed as a deck (DIRECTION.md cleanup item 3):

- **Quiet the backlog for new links:** history synced at link time files no
  suggestion cards; the review queue counts from link day. The backlog stays
  reachable behind "All activity", never a to-do. (Gate in
  `buildReviewQueue`'s caller by link date — a filter at the view layer, not a
  change to queue logic.)
- **"We found these patterns" is one deck run** mounted right after the first
  successful sync in the (now single) wizard: one proposed rule per card,
  accept/skip, pre-checked, skippable as a whole, under a minute. Detection
  reuses what exists — `getRuleOccurrenceDatesInMonth`
  (`src/lib/pay-schedule.ts:1131`), the income-rule fallback
  (`ruleChargeAccountId`, `src/lib/transaction-matching.ts:150`), and the
  drift detector's consecutive-month run logic (`src/lib/rule-drift.ts`,
  `detectAllRuleDrift`) — composed in a new pure `src/lib/rules-from-history.ts`
  with tests against real-shaped fixtures. **A proposed rule is a first draft
  the user corrects, never a claim** (carried from `plaid-category-map.ts`).
  Two qualifying interpretations of one pattern = propose neither (the house
  ambiguity rule).
- Accept writes go through the existing rule-creation path the rule editor
  uses. One-press undo covers the whole run (merchant-memory pass idiom).

## Slice 5 — Forecast

- **Hero: next milestone month.** Milestones are already computed
  (`forecast-engine.ts:1146`, rendered as a plain bullet list at
  `Forecast.tsx:894-905` below ~800 lines of assumptions UI). The next
  positive milestone becomes the hero; the full list becomes a compact strip.
- **The assumptions panel collapses by default** and moves below the hero —
  it is settings, not the story. The monthly table keeps every column but sits
  behind a "receipts" disclosure per DIRECTION.md.
- Migrate Forecast's local `CalcDrawer` to the shared component slice 2
  extracted. Forecast's 20 ad-hoc card sites → `card-forged`.
- Milestone hero honesty: negative milestones (floor breach, cash negative)
  are never suppressed by the hero treatment — if the NEXT milestone is bad
  news, the hero says the bad news.

## Slice 6 — Global store→category learning (attended)

Per Tre's 2026-08-14 spec; sequenced last because it needs a migration (the
one thing an unattended session must not apply) and a privacy note.

- New table: `normalizeMerchant(name) → category` votes aggregated ACROSS
  users — merchant key + category + count ONLY; no user ids, no amounts, no
  dates; aggregate-only by construction. RLS/grants reviewed attended (recall
  the 2026-06-15 anon-enumeration lesson: anon holds blanket table grants).
- Seeds the category dropdown default ahead of `plaid-category-map`; the
  user's own merchant memory always wins over the crowd; a suggestion stays a
  first draft, never a claim. Privacy note required in the UI copy.

## Slice 7 — Token sweep (cleanup, any time)

The survey counted ~164 ad-hoc card sites vs 155 `card-forged` — half the
app's cards are off-pattern, and 73 of them sit in four files, three outside
the redesigned surfaces: `Settings.tsx` (23), `Transactions.tsx` (17),
`BudgetControl.tsx` (13), plus `Forecast.tsx` (20, absorbed by slice 5).
Slices 1–5 clean their own pages; this slice sweeps the rest, converts raw
palette classes (`text-amber-400` etc.) to tokens, and promotes the ~100
inline `style={{ borderRadius: 'var(--radius)' }}` pills to a utility class.
Visual-only diffs, page-by-page commits, browser pass per page.

## Decisions recorded (do not re-litigate)

1. **Dashboard hero is the payoff month (a date), not a month count** — the
   two existing sources agree on the month; the count is the subtitle.
2. **"At plan" interest is a new pure selector, not an engine change** — and
   absent (not zero) when there is no converged plan.
3. **Onboarding consolidates onto `profiles.onboarding_completed`** with
   localStorage migrated on read; the route wizard is the one flow; the modal
   wizard retires; consolidation (4a) lands BEFORE the patterns deck (4b).
4. **Marginal rate is shown beside the flat APR, not instead of it** — never
   take information away to be tidier.
5. **The deck is a shared primitive** — slice 4b consumes it; a second deck
   implementation is a review-blocker.
6. **Flat APR stays visible, milestones stay honest, empty states stay
   honest** — rules 2 and 3 of DIRECTION.md outrank visual minimalism
   wherever they collide.
