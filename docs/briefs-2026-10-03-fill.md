# Two agent briefs for ask 1be673ad (Tre 10-03 ~18:50) - not yet launched

Tre approved delegation in chat on 10-03 ("you can delegate so multiple tasks can be done at once. just make
sure agents dont step on each others toes"). Rules for every builder: own only the files named, NEVER git
commit/stash/reset/checkout/add (the manager commits), no DB writes, before/after measured at 390x844 + desktop
on http://localhost:8080 as the walk account (sign-in pattern scripts/check-update-reminder.mjs), LOOK at frames,
tsc 0 / eslint 0 errors / focused vitest. Scratch scripts in the repo are scripts/_tmp-<area>-*.mjs, deleted after.

## A. Budget tiles fill their boxes (sonnet-executor)
Tre's screenshot: Dashboard "This Month's Budget" at ~1000px desktop, src/components/dashboard/BudgetTotalsCard.tsx.
Seven tiles (Monthly Income, Fixed Expenses, Variable, Debt Payments, Transfers, Monthly Spend, Annual Spend),
each ~125px tall with a small label, one figure, a floating corner icon and a bottom-right chart glyph; uneven
3/2/2 grid; Monthly Spend alone has the sub-line "planned (from rules)". Goal: content fills the tiles or tiles
shrink, even grid with no ragged rows, same height + one figure baseline per row, at 1440/1000/390. Keep every
fact and whatever the chart glyph opens (press it). Cents. Phone stays two across (check:budget-tiles must pass).
Evidence per width: tile heights, content-area/tile-area fill, section height, figure-top spread, before->after.
Own ONLY BudgetTotalsCard.tsx (+ its test).

## B. App-wide box-fill inventory (sonnet-executor)
Build scripts/inventory-fill.mjs + package.json line "inventory:fill" (that one line only), modelled on
scripts/inventory-spacing.mjs (reuse its sign-in, App.tsx route derivation, settle-until-two-reads-agree, controls).
Per route at 390x844 AND 1440x900: every visible box (border/bg distinct from parent, radius>0 or card-forged,
area >= 2000px^2, excluding shell/nav and boxes mostly made of another box); FILL = union of visible content rects
(text via Range, img/svg/canvas, inputs/buttons) / padding-box area; empty height = box h - content vertical extent.
Report fill < 0.35 AND empty height >= 24px, worst first: route, width, label, w x h, fill %, empty px, component
hint. Exit 0 for findings, 2 if a route is UNSTABLE or a control fails. Controls: a planted 300x200 box with one
word must report fill < 0.1; a planted text-filled box must NOT report. Block non-GET Supabase REST writes as
scripts/press-walk does. Run twice, report the top 25 and per-route totals. Touch no src/ file.
Then: dispatch fixes by area from its ranking (disjoint files per agent), same evidence standard.
