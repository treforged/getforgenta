# The screens, measured against the apps people already use

Written 2026-09-06, at Tre's request: *"can we have ada continue working on other parts of the
app, especially the redesign."* It extends `docs/navigation-jakobs-law.md` from the CHROME to the
SCREENS — Dashboard, Transactions, Debt Payoff, Forecast, Garage.

**This is a plan. Items marked SHIPPED carry their evidence; everything else is unbuilt.**

## The purpose is retention, and retention is MEASURED here

- **9 of 31 accounts ever returned after day one.**
- **0 of the 4 who signed up in July and August returned at all.**
- 2 accounts active in seven days; 23 dormant beyond thirty days; no signup since 2026-08-07
  (`docs/push-runbook.md`, measured 2026-09-05).

⚠️ **Read that honestly before ranking anything.** A person who opens a finance app once and never
returns did not misread a label. They found no reason to come back. So **no screen change in this
document can be claimed to fix day-1 retention on its own** — the trigger that brings a dormant
person back has to reach them OUTSIDE the app, and today it cannot: every notification Forgenta
ships is a LOCAL one, scheduled on the device by the app, so it only fires for somebody who has
already opened it (`push-runbook.md`). The server-side sender is not built.

What the screens DO control is the other half: **whether the session a person does start is worth
having.** That is a real and separate thing, and it is what each item below is scored against.
Each item says plainly whether it is retention or tidiness. **Tidiness is allowed to be on the
list; it is not allowed to be described as retention.**

## The two constraints, unchanged from the nav plan

1. **Do not take information away to make something tidier.** Move it, demote it, put it one tap
   in — but the page that had the answer must still have it.
2. **Every item names its acceptance evidence.** A rendered frame at a stated viewport, a measured
   pixel count, or a count. **"Looks better" is not evidence, and neither is a green build.**

## Three harness facts that cost the last session hours

- **The browser harness will not resize below 1500px.** Measure phone widths in a real **390px
  same-origin IFRAME**. A `lg:hidden` element measured wide reports **0×0** and passes as invisible.
- **The dashboard widget stack renders only under the OVERVIEW tab.** A widget that will not appear
  is a question about which tab is open before it is a question about the code.
- **jsdom reports zero geometry.** A jsdom green on anything geometric is not evidence.

---

## Where we are, per screen

Measured against the source on 2026-09-06, not remembered.

| Screen | Forgenta **today** | What the app they already know does | Cost of differing |
|---|---|---|---|
| **Dashboard** (`/dashboard`, Home) | `COMMAND CENTER` + month as a section label; a hero (card payoff date / cash above floor); then `DashboardOverviewStrip` — **8 aggregate numbers** (net worth, assets, liabilities, liquid cash, investments, retirement, CC debt, CC limit) fixed above a 3-pill panel bar (Overview / Goals / Accounts); **11 customisable widgets, under Overview only** | A bank home answers three questions in order: **what have I got, what just happened, what is due next** | **Medium-high, every session.** We answer #1 eight times over before answering #2 or #3 at all. Recent activity is a widget in a reorderable stack; "what is due next" is `upcoming_week`, also a widget, also removable |
| **Transactions** (`/transactions`) | Two panels — `Plan` then `Transactions`. Filters are four controls: month select, all/income/expense, category select, source select. Rows render **unpaginated** (`filtered.map`) | **A search box, first.** Every bank app, Mint, YNAB, Copilot and Monarch put free-text search at the top of the ledger | **HIGH, and this one is not a judgement call.** ⚠️ **There are ZERO text-search inputs in the entire app** — measured `grep -rn 'type="search"' src/` = **0**, and no `searchTerm` / `filterText` state anywhere. "Did that charge go through?" and "what do I spend at X?" are the two most common reasons a person opens a money app in month two, and Forgenta cannot answer either |
| **Debt Payoff** (`/debt`) | Section-label `h1`; 5 panels (cards / auto / mortgage / student / other); `Add Account` links **away** to `/accounts?new=1&type=…` | A payoff planner shows the plan and lets you edit it in place | **Low-medium, and mostly right.** The engine is the product's differentiator and it is already the strongest screen. The bounce to `/accounts` to add the thing the page is about is the one real seam |
| **Forecast** (`/forecast`) | `Forecast` + "60-month projections driven by live data"; on phones the five controls collapse behind a `Controls` disclosure that names its own count | Nothing people already know — a 60-month personal projection has no mass-market equivalent | **Low.** This is where Jakob's Law stops applying. Matching something here would be cargo-culting |
| **Garage** (`/vehicles`) | `Garage`; two panels, Builds then Vehicles | Nothing. It is a car-enthusiast surface inside a budget app | **None, by construction.** It is the differentiator, not the convention |

---

## Ranked by encounters per session

A wrong home for a setting costs once a month; a wrong primary screen costs every session.

