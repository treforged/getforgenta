# What Plaid actually costs, now that the first link is free

Written 2026-09-06, the same night the paywall moved to the second bank (`0eaedbef`). Tre asked
for it minutes after approving that change, which is the right instinct: **a paywall change that
raises Plaid spend with no line item for that spend is the shape that surprises somebody later.**

## The record — it is in his ledger now

A `Plaid` rule was added to his own Forgenta account beside `Claude` ($100/mo) and
`Google Workspace` ($7/mo), carried exactly the same way: `rule_type` expense, monthly,
`category` Subscriptions, paid from **General Operations**. It now flows into the forecast and
Total Cash Out like every other subscription.

⚠️ **THE AMOUNT IS A PLACEHOLDER AND THE ROW SAYS SO.** `$11.90` is not a quote and not an
estimate — it is **the single real Plaid charge in his bank data** (`Plaid Technologies Inc Pl`,
2026-07-12). It was used because a plausible invented number in a money app is worse than a
sourced one. The Plaid dashboard was not reachable from this desk. **Tre should overwrite it with
the real figure.**

Reversing it is one delete: rule id `0171408d-b4d9-4652-b3f0-5a02bd544272`.

## The mechanism — this cost is now VARIABLE, and that is the whole point

**Plaid bills per linked Item.** Before 2026-09-06 an Item could only exist behind the paywall,
so spend grew with PAYING customers. It now grows with **signups**, because every new account can
create one for free. That is the cost of the decision, and it is worth having a number attached
rather than a hope.

### What one link costs, measured rather than quoted

| Measured | Value |
| --- | --- |
| Live Plaid items in July 2026 | **6** (3 created April, 3 created May) |
| The July charge | **$11.90** |
| **Observed cost per item per month** | **≈ $1.98** |

⚠️ **ONE data point, one month.** Plaid's published pricing mixes a per-Item component with
per-call components, so this is an *effective blended rate at our current call volume*, not a
price list. It will move as sync frequency and product mix change. Treat it as an order of
magnitude, not a rate card.

### What 100 signups would cost, at that observed rate

Each free account can create **one** item, so 100 signups that all link a bank is 100 items.

| Signups who link | Items | Monthly, at ≈$1.98/item | Annual |
| --- | --- | --- | --- |
| 10 | 10 | ~$20 | ~$238 |
| 50 | 50 | ~$99 | ~$1,188 |
| **100** | **100** | **~$198** | **~$2,376** |

**Against zero income.** Apple revenue is confirmed zero — App Store Connect has no Payments and
Financial Reports data at all (Apple only generates those when there are proceeds) and Trends
shows zero in-app purchases for Aug 5 – Sep 4. Lifetime revenue is the **$4.99 on Tre's own card**.
So **Plaid is the app's largest real running cost, and it now scales with a number that earns
nothing.**

### The three things that bound it, and they are already built

1. **One free item per ACCOUNT, durably.** `free_bank_link_grants` records the spend once, and
   unlinking does NOT return it. Without that, a count of live connections would have been a retry
   loop — link, unlink, link — billing an item every time.
2. **The grant is consumed at token EXCHANGE, after the row persists.** An abandoned Link flow
   creates no Item and therefore costs nothing, so it must not spend anybody's free link.
3. **A failed entitlement lookup REFUSES.** A gate that opens when its own read errors is not a
   gate, and what is behind this one is billable.

### The honest risk

**The 100-signup row is the one to watch, and today it is hypothetical in a specific direction:
there have been no signups since 2026-08-07.** The cost cannot run away while nobody is arriving.
If distribution starts working, this line moves before revenue does — that is the trade Tre
accepted knowingly, and the reason to keep the number visible rather than to argue with it.

**The cheapest lever if it does run away** is not re-gating the first link — that would undo the
whole point — but reducing per-item call volume: sync frequency, and which Plaid products each
Item is enrolled in.
