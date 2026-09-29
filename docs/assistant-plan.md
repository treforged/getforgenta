# In-app assistant — plan only (ask 7043323c)

Tre, 2026-09-29: *"yes, plan only for now. this can be a feature as we scale."* Nothing here is
built. Written by Ada, 2026-09-29. Prices are from the Claude API reference cached 2026-09-25;
re-check them before any build.

## What it is

A chat panel where a user says what is changing in their life ("I'm moving out in March",
"I'm cancelling a subscription") and the assistant proposes the exact edits to their plan, shows the
forecast before and after, and applies them only when the user taps Approve. It is the loop the owner used by hand in September 2026 (dictate a change, have it applied
through the app, read the forecast back), made self-serve.

## Model and cost

| Model | Input $/1M | Output $/1M | Est. per message* | 20 messages/user/month |
|---|---|---|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1 | $5 | ~$0.03 | ~$0.55 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | ~$0.06 | ~$1.10 |
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | ~$0.11 | ~$2.20 |

\* Assumes ~20k input tokens (instructions, tool definitions, a summary of the user's plan, the
conversation) and ~1.5k output per message, before prompt caching. Caching the fixed part
(instructions + tool definitions) bills repeat reads at about a tenth of the input rate, so real
cost is lower. **This is an estimate, not a measurement.** The first build must log
`response.usage` and replace it with measured figures.

**Recommendation: Sonnet 5.5**, premium-only, with a monthly message cap. At ~$1.10 a month against
the $9.99/mo price it is affordable. Haiku is the fallback if measured cost runs high, but only
after an eval shows it proposes the right edits: a wrong edit to someone's budget costs more than
the tokens saved. The model choice is Tre's call.

**Hosting:** one Supabase edge function (`assistant`) holds the API key server-side and calls the
Claude API. The key never ships in the app. There is no new infrastructure.

## Privacy of financial data

- **Send the minimum.** The model gets names, amounts, dates and the forecast result. It never
  gets account numbers, Plaid tokens, email or institution credentials.
- **The server builds the context, not the client**, from rows the user's own JWT can read (RLS).
  The function runs as the user, never with the service-role key.
- **No training on user data**, and it is said in the privacy policy before launch. Check the API
  data-retention terms at build time and state them in plain words.
- **Conversations are not stored by default.** A user can opt in to history. The only thing kept
  is the audit row for each applied change (below).
- **Opt-in per user**, with a clear "this sends your plan to Anthropic" consent screen the first
  time.

## Tools the model gets

Read tools (no approval needed):
- `get_plan_summary` — accounts, rules, goals, debts, in the minimised shape above.
- `run_forecast(changes)` — runs the real engine (`runDebtCashConvergence`) on the user's inputs
  with the proposed changes applied **in memory**, and returns month-end cash vs floor, shortfall
  months and payoff date. It writes nothing. `rankBreachLevers` (shipped 2026-09-29) already does
  exactly this for one lever at a time, so this tool generalises existing, tested code.

Write tools (always through approval, never direct):
- `propose_changes(list)` — each item is one typed edit: add/end/change a recurring rule, add a
  one-time transaction, change a goal contribution. Strict JSON schema, validated server-side.

No tool can delete an account, touch credentials, move real money, or change a subscription.

## Approval, preview and undo

1. The model calls `propose_changes`. Nothing is written.
2. The app shows a **diff card**: each edit in plain words ("End Rent on 31 Mar 2027"), plus the
   forecast before and after from `run_forecast`. The user taps Approve, Edit or Discard. They can
   uncheck single items.
3. On Approve, the edge function **snapshots the affected rows** into a `change_batches` table,
   applies the edits in one transaction, and **reads the rows back**. A mismatch rolls the whole
   batch back and says so.
4. **Undo** restores that snapshot in one tap, from the card or from a "Recent changes" list, for
   30 days.

## First small version (v0)

- Premium only, behind a feature flag, the owner's account first.
- Read tools + `run_forecast` only: **the assistant answers "what if" questions and makes no
  edits.** Example: "what if I drop this subscription from November" gets the same re-run answer a
  person would get by running the scenario by hand.
- Gate before any user sees it: an eval of ~30 real "what if" questions whose engine answers are
  known. The assistant's numbers must match the engine exactly, because it reports them from the
  tool and must not invent them.
- v1 adds `propose_changes` with the approval flow above. v2 adds history opt-in and voice.

## Open questions for Tre

1. Model: Sonnet 5.5 (recommended) or Haiku 4.5.
2. Premium-only (recommended) or a small free allowance.
3. Monthly message cap per user (suggest 50).
