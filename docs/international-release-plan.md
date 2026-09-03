# Releasing Forgenta to more countries — the plan, before any console change

Written 2026-09-03. **No store setting has been changed.** Adding a country starts
distribution to real people and removing it later is not free, so this is the
paper first.

Sam's brief asked five things. **Item 4 is answered here with evidence, because it
is code and code can be read. Items 1, 2, 3 and 5 need a console pass I have not
done, and I am not going to guess at them.**

---

## 4. What breaks in the app itself — ANSWERED, AND IT IS WORSE THAN FORMATTING

Sam bet this would be the item that breaks. It is, and the sharpest part is not a
formatting nicety — it is a control that lies.

### The Settings currency picker does nothing

`src/pages/Settings.tsx:505` offers **USD, EUR and GBP**. Selecting EUR or GBP
changes **nothing anywhere in the app**:

- `formatCurrency` (`src/lib/calculations.ts:1`) takes a `currency` argument that
  **no call site ever passes**. Verified: zero three-argument calls in `src/`.
- The only reader of `profile.currency` outside Settings is `useWidgetSync`
  (`src/pages/Dashboard.tsx:755`) — the home-screen widget. The app's own screens
  never see it.

So a user in Dublin sets EUR, and every balance, every projection and every
payoff figure still renders in dollars. That is live today, before any expansion,
and it is the shape this repo keeps hitting: a control that was built, described,
and never pressed.

### The locale is hardcoded even when the currency is not

`formatCurrency` calls `new Intl.NumberFormat('en-US', …)`. Locale is not the
same knob as currency: `en-US` renders `€1,234.56` where most of the eurozone
expects `1.234,56 €`. Passing the currency through would fix the symbol and leave
the grouping, separator and symbol position wrong.

### Counted, not estimated

| Thing | Count |
| --- | --- |
| `en-US` hardcoded in `src/` (excluding tests) | 44 |
| `toLocaleDateString` / `toLocaleString` call sites | 91 |
| …of those, pinned to `en-US` — so **MM/DD/YYYY** | 32 |
| Hardcoded `$` in JSX | 19 |
| `formatCurrency` calls that pass a currency | **0** |

**MM/DD/YYYY is the one that will not be reported.** Outside the US, 03/09/2026
reads as 3 September. A user will not file a bug; they will read the wrong date
and quietly stop trusting the app. `src/lib/exportPdf.ts:168` and
`src/lib/notification-policy.ts:307` hardcode `en-US` AND `USD` together, so a
statement PDF and a push notification are both wrong for a non-US user.

### One piece of dead code worth knowing

`src/lib/schemas.ts:38` defines `profileSchema` with `currency: z.enum(['USD'])`
— but `profileSchema` is **imported nowhere**. It does not gate the save, which
is why the picker can store EUR at all. Whoever revives that schema must widen
the enum first, or saving EUR starts failing.

### Order I would fix it in

1. **Thread `profile.currency` into `formatCurrency` and pick the locale from it.**
   One helper, then the call sites. Without this, nothing else matters.
2. **Replace the 32 `en-US` date calls** with the user's locale.
3. **Kill the 19 hardcoded `$`** and `formatYAxisTick`'s `$`.
4. **Fix `exportPdf` and `notification-policy`**, which are wrong twice over.
5. Decide what the currency picker MEANS. Display-only relabelling, or a real
   multi-currency model? Balances come from Plaid in the account's own currency,
   and calling €100 "$100" is worse than useless in a finance app. **This is a
   product decision for Tre, and it gates how much of the above is worth doing.**

⚠️ **Do not ship a country until at least 1-4 are done.** A finance app showing
dollars and US dates to a British user is not a localisation gap, it is wrong
numbers on a screen about money.

---

## 1, 2, 3, 5 — NOT DONE, and why

These need App Store Connect and Play Console read directly. I have not opened
them for this, so anything I wrote would be invention:

1. **Where Forgenta is available today** on each store — must be read, not assumed.
2. **A first tranche with no special obligations** — Sam suggests English-speaking
   markets plus Western Europe. Plausible, but the tax position needs confirming
   per store rather than accepted.
3. **Countries needing something from Tre first.** From Google's own page
   (`support.google.com/googleplay/android-developer/answer/6223646`), for a paid
   or subscription app:
   - **Japan — EXCLUDED, decided 2026-09-03.** Google requires a paid app to
     display the business operator's name, phone number and physical address.
     Tre declined to publish his LLC phone and address, and the requirement is
     not negotiable on Google's side, so Japan is out of the first tranche and
     out of later ones until that changes. Not pending — decided.
   - **Brazil** — merchant onboarding: business info, beneficial owners,
     executives, CPF/CNPJ.
   - **Israel** — KYC identity verification, enhanced above 50,000 ILS / 6 months.
   - **Korea, Vietnam, India** — licensing/content rules aimed at games. Likely
     not binding here, but confirm rather than assume.
   - **EU** — no unjustified geo-blocking by nationality or residence.
   These are transcribed from Sam's reading of that page and should be verified
   against the live page before anyone acts on them.
5. **Tax and pricing settings** for new territories in both consoles — unread.

---

## The order that follows from all this

App first, store second. The store change is a checkbox; the app change is the
work, and doing it in the other order ships wrong numbers to new users on day one
and spends the launch fixing them.


---

## Real multi-currency — scoped 2026-09-03, NOT started

Tre chose **real multi-currency** and explicitly declined display-only
relabelling as a destination. The disabled picker is the stopgap, already
shipped.

### What makes this hard, and it is not the formatting

Each account carries its own currency from Plaid, so one portfolio can be mixed.
The moment two currencies appear, every total is a **derived** number rather than
a measured one, and this app's whole standard is that a figure you did not read
is not a figure you may show.

Three decisions come before any code:

1. **Per-currency subtotals, or one converted total?** Refusing to sum is the
   honest default and costs the user a single headline number. Converting gives
   the headline and makes it an estimate. Pick one deliberately; do not let the
   UI imply the first while doing the second.
2. **Which rate, for HISTORY?** A payoff projection converted at today's rate is
   a different number from one converted at each transaction's own rate, and over
   a payoff horizon the gap compounds. Whichever is chosen must be stated ON
   SCREEN, not just in a comment.
3. **Where the rate came from and when.** A converted figure without a source and
   an as-of date is exactly the "confident zero" this repo already refuses to
   draw.

### The rate source — what to establish BEFORE choosing one

Do not pick a provider on price. Establish these first, because a finance app on
an unversioned free FX feed does not fail loudly, it silently starts returning
stale numbers:

- **Does it version or date every rate**, so a stored historical conversion can be
  reproduced later? If rates are not reproducible, a past screen cannot be
  explained to a user who queries it.
- **What is the licence for redistribution?** Several free feeds forbid showing
  their rates to end users, which is precisely what this does.
- **What is the stated update cadence and the failure mode?** A feed that returns
  yesterday's rate on failure is more dangerous than one that returns an error,
  because the app cannot tell.
- **Rate limits against the number of users**, and whether conversion happens
  client-side per session or server-side once per day.
- **Cost at Forgenta's scale**, which is currently five premium accounts — likely
  a free tier, but the free tiers are where the licence and staleness traps live.

⚠️ **I have not priced or read the terms of any provider.** The list above is what
to check, not a recommendation. Naming one now would be the same failure as
writing the routing table from memory.

### Also in scope, easily missed

`src/lib/exportPdf.ts:168` and `src/lib/notification-policy.ts:307` hardcode BOTH
the locale and USD. A statement PDF and a push notification are both wrong for a
non-US user, and neither is on screen where anyone would notice.
