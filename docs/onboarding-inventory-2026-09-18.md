# What the onboarding flow asserts that is no longer true

Measured 2026-09-18 by Ada, from source. **This is step 1 of `ea25a708` (Tre: "we need to
update onboarding first. especially with all the changes we made") and it is a PREMISE TEST,
not a scope proposal.** The inventory below IS the scope; nothing here was scoped from memory.

**Why it matters, in one number:** 23 of 29 real users have not opened the app in a month.
For that majority, onboarding IS the product — so a flow that teaches a layout the app no
longer has spends a returning user's only attention on a screen they cannot find.

## THE FLOW, as it actually runs

`src/pages/Onboarding.tsx` builds 8 steps, and the second one differs by tier
(`buildSteps`, line ~96):

    welcome -> [bank | premium] -> income -> expenses -> debts -> savings -> goals -> finish

Premium gets `bank` (Plaid); free gets `premium` (the upsell). Plus a ninth surface, the
dashboard nudge `src/components/dashboard/OnboardingChecklist.tsx`, which is not part of the
wizard and is reached by anyone who skipped it.

## FALSE — three, each verified

**STATUS: 1 and 2 are FIXED (this commit's sibling, gate
`src/pages/__tests__/Onboarding.pointers.test.ts`). 3 is Tre's and is deliberately untouched.**

### 1. "Settings -> Quick Access" does not exist, and the hint is shown to people who cannot use it
`src/pages/Onboarding.tsx:772`, the finish step:

> **Add a PIN or biometric lock** for quick, secure access. Find it in **Settings -> Quick Access** anytime.

**Two defects in one sentence.**

* **The name is wrong.** `grep -rn "Quick Access" src/` returns **2 hits, both inside
  Onboarding.tsx itself** — this string and the comment above it. The feature is called
  **"App lock"** (`src/components/settings/AppLockSettings.tsx`, `title="App lock"`) and it
  is mounted in Settings under **Account Security** (`src/pages/Settings.tsx:696`, under the
  heading at `:641`). So the correct pointer is *Settings -> Account Security -> App lock*.
* **It is shown on web, where the feature renders nothing.** The hint's condition is
  `Capacitor.isNativePlatform() || typeof window !== 'undefined'` (`:767`). The right-hand
  side is **true in every browser**, so the `||` makes the whole guard unconditional on web.
  `AppLockSettings` opens with `if (!Capacitor.isNativePlatform()) return null;`
  (`AppLockSettings.tsx:35`). **Every web user finishing onboarding is sent to look for a
  control that is not there, under a name that is not there either.**

### 2. "Budget Control" is now labelled "Plan"
`src/pages/Onboarding.tsx`, the expenses step:

> Approximate is fine — you can adjust later in **Budget Control**.

That tab is rendered as **"Plan"**: `src/pages/Transactions.tsx:904`,
`{ id: 'budget', label: 'Plan' }`. "Budget Control" survives in ~20 source comments and in
zero user-visible strings.

**Corroborated from inside the app rather than from memory:** the demo hero on
`src/pages/Dashboard.tsx:1794` already lists the same surface as **"Plan"**. The app has two
first-run-ish surfaces naming one tab two different ways, and onboarding holds the stale one.

### 3. "Unlimited history" is a premium promise made nowhere else
`src/pages/Onboarding.tsx:741`, the finish step's premium block, lists: *Auto-sync
transactions, Plaid bank connection, **Unlimited history**, Priority support*.

⚠️ **CORRECTED 2026-09-18 BY SAM, AND THE CORRECTION STRENGTHENS IT.** My grep was
CASE-SENSITIVE and returned **1**. It is at least **2**: `src/pages/Settings.tsx:1232` carries
it lowercase — *"Upgrade to Premium for advanced features, unlimited history, and priority
support."* Fourth sighting of the lowercase-grep trap on this machine in a week, every one by
somebody being careful at the time. **Two surfaces, so leaving it is two false promises.**

⚠️ **AND THE CLAIM IS NOT "TRUE OR UNTRUE" — IT IS VACUOUS**, which is more awkward than
either. Sam measured it: no plan-bounded history query exists anywhere in `src/` — no
`.gte`/`.lt`/`.limit` on a date gated by `isPremium`, tier or plan. The only `isPremium`
month-gate is `CreditCardEngine.tsx:2271`, and that caps a forward-looking FORECAST projection,
not history. **Free users already have unlimited history**, so the line sells as a paid benefit
something everyone already has, and an upgrader receives nothing new.

**FILED TO TRE AS `40ee39b6` AND NOT MINE TO DECIDE.** There are two legitimate answers — remove
the line, or MAKE it true by limiting free history — and the second is a revenue decision with
churn risk against 29 users of whom 23 are dormant. **Do not fold this into the onboarding
rewrite until he answers: the two answers produce opposite copy.**

The original (case-sensitive) reading and its control, kept because the control is the part worth
copying: `grep -rn "Unlimited history" src/` returned **1**.
**Positive control, same run:** `"Priority support"` returns **6**, so the grep does find
premium copy where it exists. The canonical lists agree with each other and not with
onboarding — `src/pages/Premium.tsx:19-27` and `src/components/premium/NativePaywall.tsx:17-23`
both read: Advanced dashboard, Export to CSV/PDF, Unlimited savings goals & debts, Custom rule
categories, Priority support.

⚠️ **This is paywall copy, so it is NOT mine to change** (dispatch brief: anything touching
the paywall step comes to Sam). Recorded, not fixed. The open question is whether the promise
is true and undocumented, or simply untrue.

## STILL TRUE — stated explicitly, so silence is not mistaken for a check

* **`DebtsStep.tsx:64`, "link this to an account in Accounts"** — `Accounts` is a live
  dashboard tab (`src/lib/dashboard-tab.ts:23`, `['overview','accounts','goals']`). Correct.
* **All four checklist links resolve.** `/dashboard?tab=accounts` direct; `/budget` ->
  `/transactions?tab=budget` (`App.tsx:233`); `/goals` -> `/dashboard?tab=goals` (`:250`);
  `/debt` direct. No dead link in the nudge.
* **"Advanced 60-month cash flow forecast"** — the engine genuinely walks 60 months
  (`src/lib/forecast-engine.ts`, multiple).

## OMISSIONS — the app grew a teaching surface and onboarding never learned

Not false claims; absences. Recorded separately because the fix is different.

* **The Account tab now holds five sections** — Profile, Leaderboard, Achievements, Learn, AI
  (`src/pages/Account.tsx:24`). **Onboarding names none of them.** `Learn` is the app's own
  teaching surface, and first run never points a single user at it.
* **The bottom bar is icon-only.** The flow teaches no navigation at all, so a user's first
  independent action is decoding unlabelled icons.
* Achievements moved off the home tab and the dashboard was decluttered; the welcome step
  still promises "your dashboard is ready from day one" without saying what is on it.

## WHAT I AM NOT CLAIMING

* **I have not walked the flow in a browser.** This is a SOURCE inventory. It is sufficient
  for a wrong string and a wrong guard, and it cannot see layout, contrast, or a step that
  fails to mount. The rendered walk is a separate item, and it needs the reviewer reset —
  which this repo has measured as unverifiable from the database row, because the app undoes
  it within a second. Assert the SCREEN.
* **I have not measured "Takes 2 minutes."** Nine screens, five of them numeric entry.
  Plausibly false; unmeasured, so not listed as a defect.
* Nothing here says which fix comes first. That is step 2.
