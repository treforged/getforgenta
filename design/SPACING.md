# Vertical rhythm

> Tre, 2026-08-18: *"format the app so theres more even spacing and less deadspace."*
> This file is the answer, so no session has to re-decide it. The implementation is
> three utilities at the top of `src/index.css`.

## The scale

| Utility | Gap | Use it between |
|---|---|---|
| `stack-section` | 1.5rem / 24px | major regions — the page header block, the hero, the body |
| `stack-block` | 1rem / 16px | sibling cards and widgets inside one region |
| `stack-row` | 0.75rem / 12px | a control/nav/filter row and the thing it controls |

**The rule that decides the ambiguous cases: a control row belongs to the content
below it.** Pills, tabs, filters and toolbars take a `section` gap above and a `row`
gap below, so they read as a label on their content instead of as a region of their
own. In practice that means wrapping the row and its panels in one `stack-row` div —
see `Dashboard.tsx`, `DebtPayoff.tsx`, `Vehicles.tsx`, `Forecast.tsx`, `Accounts.tsx`.

## Why these numbers

Measured in the browser on 2026-08-18, signed in, before any change. Every page root
carried a single uniform `space-y-*`, and it was not the same one:

| Surface | page-level gap |
|---|---|
| Garage | 23px |
| Debt, Goals, Settings, Activity | 27px |
| Dashboard, Budget, Forecast | 36px |

So the same relationship got three different answers depending on which page you were
on — that is the "uneven" half of the ask. The `section` step is **1.5rem because that
is the tight end of what the app already did, not the average**: levelling up would
have added dead space to four surfaces in order to fix three.

The "deadspace" half came from one number doing every job. `space-y-8` put the same
2rem between a hero and the body as between two one-line control rows. Measured on the
Accounts panel: three consecutive rows totalling 109px of content occupied a 253px
band, because each got a full section gap.

## Results of the first pass

| Surface | page height before | after |
|---|---|---|
| Dashboard — Overview | 3531 | 3414 |
| Dashboard — Accounts panel | 2822 | 2732 |
| Forecast | 5958 | 5886 |
| Budget Control | 1750 | 1696 |
| Debt Payoff | 4422 | 4395 |
| Goals, Settings, Activity | unchanged | unchanged |

The account list moved **90px up the fold** (top at 835 → 745 relative to the page
root). Goals, Settings and Activity did not move because they were already at the
tight step and have no root-level control row to bind — their remaining dead space is
nested inside components, which is the next pass, not this one.

## What this is not

Spacing only. **Nothing here removes information** — `rules/common/deciding-for-tre.md`:
move it, demote it, put it behind a link, but the page that had the answer still has
it. No copy, no field and no control was dropped in this pass.

## Still to do

- The inner pass: `Settings`, `Activity` and `Goals` carry their dead space inside
  components rather than at the page root. Measure the same way (walk the children,
  report height and ink) before touching anything.
- The 390px pass per surface. `resize_window` is snap-locked in the Claude Chrome
  profile, so the check is the documented clamp: constrain the overlay to 390px and
  assert zero non-chart elements over 392px.
