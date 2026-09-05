# Selling Forgenta outside the United States — what it takes, in order

Written 2026-09-05. **Nothing in either console has been changed, and nobody has
signed in to either console for this document.** Every store fact below comes
from the vendor's own public help pages, and each claim carries its link.

This is the paper Tre reads before he clicks anything. It answers three
questions per market: can we legally sell there, what does each store demand of
us first, and what must change in the app before a user there gets a correct
number on screen.

**Read section 4 before section 5.** Section 4 is the reason the checklist does
not start today.

> ⚠️ **I am not a lawyer and neither is Tre.** Where a point is a genuine legal
> question I say so and name the question. Section 6 collects every one of them
> in a single list. Do not treat this document as advice.

---

## 0. The one-paragraph answer

The store side is easy and mostly already done. Both stores act as the seller for
us in almost every market we want, which removes the single biggest worry — we do
not register for VAT anywhere, and we do not file a foreign tax return, as long
as every sale goes through Apple's or Google's own billing. The blockers are all
on our side of the line: **the app can only link United States banks**, **every
amount on every screen is drawn in dollars with US formatting**, and **the App
Store now publishes a trader address for any app sold in the EU**, which is the
same disclosure Tre already refused for Japan. So: **zero new markets are
shippable today.** Five are close, and they are all English-speaking.

---

## 1. The country list

### Where this list comes from

`docs/international-release-plan.md` (2026-09-03) did the app-side counting and
left the store side open. `handoff.md` records the decisions. This document
picks up the open items and adds the store and legal reading.

### Excluded, already decided — do not re-open

| Market | Why it is out |
| --- | --- |
| **Japan** | Google requires a paid app to display the business operator's **name, telephone number and physical address** under the Specified Commercial Transactions Act ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/6223646)). Tre declined to publish the LLC phone and address. **Decided 2026-09-03. Not pending.** |

### Excluded, new — decided here on cost, not on principle

| Market | Why it is out |
| --- | --- |
| **Mainland China** | An app listed in mainland China needs an ICP filing number, and only an entity registered in mainland China can hold one. A US LLC cannot obtain one without a local subsidiary or a licensed local publishing partner ([AppInChina](https://appinchina.co/blog/how-can-i-publish-on-the-apple-app-store-china/), [21cloudbox](https://www.21cloudbox.com/china-icp-license-mobile-app.html)). That is a company, not a checkbox. Out. |
| **Brazil** | Google requires merchant onboarding with beneficial owners, executives, authorised representatives and CPF/CNPJ documentation ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/6223646)). Real paperwork for a market we have no users in. Out of the first tranche. |
| **Israel** | Google requires KYC identity verification, with enhanced checks above 50,000 ILS per six months ([same page](https://support.google.com/googleplay/android-developer/answer/6223646)). Out of the first tranche. |
| **South Korea, Vietnam, India** | Google's country rules here are aimed at games, gambling and lending, not at a budgeting app ([same page](https://support.google.com/googleplay/android-developer/answer/6223646)). Korea's extra paperwork applies to *Korean* developers. Probably harmless for us — but "probably" is not a reason to include a market we do not need. Out of the first tranche, revisit later. |

### Tranche A — cheap. English, no translation, store remits the tax.

These are the markets where the only work is on our side, and it is the currency
work. No local entity. No local address. No language.

| Market | Currency | Store remits consumption tax? |
| --- | --- | --- |
| **United Kingdom** | GBP | Yes — Google is responsible for determining, charging and remitting UK VAT on Play billing purchases ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)). Apple is the seller of record in the UK. |
| **Canada** | CAD | Apple yes. Google: the help page states that developers *located in Canada* with a GST/HST ID carry the obligation — it does not plainly state the position for a US developer selling into Canada. **See open question Q1.** |
| **Australia** | AUD | Yes — for developers outside Australia, Google determines, charges and remits 10% GST ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)). |
| **New Zealand** | NZD | Yes — Google named among the countries where it remits GST ([same page](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)). |
| **Ireland** | EUR | Yes — Google remits VAT for all EU customers on Play billing ([same page](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)). |

⚠️ **Ireland is in the EU, so it is not actually cheap.** It carries the whole EU
legal surface in section 3 — the DSA trader publication, the withdrawal right,
the GDPR representative. It is listed here only because the *language* is free.
If Tre wants a genuinely obligation-free first tranche, it is **UK, Canada,
Australia, New Zealand** and Ireland waits for the EU decision.

### Tranche B — real obligations. Western Europe.

