# The full walk — every route, every press, and what each press must PROVE

Written 2026-09-11 (Ada). Run this after every major update, per Tre's standing
requirement: *"after major updates, you need to do a full walk of the site, press every
button. just set the reviewer account back to onboarding state always so you can walk
through that part also."*

## Before the walk, always

```
node scripts/reset-reviewer-account.mjs     # exits 0 only on a VERIFIED first-run state
```

Then sign in as the reviewer **and reload**. The script cannot clear the browser-side
first-run flags (`localStorage forged:onboarding_done_<id>`, the two tour keys, the
sessionStorage founder-note and wizard keys) because they live in the browser.
`AuthContext`'s own reset clears them on sign-in — but against an already-open tab the
route gate will wave the reviewer past `/onboarding` on a cached flag.

## THE RULE THAT MAKES THIS WALK WORTH RUNNING

**A press that raises no error is not a passing test.** Forged-glass shipped a
Conversation tab whose two handlers both set the same view: it threw nothing, so
"press every button" passed it every single time, and the pane was unreachable for
every user on every machine since the tabs were written.

So each press below names **the change it must produce**. If you cannot state what
changed, you have not tested the control — you have only confirmed it does not crash.

**And look at a rendered frame.** A string comparison cannot see an encoding bug, a
cropped panel, or a contrast failure. One crop not containing a line is a fact about
the crop, not about the app — widen the frame before reporting anything missing.

## Static pre-checks — done 2026-09-11, both NEGATIVE

Recorded so the walk does not re-spend time on them, and so a later session does not
treat "unchecked" as "clean".

| Check | Method | Result |
|---|---|---|
| A route no navigation reaches | counted navigators per route, per pattern, never truncated | **Clean.** `/garage`, `/subscriptions`, `/car-fund` have 0 in-app navigators and that is CORRECT — all three are `<Navigate>` legacy redirects that exist for old bookmarks. |
| A tab trigger with no matching content | `TabsTrigger` vs `TabsContent` values | **Clean.** `BudgetControl.tsx` is the only consumer: 6 triggers, 6 contents, exact parity. |
| Two tab handlers setting the same value (the forged-glass shape) | read the three Dashboard handlers | **Clean.** `overview` / `goals` / `accounts` are distinct, and all three have matching render guards. |

⚠️ **What these checks do NOT cover, stated rather than implied:** they see routes and
tab values only. A control that is reachable and still does nothing — a handler wired to
the wrong object, a panel that mounts empty, a button whose write is refused — is
invisible to all three and is exactly what the browser walk is for.

## The walk

Reviewer account, first-run state, in this order.

### 1. First run — the path 22 of 31 users only ever saw
| Press | Must prove |
|---|---|
| Land after sign-in | Route is `/onboarding`, **not** `/dashboard`. If it is the dashboard, the reset did not take or the tab was not reloaded. |
| Each onboarding step's Next | The step index ADVANCES and the rendered heading changes. Not merely that no error appeared. |
| Back | The step index DECREASES and the previous answers are still populated. |
| Finish | `profiles.onboarding_completed` reads **true** in the database, and the route moves to `/dashboard`. |
| Founder note | It appears once; after dismissal a reload does NOT show it again. |

### 2. Dashboard — three tabs, and the widget stack lives under ONE of them
| Press | Must prove |
|---|---|
| Overview / Goals / Accounts | The active pill MOVES and the panel below CHANGES. Assert the panel, not the pill — a pill can highlight over an unchanged body. |
| Any widget in the stack | ⚠️ The customisable stack renders under **Overview only**. A widget "missing" on Accounts is the surface, not the code — this cost three wrong layers of debugging on 2026-09-06. |
| Empty states (friends, leaderboard) | 0 friendships / 0 opt-ins / 0 snapshots is the screen every user currently sees. It must read as an honest empty state, never as a zero. |

### 3. Money pages — assert a NUMBER, never just a render
`/transactions`, `/debt`, `/forecast`, `/budget`, `/goals`, `/vehicles`, `/accounts`

| Press | Must prove |
|---|---|
| Any filter or range control | The row count or a displayed total CHANGES. |
| Debt payoff ordering | The list REORDERS. |
| ⚠️ Any payoff / ETA figure | Cross-check the SAME figure on a second surface. On 2026-09-08 the debt card read `PAYOFF ETA: Paid` while the dashboard read `Not within 5 years` on the same data — a null payoff month rendered as the happy case. **The comforting side was the wrong one.** |
| Lump-sum panels | These record a PLANNED payment. Do not read a plan as a settled transfer. |

### 4. Accounts, settings, premium, legal
| Press | Must prove |
|---|---|
| Bank link entry | ⚠️ `free_bank_link_grants` holds ZERO rows — the free path has never run in production. Do not describe the free first link as working anywhere a customer can read it until one real link writes a row. |
| Every Settings toggle | The persisted value flips AND survives a reload. A toggle that flips in local state only is the classic silent failure. |
| Premium / restore purchases | On web these are native no-ops. Record the condition; do not report it as a broken control. |
| `/privacy`, `/terms`, `/refund`, `/delete-data` | Each renders its own distinct content — all four share one `Legal` component, so four routes rendering the SAME text is a real finding. |

### 5. Conditions to record, not chase
Measured by Ada [5363] on 2026-09-11 (`docs/load-times-measurement-2026-09-11.md`):
the Supabase instance itself intermittently stalls — a 0-row 24 kB indexed table
averages 1404 ms with six 504s in 24h. **If a screen is slow during the walk, record the
condition; it is not necessarily that screen's fault.** Three dead ends are already
ruled out by measurement: it is not the queries, not the pool, and not the bundle.

## Reporting the walk

State the number you can DEFEND. A stated 80% with a named gap beats an undefended 95%.
Say which controls you pressed, what each one changed, and — separately — which screens
you could not reach and why. **A screen that cannot be reached is the finding, and it is
the one a green suite hides best.**
