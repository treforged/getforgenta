# What his own data says about categories and prompting — measured 2026-09-13

Tre, 2026-09-12, on five transaction-matching defects. Sam's instruction was that items 4
and 5 be decided **"by looking at his actual data, not by taste"**, and that every number
say **which was measured and which was chosen**. This file is the measured half. Nothing
here is implemented yet.

All figures are from the live database, user `a72f416e`, on 2026-09-13.

---

## 1. CATEGORIES — 26 offered, 21 ever used, 11 cover 90%

The card he screenshotted offers **9 chips plus "17 more" = 26 categories**. He has ever
used **21** of them. Cumulative share of his 515 labelled transactions:

| # | category | n | share | cumulative |
|---|---|---|---|---|
| 1 | Personal | 131 | 25.5% | 25.5% |
| 2 | Groceries | 51 | 9.9% | 35.4% |
| 3 | Dining | 49 | 9.5% | 44.9% |
| 4 | Bills | 38 | 7.4% | 52.3% |
| 5 | Car | 37 | 7.2% | 59.5% |
| 6 | Business | 36 | 7.0% | 66.5% |
| 7 | Gas | 33 | 6.4% | 73.0% |
| 8 | Shopping | 29 | 5.6% | 78.6% |
| 9 | Entertainment | 27 | 5.3% | **83.9%** |
| 10 | Travel | 19 | 3.7% | 87.5% |
| 11 | Business Contributions | 15 | 2.9% | **90.5%** |
| 12–21 | Other, Income, Debt Payments, Health, Insurance, Investing, Savings, Pets, Rent, Subscriptions | 49 | 9.5% | 100% |

**THE NINE CHIPS ALREADY SHOWN COVER 83.9%.** That is the fact that reframes item 5: the
chip row is not badly chosen, it is nearly right, and **"17 more" is the problem** — it
advertises 17 further options to buy the last 16% of cases. Two more chips (Travel,
Business Contributions) reach **90.5%**.

**The long tail is genuinely tiny.** Subscriptions has been used **once**. Rent and Pets
**twice each**. Ten categories share 9.5% of everything he has ever labelled.

⚠️ **"Personal" AT 25.5% IS A FINDING, NOT A CATEGORY.** One in four labelled
transactions lands in the vaguest bucket available. That is either a real catch-all he
wants, or evidence that the right category was too hard to find — and this data cannot
tell which. **Do not "fix" it without asking him.** Merging categories while a quarter of
his history sits in a catch-all could easily make the ledger less informative, not more.

## 2. PROMPTING — variance per merchant spans 0% to 111%, so a fixed tolerance is wrong

Item 4 asks that a correct suggestion stop being gated behind a question, and prompt only
on a genuine anomaly. Sam's instruction was to **learn the variance per merchant rather
than assume a fixed tolerance**. The data settles that outright.

Coefficient of variation (sd ÷ mean) for every merchant with ≥ 4 charges:

| merchant | n | mean | **CV** | min | max |
|---|---|---|---|---|---|
| CFX - E-PASS A/R | 12 | $10.00 | **0.0%** | 10.00 | 10.00 |
| BANNER LIFE PREM DEBIT | 8 | $54.07 | **0.0%** | 54.07 | 54.07 |
| APPLE.COM/BILL | 8 | $9.99 | **0.0%** | 9.99 | 9.99 |
| LOCKHEED MARTIN PAYROLL | 34 | $821.12 | 13.0% | 220.90 | 852.54 |
| EXXONMOBIL | 10 | $53.95 | 29.8% | 19.79 | 71.28 |
| CHIPOTLE | 8 | $12.36 | 32.6% | 10.05 | 22.26 |
| ALDI | 8 | $22.29 | 37.0% | 11.58 | 32.24 |
| PAYMENT TO CHASE CARD | 14 | $657.43 | 38.2% | 350.00 | 1000.00 |
| CHEWY INC | 11 | $49.40 | 52.2% | 14.27 | 105.98 |
| PUBLIX | 12 | $14.40 | 56.2% | 5.79 | 33.96 |
| 7-ELEVEN | 19 | $32.48 | 70.9% | 1.92 | 66.81 |
| AMAZON MKTPLACE | 10 | $84.91 | 78.9% | 21.93 | 237.81 |
| DISCOVER E-PAYMENT | 11 | $444.53 | 83.9% | 51.88 | 1000.00 |
| WALMART | 8 | $36.59 | 96.5% | 8.51 | 94.40 |
| ZELLE FROM [partner] | 23 | $437.67 | **98.8%** | 8.00 | 1100.00 |
| COSTCO | 18 | $116.34 | **111.5%** | 2.12 | 368.89 |

**A SINGLE TOLERANCE CANNOT SERVE THIS RANGE.** Anything loose enough for Costco (111%)
would wave through almost anything; anything tight enough for Apple (0%) would question
every grocery shop. `transaction-matching.ts`'s 1% strong band is correct for what it
does and cannot be widened — its header says so and it is right.

⚠️ **THE PAYROLL CASE IS THE ONE TO DESIGN AGAINST.** 34 charges, CV 13%, and the app can
already state it has been linked 25 times. But note `min = $220.90` against a mean of
$821 — there IS an outlier in that history, so "always auto-apply payroll" is not quite
safe either. The rule has to be *this charge is unremarkable for this merchant*, not
*this merchant is predictable*.

⚠️ **AND THE MERCHANT THAT CAUSED THE $15 DEFECT IS THE SECOND-MOST VARIABLE HERE.** The
partner Zelle has CV 98.8% and ranges $8 to $1,100. Any rule keyed on merchant identity
alone will keep getting this one wrong — which is exactly why the 0.05 amount floor
(commit 857f8323) is a separate guard and must stay.

## 3. What this does NOT establish

- **No threshold is proposed here.** These are the inputs to that decision, not the
  decision.
- **Per-merchant CV is not per-merchant *expected* variance.** A merchant whose spend
  genuinely changed over the period shows high CV without being unpredictable.
- **n is small for most merchants** — half the table has 8–12 charges. A CV from 8 points
  is a weak estimate and any rule built on it needs a minimum-sample floor.
- **Electricity is absent** from the table: fewer than 4 rows under a single normalised
  name, even though it is the example he gave. The merchant normalisation used here
  (`strip trailing digit runs`) is crude and may be splitting it.
- **Nothing about how often a threshold WOULD have prompted him** — that needs replaying
  the rule over his history and has not been done.

## 4. The order this work has to happen in

Established while checking the batch panel's own promise, and it is not the obvious order:

1. **A durable applied-action record.** `MerchantMemoryPanel` keeps its undo in
   `useState`, so "undoes in one press" is true only while the panel is on screen.
   Auto-applying against that would remove a prompt *and* silently remove the
   reversibility its copy promises.
2. **Then the confidence rule**, which must auto-apply the payroll card, the variable
   utility and the 28-charge batch, while still refusing $15 against $1,100.
3. **Then the category generalisation**, which needs his answer about "Personal" first.