Germany, France, Netherlands, Spain, Italy, Belgium, Austria, Portugal, and the
rest of the EU 27, plus Norway, Iceland and Switzerland.

Everything in Tranche A applies, **plus** translation (the app hardcodes English
month names and English copy), **plus** the EU legal surface in section 3.
Switzerland is worse than the EU on one specific point: **we** would be
responsible for determining, charging and remitting Swiss VAT, not Google
([Play Console Help](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)).
That single line takes Switzerland out of any early tranche.

**Recommendation: do not open Tranche B in the same sitting as Tranche A.** It
doubles the legal surface for markets where the app is also not translated.

---

## 2. What each store actually asks for

### Google Play Console

**Where the click is.** Play Console → the app → Production → **Countries /
regions** tab → *Add countries/regions*. Availability changes apply **across all
tracks**, and for a paid app **new prices are added automatically** when a
country is added ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/7550024?hl=en)).
Targeting follows the user's Play account country, not their physical location —
which matters, because it means a US-registered account travelling abroad is not
affected either way.

**What must already be true before that click:**

1. **A verified payments profile with tax information.** Play Console → Settings
   → Payments settings → Payments profile → tax info. A US LLC supplies its
   **EIN and legal business name**, and the record must match what the IRS has
   ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/7163598?hl=en)).
   This is already in place — Forgenta already sells subscriptions in the US.
2. **Verified developer identity.** Organisation accounts must supply a **D-U-N-S
   number**, and Google publishes the **legal name, legal address, developer
   email and developer phone** on the public Play listing for organisation
   accounts ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/10841920?hl=en),
   [contact information requirements](https://support.google.com/googleplay/android-developer/answer/10840893?hl=en)).
   ⚠️ **Read this carefully, Tre.** If the Forgenta Play account is an
   *organisation* account, the LLC address may already be public today. That does
   not re-open Japan — Japan's requirement is a separate, in-app/in-listing
   business-operator disclosure for paid apps — but it does mean the address
   objection may already be moot on Play. **Verify what the listing shows before
   assuming either way** (checklist step 1).
3. **A completed IARC content rating questionnaire.** Every app must carry an
   IARC rating or it is removed from the Play Store, and the same answers
   generate the region-specific ratings — ClassInd in Brazil, GRAC in South
   Korea, and IARC elsewhere ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/9859655?hl=en)).
   Already done for the US listing; adding countries does not require redoing it,
   but a rating authority in a new region **can override the rating after review**.
4. **The Financial features declaration.** Any app with financial features must
   complete it, and the policy states you must comply with the regulations of
   **any region or country your app targets**
   ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en),
   [Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821?hl=en)).
   Forgenta aggregates bank data, so this declaration is ours and it must be
   re-read against each new country. **See open question Q2 — this is the one
   with real teeth.**
5. **Tax and compliance settings, per EEA country.** For the EEA, each product
   must be classified as **"Digital Content" or "Service"**, and the choice
   affects the customer's withdrawal rights under EU consumer law
   ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/10463498?hl=en)).
   This is a genuine choice we have never made, because we have never sold in the
   EEA. It is not a formality.

### App Store Connect

**Where the click is.** App Store Connect → Apps → Forgenta → **Pricing and
Availability** → App Availability → *Manage*. Choose *All Countries or Regions*
or *Specific Countries or Regions*. Changes take effect immediately but can take
up to 24 hours to be visible. Deselecting a country later removes the app from
that store front, **but users who already downloaded it keep receiving updates
and can re-download from their purchase history**
([App Store Connect Help](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store/)).

**What must already be true before that click:**

1. **The Paid Apps agreement, active, with banking and tax forms.** Tax forms are
   only shown after the Paid Apps agreement is signed, and every developer must
   complete a US tax form to comply with it
   ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/provide-tax-information/tax-forms-overview)).
   Already in place — Forgenta already sells subscriptions.
