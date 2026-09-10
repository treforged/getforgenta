# Friends + Leaderboard — the privacy surface, in plain words

**For Tre, before Phases 2 and 3 get built.** Written 2026-09-10 by reading the shipped
migration and the live database, not the plan document — a plan is a claim, and this is the
one place where a claim being slightly off is expensive.

---

## First, what is already live — because half of this is built

| | State, verified today |
|---|---|
| **Phase 0** — schema, RLS, helper functions | ✅ **Shipped** `20260826_friend_links.sql` |
| **Phase 1** — invites, accept/revoke, Settings card | ✅ **Shipped and reachable.** `<FriendLink />` at `Settings.tsx:681`, no premium gate; the `friend-link` function answers `401` unauthenticated where a nonexistent function answers `404`, so it is deployed. |
| **Phase 2** — metric computation + opt-in toggles | ❌ Not built |
| **Phase 3** — the leaderboard itself | ❌ Not built |

### ⚠️ And nobody has ever used it

```
friend_links          0        leaderboard_shares      0
friendships active    0        leaderboard_snapshots   0
partner_links active  0
```

**Zero invites in the two weeks Phase 1 has been live**, on an app with 31 users and 2 active
in the last 7 days. That is not a bug — the card is reachable and ungated, and I checked that
before reading anything into the number, because "nobody wants it" and "nobody can find it"
look identical from a count.

**It is a fact about what Phase 3 will show:** a leaderboard built today renders its empty
state for every user who opens it. That is a reason to make the empty state good, and it is
context for whether this is the next thing to build. **Your call, not mine** — see the forks
at the bottom.

---

## What a friend can actually see

**Four numbers, and nothing else.** Not a balance, not a goal target, not a transaction, not
a category, not an account name.

| Metric | What it is | Shape |
|---|---|---|
| `goal_progress` | how far along your best savings goal is | **5% buckets** — 0, 5, 10 … 100 |
| `debt_payoff` | % of your peak revolving balance paid down | **5% buckets** |
| `budget_adherence` | share of your budget categories at or under budget | **5% buckets** |
| `savings_streak` | consecutive weeks your net worth did not fall | whole weeks, capped |

**No dollar amount is ever stored.** The bucket is computed **on your own device from data
already in your browser**, and only the bucket is written to the database. So there is no
server-side path from a balance to something a friend can read — even a future bug in a policy
could only widen access to numbers that were already coarse.

**Verified in the migration, not taken from the plan:** no policy on `accounts`,
`transactions`, `debts`, `savings_goals`, `budget_items` or `profiles` mentions friends at
all. Friend visibility ends at one table of small integers you wrote about yourself.

## What is opt-in

**Everything, and the default is off in two independent ways:**

1. **Nobody is your friend until you both agree.** An invite is a code emailed once, stored
   only as a SHA-256 hash with no client-readable grant. You send it; they accept it with the
   exact code from their own mailbox.
2. **Being a friend shows them nothing.** There is a second, separate switch **per metric**.
   No row means share nothing, so a friend of yours who has not opted in appears as a private
   row rather than a zero.

**Either side can revoke instantly, and revocation works even if the server functions are
down** — that is a deliberate one-way database rule, not a button that calls an API.

## What could be inferred anyway — the honest part

**A friend who already knows your savings goal target can turn `goal_progress` into dollars.**
If they know you are saving for a $10,000 truck and your bucket moves from 40% to 45%, they
know you put in roughly $500 that week. Repeated weekly, that estimates your contribution
size and timing, which gestures at your income.

Three things blunt it, and none removes it:
- **5% buckets** — a $1 change moves the number by zero or one step, never precisely.
- **One write per week, enforced by a database key.** They cannot watch money land in real
  time and correlate it with a payday.
- **No targets or absolute values exist anywhere in the schema**, so the inference needs
  outside knowledge you gave them yourself.

**Residual risk: one coarse delta per week, to someone you invited and could un-invite.** The
plan accepted that on 2026-08-26 and I agree with it — but you should know it is the thing
that is genuinely shared, rather than believing nothing is.

**The other honest caveat: the numbers are self-reported.** Because they are computed on the
user's own device, a determined person could publish a flattering bucket. That is accepted —
it is a social feature, not a financial rail, and the database clamps the range.

---

## The forks that are genuinely yours

Everything else in this design was decided on 2026-08-26 and each is reversible in one file —
free tier with a cap of 5 friends, friends-only with no public boards, 5% buckets, weekly
cadence. I am not reopening those.

**These two are yours, one line each settles them:**

1. **Build Phase 3 now, or wait for people to have friends?** With 0 friendships and 2 weekly
   actives, the leaderboard ships to an empty room. Building it anyway is defensible — it is
   the thing that makes inviting a friend worth doing, so the empty room may be the reason
   nobody has invited anyone. **My recommendation: build it**, because the alternative is
   waiting for demand that the missing half is suppressing. Say stop if you disagree.

2. **Should a friend see your name, or a masked email?** Today the design falls back to the
   local part of an email address when someone has no display name — so `tre@…` shows as
   `tre`. That is a real name leak to someone who only ever typed an email address.
   **My recommendation: show "A friend" rather than a masked email when there is no display
   name**, and prompt for a display name when someone first accepts an invite.

---

## What I did not do

- **No schema change, no new policy, no migration.** Phases 0 and 1 are shipped and correct;
  nothing here re-opens them.
- **Nothing outward-facing.** No invite was sent, and the one live account is yours.