### 1. ✅ SHIPPED (in part) — Transactions had no search at all
**RETENTION, not tidiness.** This is the clearest item in the document and the cheapest to prove:
the convention is universal, and we have zero of it.

- **Do:** a text input at the top of the Transactions panel, filtering the rendered rows on
  description, merchant, category and note. It composes with the four existing filters rather than
  replacing them — **constraint 1: nothing is removed.**
- **Acceptance:** a 390px frame showing the input; typing a substring reduces a known row count to
  a known smaller one (a **count**, not an impression); the four existing filters still present and
  still working alongside it; page horizontal scroll **0**.
**MEASURED IN A REAL 390px SAME-ORIGIN IFRAME on `/demo`, not in jsdom.** `src/lib/transaction-search.ts`
plus 12 tests, wired into `Transactions.tsx`. The input is **349×41px at left=14**, page horizontal
scroll **0**, and the four selects are all still there:

| Typed | Ledger rows |
| --- | --- |
| (nothing) | **31** |
| `gas` | **5** |
| `GAS` | **5** — case-insensitive |
| `northvale` | **18** — the ACCOUNT name, resolved as the row displays it |
| `gas northvale` | **5** — the terms AND, they do not widen |
| `gas zzzz` | **0** |
| cleared | **31** restored |

The three load-bearing tests are **mutation-verified**: making an empty query return false, removing
the internal normalization, and turning the AND into an OR each turn the suite red. ⚠️ The first
attempt at that mutation check PASSED while changing nothing, because the string `every` occurs in a
comment above the code and was replaced there instead — a green mutation run is not evidence until
you have confirmed the mutation landed on the CODE.

⚠️ **TWO LIMITS, AND NEITHER IS FIXED. Do not describe this as "search on Transactions".**
1. **It covers the LEDGER half only.** `BankActivity` is a separate component that takes no props
   and runs its own queries, so the bank rows — which is where the recognisable merchant names live,
   and therefore where "did that charge go through?" actually gets answered — are **not searched**.
   Found by the acceptance test itself: typing `Ridgeline`, a merchant plainly visible on screen,
   matched **0** rows. Threading search into that half is its own slice.
2. **The ledger still renders unpaginated** (`filtered.map`, no page size). Search reduces the wall
   for someone who knows what they are looking for; it does not remove it for someone scrolling.

### 2. The Dashboard answers "what have I got" before "what just happened" — *every session, first screen*
**RETENTION, partly.** The first screen is the whole of a short session for most people.

- **Do:** nothing yet — this needs a decision, not a diff, and it is where a redesign does the most
  damage if it guesses. The 8-number strip is FIXED (not a widget), so a person cannot demote it;
  recent activity and next-due ARE widgets, so a person can remove them. That ordering is backwards
  against the convention. **The reversible half — making the strip collapsible while it stays on
  the page — respects constraint 1; deleting numbers from it does not.**
- **Acceptance when it is built:** 390px frames before and after; the count of numbers reachable on
  the screen must not go DOWN; and the first two things above the fold named explicitly.
- **Honest note:** this is the highest-value item and the one most likely to be wrong on a guess.
  It stays a plan until item 1 has shipped.

### 3. The bottom bar's shape — nav plan item 2, reconsidered on merit
**TIDINESS.** Reconsidered rather than inherited as deferred, per Tre's ask.
- Five destinations and their labels are already right; only the full-width-bar-versus-floating-pill
  shape differs. It changes nothing a person can do.
- **Verdict: still below items 1 and 2, and honestly so.** It is the most visible item and the least
  broken one.

### 4. The top bar centre says the APP, not the PLACE — nav plan item 4, reconsidered on merit
**TIDINESS, and possibly correctly nothing.** The bottom bar already answers "where am I" with a
highlighted destination and a label. Adding a contextual title duplicates an answer the chrome
already gives, on every screen, forever. **Doing nothing remains a legitimate outcome**, and this
document records that as the current recommendation rather than leaving the item open.

### 5. Debt Payoff bounces to `/accounts` to add a debt — *occasional*
**TIDINESS with a small retention edge** — it is in the first-run path (`Add a debt` is one of the
four onboarding checklist items), so a new account meets it on day one. Below item 1 because it is
met once or twice, not every session.

### 6. Forecast and Garage — *deliberately not redesigned*
Neither has a convention to match. Forecast's mobile `Controls` disclosure already names its own
count, so an empty-looking toolbar is never a mystery — that is the correct pattern already.
Changing either to look like something else would be copying an app rather than a convention.

---

## What this document does NOT claim

It does not claim to fix the 9-of-31. **The return trigger is a server-side notification that does
not exist yet**, and the fork blocking it is written down in `docs/push-runbook.md`: the
money-shaped signals come from a forecast engine that is client-side TypeScript and has never run
on a server. Only `learn_lesson` and `streak_risk` are server-computable today. **That, not a
screen, is the item that would move the measured number** — it belongs in the queue above
everything here, and it is named so that nobody reads this plan as a retention answer on its own.
