# Rent split: a partner's half of rent for one semester (plan, 2026-10-09)

**This is a handoff for local Ada.** She will enter it through the app in Claude in Chrome after Mon 10-12 18:00 ET.

Ground rules:

- **Nothing here has been written to Tre's account.** The cloud session only read it.
- **No figures from the account appear in this file.** The repo is public. Every amount, date and account named below is read on screen from Tre's own account on the day. The values seen on 10-09 went to Sam privately.
- **Desktop width.** Claude in Chrome cannot set a phone viewport here (see CLAUDE.md).

## What Tre asked for

He wants it to actually affect the forecast, not sit as a what-if. His future rent is already projected in his account. The only piece missing is his partner paying **half of the rent for her first semester, July to December**, funded by her school loan.

Later, after his car is paid off, he may help repay that portion. That part is optional and is covered at the end.

**One new entry:** an income rule for her half of the rent, July–December of the year the new rent starts.

## Read these first (all on `/budget`, the Plan tab, unless noted)

| Piece | What to find | Use |
| --- | --- | --- |
| New rent | the expense rule named "Rent (new place, …)" | its **amount** (call it RENT_NEW) and its **start date** (LEASE_START) |
| Partner's current contribution | the income rule "GF Half of Rent/Groceries" | duplicate it (step 2); do **not** edit it |
| Payoff order | `/debt` | leave as is; the default is his current order |
| Car | `/debt`, Auto Loans | its auto-extra stays on; read its payoff month for the optional item |

**Check the year.** On 10-09, LEASE_START was in July of next year (2027), which matches "July to December". If on Monday it is any month other than July, **stop and ask Tre**. Do not move either date to make them fit.

## Freed cash already reaches debt; no entry needed

The forecast sends cash above the cash floor to debt automatically (`src/lib/forecast-engine.ts`, PASS 2: "all surplus → debt"), and the car's auto-extra takes surplus too. So extra income in those six months flows into his existing payoff order without any further entry.

Do not change payoff order, surplus shares or auto-extra.

## The entry, click by click

1. Open `/budget` (Plan).
2. On the income rule **"GF Half of Rent/Groceries"**, press **Duplicate** (aria-label `Duplicate GF Half of Rent/Groceries`). The form opens as **Add Rule**, with the type, frequency, category, Deposit Into account and dates copied.
3. Set the fields:

   | Field | Value |
   | --- | --- |
   | Name | `GF half of rent (first semester)` |
   | Amount | **RENT_NEW / 2** (rent only; Tre said "half of rent") |
   | Type / Frequency / Category | as copied (Income / Monthly) |
   | Due Day of Month | **1**, the day the rent is due (the copied day is the old rule's) |
   | Start date | **LEASE_START** |
   | End Date | **the last day of December** of LEASE_START's year, which gives six payments, Jul 1 to Dec 1 |
   | Deposit Into | as copied (the checking account the rent is paid from) |
   | Notes | `First semester (Jul–Dec), funded by her school loan. Tre may repay that portion after the car.` |

4. Press **Add Rule**.
5. Read the row back. It should show the new amount, "Starts LEASE_START · Ends <Dec 31 of that year>", and the original "GF Half of Rent/Groceries" rule unchanged.

## Verify: read before and after, and compare

Record each of these **before** step 1 and again **after**.

1. **`/forecast` → Monthly breakdown.** Income for Jul–Dec of that year should go up by exactly RENT_NEW / 2 per month. No other month should change. Where cash sits at the floor, it should stay there: the extra goes to debt, not cash.
2. **`/debt`.** Each card's payoff month and the debt-free date should be the **same or earlier, never later**. The app's dates are the authority, so record them exactly.
3. **`/dashboard`.** Safe to Spend this month is unchanged, because the new rule is entirely in the future.
4. **Nothing else moved.** The original contribution rule's end date, both new-place rules' start dates, and the car's auto-extra.

If any date moves later, or income changes outside Jul–Dec, **delete the new rule** (row → Delete → Confirm) and report back. Do not fix it in place.

## Optional, not entered unless Tre says so: repay her rent portion after the car

- **Size:** 6 × (RENT_NEW / 2), her total contribution. Interest on her loan is a separate question for Tre.
- **When:** the month after the car's projected payoff. Read this on `/debt` **after** the entry above, because the entry moves that date.
- **How:** an expense rule on `/budget` → **Add Fixed**.
  - Name: `Repay GF rent loan portion`
  - Amount: total / N
  - Frequency: Monthly
  - Charged To: his checking
  - Start: the month after the car payoff
  - End: N months later
  - N is Tre's pick.
- **Gap the app cannot express:** a rule cannot start "when the car is paid off". It takes a fixed date, so if the payoff date moves, this rule keeps its old start until someone edits it.
  - **Smallest product change:** a rule option "start after <debt> is paid off", resolved by the engine each run (`scheduling.ts` plus the forecast).
  - **Not proposed now:** a fixed date that is re-checked is honest enough.

## Questions for Tre

**None for the entry.** The year matches his projected rent start.

Only if he wants the optional repayment entered:

1. Over how many months?
2. Is he also covering her loan's interest?