2. **The EU Digital Services Act trader declaration. This is the big one.**
   Articles 30 and 31 of the DSA require Apple to verify and display trader
   contact information for every trader distributing apps in the EU. For an
   **organisation**, Apple requires a **phone number and email address**, and the
   **address is displayed automatically from the D-U-N-S number**. Once verified,
   **Apple publishes that information on the App Store product page in all 27 EU
   territories.** Apps without a verified trader status have already been removed
   from the EU App Store
   ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/),
   [Apple Developer news](https://developer.apple.com/news/?id=einwn76m)).
   Forgenta takes revenue from subscriptions, so it is a trader under Apple's own
   definition. **There is no EU distribution without this publication.**
   ⚠️ **This is the same shape of disclosure Tre refused for Japan.** It is not the
   same requirement and Japan stays closed either way — but if the answer is the
   same, the entire EU tranche closes with it, and Tranche A shrinks to UK,
   Canada, Australia and New Zealand. **This is a decision only Tre can make**
   (checklist step 2).
3. **The age rating questionnaire, in its current form.** Apple replaced 12+ and
   17+ with 13+, 16+ and 18+, and required every app to complete the new
   questionnaire by 31 January 2026 — apps that did not are blocked from new
   submissions and updates
   ([Apple Developer news](https://developer.apple.com/news/?id=ks775ehf)).
   From September 2026 the new social-features questions are also required on
   submission ([Apple Developer news](https://developer.apple.com/news/?id=tlur8uvi)).
   Ratings are assigned **per country or region** and can differ. Nothing new is
   needed to add a country, but if Forgenta's questionnaire is stale, **it blocks
   the update that carries the currency fix**, not just the expansion.
4. **Privacy nutrition labels.** Already required globally and already declared
   for the US listing. Adding a country does not change them. **But** if the
   expansion adds any new data flow — a currency-rate provider, a new analytics
   region — the labels must be updated in the same submission.

### What neither store needs from us

Neither store requires a local entity, a local bank account or a local
representative for any Tranche A market. Neither requires per-country pricing
work: both derive local prices from the base price we already set, and Google
adds the new prices automatically when a country is added
([Play Console Help](https://support.google.com/googleplay/android-developer/answer/7550024?hl=en)).
RevenueCat needs nothing changed — its country coverage is simply whatever the
stores support ([RevenueCat](https://www.revenuecat.com/docs/platform-resources/developer-store-payments)).

---

## 3. The legal surface, in plain terms

Only the parts that actually bind a US LLC selling a consumer subscription app.

### VAT and GST — the pivotal fact, and it splits by payment route

**Through Apple's or Google's billing, we owe nothing and register nowhere.**
Google states plainly that it determines, charges and remits VAT for **all EU**
and **all UK** Play Store purchases of digital content through Play billing, and
the same for Norway and Iceland, and GST in Australia and New Zealand for
developers outside those countries
([Play Console Help](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)).
Apple is the seller of record in nearly every App Store territory and calculates,
collects and remits local consumption tax itself. **This is the single fact that
makes expansion cheap.**

The two exceptions that matter:
- **Switzerland — we are responsible.** Google states it explicitly
  ([same page](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)).
  Keep Switzerland out.
- **Canada — unclear from the page.** See Q1.

**Through our own Stripe checkout, we owe everything.** ⚠️ Forgenta sells
subscriptions on the web through Stripe Checkout
(`supabase/functions/create-checkout/index.ts:209`). Stripe is **not** the
merchant of record on a standard integration — the business is, and the business
carries the tax obligation
([Stripe](https://stripe.com/resources/more/merchant-of-record-vs-seller-of-record)).
And a non-EU business selling digital services to EU consumers has **no
registration threshold at all**: EU-established sellers get a EUR 10,000
threshold, non-Union sellers get none, so the obligation starts at the first euro
([European Commission, One Stop Shop](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en),
[Your Europe](https://europa.eu/youreurope/business/taxation/vat/one-stop-shop/index_en.htm)).

I checked the checkout code: **it sets no `automatic_tax`, collects no billing
address and collects no tax ID.** So a European customer buying on the web today
pays a US-priced subscription with no VAT charged and no VAT remitted. This is
**not** created by the expansion — it exists right now — but the expansion makes
it far more likely to happen. **See Q3. This is a professional question and I am
not answering it.**

### Right of withdrawal — EU and UK, 14 days

The EU Consumer Rights Directive gives a consumer 14 days to withdraw from a
purchase. Apple implements it directly: a user cancels in Apple Account →
Purchase History → *Withdraw Purchase*, and for subscriptions the right applies
to the **initial** subscription and not to each automatic renewal
([Apple, UK right of withdrawal](https://www.apple.com/legal/internet-services/itunes/uk/rightofwithdrawal-uk.pdf),
[Apple Media Services terms, UK](https://www.apple.com/uk/legal/internet-services/itunes/uk/terms.html)).
Google implements it through the **Digital Content vs Service** classification in
tax and compliance settings
([Play Console Help](https://support.google.com/googleplay/android-developer/answer/10463498?hl=en)).

**What this means for us:** because the stores are the seller, the stores handle
the withdrawal. We do not build a refund flow. **What we must not do** is show
in-app copy that contradicts it — any "no refunds" or "all sales final" wording
in the paywall or terms becomes wrong the moment an EU user can see it. That is a
copy change, not an engineering change (checklist step 6).

### GDPR and UK GDPR — this one is real work

Forgenta processes financial data of identifiable people. Offering the service to
people in the EU brings it inside the GDPR regardless of where the LLC sits.

**Article 27 requires a controller with no EU establishment to appoint a
representative in the EU, in writing**, and the UK GDPR carries a separate,
parallel requirement for a UK representative
([GDPR Local](https://gdprlocal.com/gdpr-art-27-requirements-explained/),
[activeMind UK](https://www.activemind.uk/uk-representative/)).
These are paid services, typically a few hundred pounds a year each, and the
representative's name and address must be published in the privacy policy.

There is an exemption for **occasional** processing that is unlikely to be risky.
⚠️ **Continuous bank-transaction aggregation is not occasional and financial data
is not low-risk**, so I would not rely on the exemption — but whether it applies
is exactly the kind of question that needs a professional answer. **See Q4.**

Beyond the representative, EU/UK distribution also brings: a lawful basis stated
for each purpose, a working data-subject access and deletion path, breach
notification within 72 hours, and a records-of-processing obligation. The repo has
`docs/data-retention-policy.md`, so some of this exists. **None of it has been
reviewed against the GDPR.**

### Open banking authorisation — the question nobody has asked yet

Aggregating a consumer's bank account data in the EU is a **regulated activity**
under PSD2, performed by an authorised Account Information Service Provider. The
UK has an equivalent regime. In the US this is unregulated and we simply use
Plaid. In the EU and UK, the licence question is live: does Forgenta rely on
Plaid's own AISP authorisation as its agent, or does Forgenta need its own? Plaid
does operate in the UK and 17 European countries
([Plaid](https://plaid.com/global/)), which is what makes the question worth
asking rather than academic. **See Q2. This is the most expensive question in
this document if the answer is unfavourable, and it applies to the UK too — not
just the EU.**

---

## 4. What must change in the product first — the honest version

### Two hard blockers, either of which alone stops a launch

**Blocker 1 — the app can only link United States banks.**

`supabase/functions/plaid-create-link-token/index.ts:118` sends
`country_codes: ["US"]` and `language: "en"` to Plaid. The same hardcoded
`["US"]` appears again at `supabase/functions/plaid-exchange-token/index.ts:170`.
Akoya, the other provider, is US-only by nature.

A user in London or Toronto downloads Forgenta, taps "connect a bank", and Plaid
shows them **United States institutions only**. There is no British bank in the
list. The core feature of the app does not function.

This is not in `docs/international-release-plan.md` and it is not in
`handoff.md`. As far as I can tell, **nobody had counted it before now.** It is a
small code change and a large amount of testing — Plaid must be enabled for those
countries on our Plaid account, the products we request must be supported there
([Plaid coverage](https://support.plaid.com/hc/en-us/articles/27895826947735-What-Plaid-products-are-supported-in-each-country-and-region)),
and the whole sync path assumes one currency per user.

**Blocker 2 — every amount on every screen is a dollar amount.**

Counted in the repo, not estimated (from `docs/international-release-plan.md`,
2026-09-03):

| Thing | Count |
| --- | --- |
| `en-US` hardcoded in `src/` | 44 |
| `toLocaleDateString` / `toLocaleString` call sites | 91 |
| …pinned to `en-US` | 32 |
| Hardcoded `$` in JSX | 19 |
| `formatCurrency` calls that pass a currency | **0** |
| Currency stored on a money row in the database | **none** |

The Settings currency picker is currently **disabled** with an honest note,
because selecting EUR changed nothing. Multi-currency is decided but not started:
the data layer does not carry a currency at all, so there is nothing to convert
from.

**A finance app that shows a British user "$1,240.00" for their £1,240 balance is
not a localisation gap. It is a wrong number on a screen about money.** That is
the standard this repo already holds itself to everywhere else.

### What is NOT blocking, and should not be used as an excuse

Dates are fine in English-speaking markets. `docs/international-release-plan.md`
records a correction: all 32 `en-US` date sites pass explicit textual options, so
the app renders `Sep 3, 2026` — unambiguous in every locale. There are zero bare
numeric-date calls. The only date defect is **hardcoded English month names**,
which is a translation issue and does not affect Tranche A at all.

### So: what is shippable today?

**Nothing. Not one market.** Both blockers apply to every country outside the
United States, because there is no market where a user banks in US dollars at US
institutions and is not already served by the US listing.

The useful distinction is what each tranche needs:

| Tranche | Needs | Does NOT need |
| --- | --- | --- |
| **A** — UK, Canada, Australia, New Zealand | Plaid country enablement + currency threaded through `formatCurrency` + currency stored on money rows | Translation. Date work. A local entity. |
| **A+** — Ireland | All of the above | Translation — **but** it pulls in the whole EU legal surface |
| **B** — rest of Western Europe | All of the above **plus** translation, month names, EU legal surface | — |

The ordering that follows: **fix the app, then flip the store.** The store change
is a checkbox. The app change is the work. Doing it the other way round ships
wrong numbers to new users on day one and spends the launch apologising.

---

## 5. The staged checklist

Everything before step 12 is free, private and reversible. Step 12 is not.

### Stage 1 — read-only, no changes, do this first (about 30 minutes)

1. **Play Console → Settings → Developer account → Developer page.** Read what is
   published today: legal name, legal address, email, phone. **Verify:** write
   down exactly what a member of the public can already see. This settles whether
   the address objection is still live on Play at all.
2. **App Store Connect → Business → Agreements → Compliance → Digital Services
   Act.** Read the current trader status **without changing it**. **Verify:**
   whether it says trader or not-a-trader, and what contact fields it would
   publish.
   → **DECISION FOR TRE, and it gates everything EU.** Apple publishes the trader
   phone, email and D-U-N-S address on the EU product page. If the answer is no,
   stop reading at Tranche A and the EU never opens. Nobody but Tre can answer
   this. **This does not re-open Japan.**
3. **App Store Connect → Apps → Forgenta → Age Rating.** **Verify:** the new-format
   questionnaire (13+/16+/18+) is completed. If it is not, submissions are already
   blocked and that blocks the currency fix too.
4. **Play Console → App content.** **Verify:** IARC rating present, Financial
   features declaration complete, Data safety current.
5. **Both consoles → current availability.** **Verify and write down** the exact
   list of countries Forgenta is live in today, per store. Everything after this
   is a diff against that list.

### Stage 2 — the product work, and it is the long pole

6. **Decide the paywall copy.** Remove or reword anything that says or implies "no
   refunds" / "all sales final". **Verify:** grep the paywall and terms copy and
   read it as a European consumer would.
7. **Store a currency on every money-carrying row.** Migration, write path, and a
   backfill of every existing row to `USD`. This is a slice in its own right and
   it has not been started. **Verify:** a row read back out of the database carries
   a currency, and the backfill count equals the row count.
8. **Thread currency and locale through `formatCurrency`.** Then the call sites.
   Then the 19 hardcoded `$`. Then `exportPdf.ts:168` and
   `notification-policy.ts:307`, which hardcode locale **and** USD together.
   **Verify:** a test account set to GBP renders `£` with UK grouping on the
   dashboard, the forecast, the debt page, a statement PDF and a push
   notification. Screenshot each.
9. **Enable the Tranche A countries in Plaid, and pass them through.** Replace the
   hardcoded `["US"]` in both edge functions with the user's market. **Verify:**
   a Plaid Link session for a UK user lists UK institutions. Do this in Plaid's
   sandbox first.
10. **Re-enable the Settings currency picker.** It is disabled today on purpose.
    **Verify:** changing it actually changes what is on screen.
11. **Run the gates.** `npm run test:tz` (the real gate — it runs under UTC,
    America/New_York and Asia/Tokyo), `npx tsc --noEmit`, `npm run lint`,
    `npm run build`. **Verify:** green, and the test count did not fall.

### Stage 3 — the store, one sitting

12. ⛔ **THE IRREVERSIBLE STEP. Everything above can be undone. This cannot.**

    **Play Console → Forgenta → Production → Countries / regions → Add
    countries/regions → select Tranche A → Confirm.** Then, in the same sitting:
    **App Store Connect → Forgenta → Pricing and Availability → App Availability →
    Manage → add Tranche A → Confirm.**

    **Why it cannot be undone.** The moment it lands, real people in those
    countries can install and subscribe. Google's own note is that the change
    applies **across all tracks** and that prices for new countries are added
    automatically. Removing a country later stops new installs, but Apple states
    that users who already downloaded the app keep receiving updates and can
    re-download it from their purchase history. A subscription taken in a new
    country cannot be un-taken, and it brings its consumer-protection, tax and
    data-protection obligations with it permanently. **Do not press this until
    steps 1 through 11 are done and step 2 has been answered.**

13. **Verify within 24 hours.** Both stores state changes can take up to 24 hours
    to be visible. **Verify:** open the public store page from a device or account
    registered in each new country and confirm the listing appears, the price
    shows in local currency, and — for any EU country — that the published trader
    information is what step 2 agreed to.
14. **Verify the first real sale end-to-end.** Not a sandbox one. Read the row back
    out of the database: the subscription is recorded, the currency on it is the
    local currency, and RevenueCat and the `stripe-webhook` / `revenuecat-webhook`
    path agree with the store. **A first foreign sale that lands as USD in our own
    tables is the failure mode to look for.**

---

## 6. Open questions — I could not source these, and they need a professional

Listed as questions rather than buried as confident prose. Each names who should
answer it.

- **Q1 — Canada GST/HST for a US developer on Google Play.** Google's tax page
  states that developers **located in Canada** with a valid GST/HST ID are
  responsible for determining and remitting the tax. It does not plainly state
  the position for a **US** developer selling to Canadian customers. Apple's
  seller-of-record position covers Apple's side. *Who answers: Google Play
  developer support, in writing, before Canada is added.*
  [Source that left the gap](https://support.google.com/googleplay/android-developer/answer/138000?hl=en)

- **Q2 — Does Forgenta need its own open-banking authorisation in the UK or the
  EU, or does it operate under Plaid's?** Account aggregation is a regulated
  activity there and is not in the US. Google's Financial Services policy
  separately requires compliance with the regulations of every country the app
  targets. *Who answers: Plaid's compliance team first — they will know whether
  their client model covers us — then a UK/EU financial-services lawyer if the
  answer is not a clean yes.* **This is the most expensive question here.**

- **Q3 — VAT on web subscriptions sold through our own Stripe checkout.** Stripe
  is not the merchant of record on a standard integration, and there is no
  registration threshold for a non-EU seller of digital services into the EU. Our
  checkout sets no automatic tax and collects no address. This exposure exists
  **today**, before any expansion. *Who answers: a tax accountant with
  cross-border digital-services experience. The likely outcomes are non-Union OSS
  registration, enabling Stripe Tax, or geo-restricting web checkout to the US.*

- **Q4 — Does the GDPR Article 27 "occasional processing" exemption apply to us?**
  I do not believe it does — continuous bank-transaction aggregation is neither
  occasional nor low-risk — but I am not qualified to conclude it. If it does not
  apply, we need a paid EU representative **and** a separate UK representative,
  both named in the privacy policy. *Who answers: a data-protection adviser, or
  one of the Article 27 representative services directly.*

- **Q5 — Is the Forgenta Play account an organisation account or a personal
  account?** This determines whether the LLC's legal address is already public on
  Play. I could not check without signing in, and I did not sign in.
  *Who answers: step 1 of the checklist, in 30 seconds.*

- **Q6 — What does Google Play require for EU trader status, specifically?** Apple's
  DSA requirement is documented in detail and I have quoted it. I could **not**
  find an equivalent, plainly-worded Play Console help page for the DSA trader
  declaration; the Play side appears to be handled through the existing developer
  identity verification, but I am inferring that and I will not assert it.
  *Who answers: step 1 of the checklist, plus Play Console's EEA conditions page.*

- **Q7 — Which Plaid products are enabled on our Plaid account for the Tranche A
  countries, and at what price?** Plaid supports the UK and 17 European countries,
  but "not all products are available in all countries" and our contract may not
  include them. *Who answers: our Plaid account manager.*

---

## 7. Things I did not check

Said plainly, because a silent gap is how a broken thing ships.

- **I did not sign in to Play Console or App Store Connect**, and I was told not
  to. Every statement about what our listings currently show is therefore a
  question in section 6, not a fact.
- **I did not verify Apple's per-territory VAT list.** Apple publishes it in
  Exhibit B of the Developer Program License Agreement, which is behind the
  developer account. I have relied on Apple's documented seller-of-record
  position instead, which is the load-bearing fact.
- **I did not price anything** — not the Article 27 representatives, not Plaid's
  European coverage, not a tax adviser.
- **I did not test the app in any non-US configuration.** The two blockers in
  section 4 are read from code and from the repo's own counts, not from a device
  in London.
- **I did not read the App Review Guidelines for region-specific rejection
  risks.** A finance app connecting to banks in a new country may draw review
  questions that a US listing never did.
