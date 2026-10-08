# Quick add: Fincend vs Forgenta (ask 661548f5, 2026-10-07)

Tre: *"this is a good example of how easy adding a transaction should be"* (instagram.com/p/DeNGpQVM6oC, Fincend ad, 23.4 s).

## Measured

| | Fincend (from the video) | Forgenta (/demo, 390x844, Playwright) |
| --- | --- | --- |
| Entry point | `+` in the CENTRE of the bottom bar, on every screen | none on Home; Transactions tab, then "Add Transaction" (y=437) |
| Taps to a saved $36 groceries expense | **5**: `+`, Groceries, 3, 6, "Add $36" | **7 + 2 keystrokes**: Transactions, Add Transaction, Amount field, 3, 6, Category, pick Groceries (from 26), Add Transaction |
| Amount entry | in-sheet keypad, amount is the hero ($0 large), no OS keyboard | `input type=number`, no `inputmode`, OS keyboard opens and covers the form |
| Category | one row of chips, one tap | native `<select>`, 26 options, default "Other" |
| Defaults | Expense, Today, Cash, Repeat Never | Expense, Today, Repeat none, Cash (same) |
| Fields shown | amount, category chips, date, note, account, repeat | Date, Repeats, Type, Amount, Category, Payment Source, Note (7) |
| Save label | "Add $36" (says the amount) | "Add Transaction" |
| Who can add | everyone | **web: Premium only**; free users get a link to /premium (Transactions.tsx:1008) |

Also found: at 390 on /demo, `elementFromPoint` at the centre of "Add Transaction" returns a "3 Mortgage" element, so
another element sits over the button and a normal click was intercepted. Unconfirmed as a user-facing defect; check
before building.

## Proposed flow (not built; build waits for the weekly reset, Mon 10-12 18:00)

1. A `+` in the centre of the bottom bar, on every tab (the bar has 5 items; `+` becomes the 3rd).
2. It opens a bottom sheet: Expense | Income toggle, the amount as the hero, an in-sheet keypad (no OS keyboard).
3. One row of the user's most-used categories as chips (top 5 by count, then "More"), under the amount.
4. Date Today, account = the last one used, repeat Never; all shown as one-tap rows, none required.
5. The save button says the amount ("Add $36") and is disabled at $0.
Target: **4 taps** for a 2-digit expense with a top-5 category (`+`, chip, 2 digits, save, minus one when the
category was the last used and is pre-selected).

Open questions for Sam, not Tre: (a) does quick add stay Premium-only on web? Gating the most basic action costs the
habit loop that keeps a free user. (b) which `+` slot: Plan took Garage's slot on 10-06 (c5e29d9e).

Gate when built: a Playwright press count from Home to a saved row, asserted <= 5, red on the current flow (7).
