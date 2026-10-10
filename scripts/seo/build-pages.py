"""Builds the static head-term and comparison pages (ask f07700ff) into public/<slug>/index.html.

Static HTML on purpose: crawlers that run no JavaScript (Bing, link unfurlers, AI crawlers) read these,
and Vercel serves a real file before the SPA rewrite. Competitor facts come ONLY from each company's own
pricing page, with the date checked. Never state what a competitor lacks - we cannot verify absence.
The free-tier drafts of these pages were REJECTED in review for exactly that (invented competitor gaps,
invented Premium limits, a wrong worked example), so the copy lives here, where every claim is visible.
Run: python scripts/seo/build-pages.py   (writes 7 pages; prints each path and word count)
"""
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2] / "public"
CHECKED = "October 7, 2026"
PRICE_ROWS = [
    ("Forgenta", "Free plan; Premium $9.99", "$89.99", "Free plan, no trial needed",
     "Safe to Spend until payday, debt payoff, a plan for your car"),
    ("YNAB", "$14.99", "$109", "34 days", "Zero-based budgeting: every dollar gets a job"),
    ("Monarch Money", "$14.99", "$99.99", "7 days", "Net worth and linked-account dashboard"),
    ("Rocket Money", "Free tier; Premium $7 to $14 (you choose)", "-", "-",
     "Subscription tracking and bill negotiation"),
]


def price_table(names):
    rows = "".join(
        f'<tr><td>{html.escape(n)}</td><td class="num">{html.escape(m)}</td><td class="num">{html.escape(y)}</td>'
        f"<td>{html.escape(t)}</td><td>{html.escape(a)}</td></tr>"
        for n, m, y, t, a in PRICE_ROWS if n in names)
    return ("<table><tr><th>App</th><th>Monthly</th><th>Yearly</th><th>Trial</th><th>Built around</th></tr>"
            f'{rows}</table><p class="fine">Competitor prices are from each company\'s own pricing page, checked '
            f"{CHECKED}. Prices change; check theirs before you decide.</p>")


FEATURES = """<ul>
<li><strong>Safe to Spend until payday.</strong> The lowest your checking balance will reach before payday, after every bill, minus the cash floor you set. Pending card swipes count.</li>
<li><strong>Forecast.</strong> A month-by-month projection of income, bills, debt payments and savings.</li>
<li><strong>Debt payoff.</strong> Avalanche or snowball order, a debt-free date, and how much sooner an extra payment gets you there.</li>
<li><strong>Which Card?</strong> Which card to use for a purchase.</li>
<li>A bill calendar, savings goals, a car fund and budget sharing with a partner.</li>
</ul>"""

# The /vs pages LEAD with the three things Tre sells Forgenta on (2026-10-09: "The debt payment
# recommendations, safe to spend, and car aspect are the selling points of my app"). Every claim is something
# the app does today, on both plans unless it says so: Safe to Spend (safe-to-spend.ts), the month-0 card
# recommendations and debt-free date (credit-card-engine.ts, DashboardHero), and the car plan (Debt > Auto
# Loans: down-payment saving toward a planned date, loan payoff date and extra payments; Garage for builds
# and service). Nothing here says what a competitor lacks.
PILLARS = """<ol class="pillars">
<li><strong>Safe to Spend until payday.</strong> One number: the lowest your checking balance will reach before your next paycheck, after every bill, minus the cash floor you set. Pending card swipes count.</li>
<li><strong>What to pay each card, and your debt-free date.</strong> Forgenta ranks your cards by what each one costs you, says what to send each one this month after every minimum, and shows the month your cards hit zero and how much sooner an extra payment gets you there.</li>
<li><strong>A plan for your car.</strong> Save the down payment for your next car toward the date you plan to buy, and see the month your current car loan is paid off. The Garage keeps each car's build and service log.</li>
</ol>"""

VS_EXTRAS = """<p>Also: a month-by-month forecast, Which Card? for a purchase, a bill calendar, savings goals and budget sharing with a partner.</p>"""

CTA = ('<p><a class="cta" href="https://getforgenta.com/auth">Start free</a> &middot; '
       '<a href="https://getforgenta.com/demo">Try the demo, no sign-up</a></p>')

ALL4 = ["Forgenta", "YNAB", "Monarch Money", "Rocket Money"]

PAGES = [
    dict(slug="best-budget-app", title="Best Budget App for Knowing What You Can Spend | Forgenta",
         h1="The best budget app for knowing what you can spend",
         desc="Compare budget apps by what they answer: Forgenta shows what is safe to spend before payday, "
              "forecasts your months and plans debt payoff. Free plan.",
         lede="The best budget app is the one that answers the question you actually have. If that question is "
              "how much you can spend before payday without missing a bill, that is what Forgenta is built around.",
         body=f"<h2>What Forgenta does</h2>{FEATURES}<h2>How the popular apps differ</h2>{price_table(ALL4)}"
              "<h2>Who should pick which</h2><p>Pick YNAB if you want to give every dollar a job by hand. Pick Monarch "
              "Money if your main goal is a net worth view across many accounts. Pick Rocket Money if you mostly want "
              "help with subscriptions and bills. Pick Forgenta if you want one number before payday and a plan for "
              "your debt.</p>",
         faq=[("What is the best budget app for living paycheck to paycheck?",
               "One that shows the low point before payday, not the end-of-month total. Forgenta's Safe to Spend is the "
               "lowest your checking balance will reach before payday after every bill, minus your cash floor."),
              ("Is there a free budget app that forecasts cash flow?",
               "Yes. Forgenta has a free plan with a month-by-month forecast, and your first bank connection is free."),
              ("How much does Forgenta cost?", "There is a free plan. Premium is $9.99 a month or $89.99 a year.")]),
    dict(slug="simple-budget-app", title="Simple Budget App: One Number Before Payday | Forgenta",
         h1="A simple budget app: one number before payday",
         desc="Forgenta leads with one number: what is safe to spend until payday. Add your pay, your checking "
              "balance and your bills, and it does the rest.",
         lede="Most budget apps ask you to sort every purchase into a category. Forgenta starts with one number "
              "instead: what is safe to spend until payday.",
         body="<h2>Set it up in three steps</h2><ol><li><strong>Pay.</strong> Enter what you earn and how often you "
              "are paid.</li><li><strong>Checking balance.</strong> Link your bank or type the balance in. Your first "
              "bank connection is free.</li><li><strong>Bills.</strong> Add the bills that repeat.</li></ol><p>Safe to "
              "Spend then shows the lowest your account will reach before payday, after every bill, minus your cash "
              f"floor.</p><h2>Everything else is there when you want it</h2>{FEATURES}",
         faq=[("What is the simplest way to budget?",
               "Know the lowest your checking account will reach before payday, after your bills, and spend below it. "
               "Forgenta works that number out for you."),
              ("Do I have to categorize every transaction?",
               "No. Safe to Spend needs your pay, your checking balance and your bills."),
              ("Can I use it without linking a bank?", "Yes. You can type balances in by hand.")]),
    dict(slug="free-budget-app", title="Free Budget App With Forecasts and Debt Payoff | Forgenta",
         h1="A free budget app that still does the hard part",
         desc="Forgenta's free plan shows what is safe to spend before payday, forecasts your months and plans your "
              "debt payoff. Your first bank connection is free.",
         lede="A free budget app should still answer the hard question: what can I spend before payday without "
              "missing a bill? Forgenta's free plan does.",
         body=f"<h2>What you get</h2>{FEATURES}<p>Your first bank connection is free on the free plan, and you can "
              "always type balances in by hand. Premium is $9.99 a month or $89.99 a year.</p>"
              f"<h2>What other apps charge</h2>{price_table(ALL4)}",
         faq=[("Is Forgenta really free?",
               "Yes. There is a free plan, and the first bank connection on it is free. Premium is optional."),
              ("Which budget apps have a free plan?",
               "Of the apps compared here, Forgenta and Rocket Money have a free plan. YNAB and Monarch Money offer "
               "free trials (34 and 7 days on their pricing pages)."),
              ("Does Forgenta work on iPhone and Android?", "Yes, and on the web.")]),
    dict(slug="safe-to-spend", title="Safe to Spend: How Much Can I Spend Before Payday? | Forgenta",
         h1="Safe to spend: how much can I spend before payday?",
         desc="How to work out what is safe to spend before payday: find the lowest point your balance reaches after "
              "every bill, then subtract a cash floor. Worked example.",
         lede="The amount that is safe to spend before payday is the lowest point your checking balance will reach "
              "before then, after every bill, minus a cushion you keep. Not the balance today, and not the balance "
              "after payday.",
         body="<h2>A worked example</h2><table><tr><th>Day</th><th>What happens</th><th>Balance</th></tr>"
              '<tr><td>Today</td><td>Checking balance</td><td class="num">$1,800</td></tr>'
              '<tr><td>Day 3</td><td>Rent of $1,200 paid</td><td class="num">$600</td></tr>'
              '<tr><td>Day 10</td><td>Paycheck of $1,500 lands</td><td class="num">$2,100</td></tr></table>'
              "<p>The lowest point is $600, on day 3. Keep a $200 cushion and the amount that is safe to spend is "
              "$600 &minus; $200 = <strong>$400</strong>.</p>"
              "<h2>Why the end-of-period number misleads</h2><p>After payday the account shows $2,100. Spend from that "
              "figure today and rent fails on day 3. A bill must be covered on the day it is due, even if money "
              "arrives later.</p><h2>How Forgenta does it</h2><p>Forgenta walks every bill and paycheck to find the "
              "low point, counts card swipes that have not posted yet, and checks through the end of the month so a "
              "bill after payday is covered too.</p>",
         faq=[("How do I calculate how much I can spend before payday?",
               "Find the lowest your checking balance will reach before payday after every bill, then subtract a "
               "cushion. In the example, $1,800 less $1,200 rent is a $600 low point; less a $200 cushion, $400 is "
               "safe to spend."),
              ("Why not use my balance after payday?",
               "Because bills due before payday need the money first. An account that ends the period positive can "
               "still go negative on the day rent is due."),
              ("Does it count pending card charges?",
               "Yes. Forgenta subtracts card swipes on checking that your bank has not posted yet.")]),
    dict(slug="vs/ynab", title="Forgenta vs YNAB: Safe to Spend or Zero-Based? | Forgenta",
         h1="Forgenta vs YNAB",
         desc="Forgenta vs YNAB: YNAB gives every dollar a job; Forgenta shows what is safe to spend before payday and plans your debt and car. Prices checked October 2026.",
         lede="YNAB and Forgenta answer different questions. YNAB asks you to give every dollar a job. Forgenta shows "
              "what is safe to spend until payday and plans the months ahead.",
         body=f"<h2>Three things Forgenta does</h2>{PILLARS}{VS_EXTRAS}<h2>Price and approach</h2>{price_table(['Forgenta', 'YNAB'])}"
              "<h2>Choose YNAB if</h2><p>You like assigning every dollar by hand and the zero-based method suits "
              "you.</p><h2>Choose Forgenta if</h2><p>You want one number before payday, a plan for your cards with a "
              "debt-free date, and a plan for your car, with a free plan to start.</p>",
         faq=[("Is Forgenta a YNAB alternative?",
               "Yes, if what you want is a safe-to-spend number and a forecast rather than zero-based budgeting."),
              ("How much is YNAB?",
               "$14.99 a month or $109 a year, with a 34-day free trial, on YNAB's pricing page as of October 7, 2026."),
              ("How much is Forgenta?", "Free plan, or Premium at $9.99 a month or $89.99 a year.")]),
    dict(slug="vs/monarch", title="Forgenta vs Monarch Money: Compare Price and Approach | Forgenta",
         h1="Forgenta vs Monarch Money",
         desc="Forgenta vs Monarch Money: Monarch centres on net worth; Forgenta on what is safe to spend before payday, debt payoff and your car. Prices checked October 2026.",
         lede="Monarch Money is built around a dashboard of your net worth and linked accounts. Forgenta is built "
              "around what is safe to spend before payday and the plan for your debt.",
         body=f"<h2>Three things Forgenta does</h2>{PILLARS}{VS_EXTRAS}<h2>Price and approach</h2>{price_table(['Forgenta', 'Monarch Money'])}"
              "<h2>Choose Monarch Money if</h2><p>Your main goal is one view of net worth across many "
              "accounts.</p><h2>Choose Forgenta if</h2><p>Your main question is what you can spend before payday, "
              "when your debt will be gone and how your next car fits, with a free plan to start.</p>",
         faq=[("Is Forgenta a Monarch Money alternative?",
               "Yes, if you want a safe-to-spend number and a debt payoff plan first."),
              ("How much is Monarch Money?",
               "$14.99 a month or $99.99 a year, with a 7-day free trial, on Monarch's pricing page as of "
               "October 7, 2026."),
              ("Does Forgenta have a free plan?", "Yes. Premium is $9.99 a month or $89.99 a year.")]),
    dict(slug="vs/rocket-money", title="Forgenta vs Rocket Money: Planning or Bill Negotiation? | Forgenta",
         h1="Forgenta vs Rocket Money",
         desc="Forgenta vs Rocket Money: Rocket Money helps with subscriptions and bills; Forgenta shows what is safe to spend before payday and plans your debt and car.",
         lede="Rocket Money is known for tracking subscriptions and negotiating bills. Forgenta is built for "
              "planning: what is safe to spend before payday, the months ahead, and your debt-free date.",
         body=f"<h2>Three things Forgenta does</h2>{PILLARS}{VS_EXTRAS}<h2>Price and approach</h2>{price_table(['Forgenta', 'Rocket Money'])}"
              "<h2>Choose Rocket Money if</h2><p>You mostly want help finding and cancelling "
              "subscriptions, or negotiating bills.</p><h2>Choose Forgenta if</h2><p>You want to know what you can "
              "spend before payday, and to plan your debt payoff and your car.</p>",
         faq=[("Is Forgenta a Rocket Money alternative?",
               "Yes, for planning: safe to spend before payday, a forecast, and a debt payoff plan."),
              ("How much is Rocket Money Premium?",
               "Rocket Money says you choose a price from $7 to $14 a month; it also has a free tier."),
              ("How much is Forgenta?", "Free plan, or Premium at $9.99 a month or $89.99 a year.")]),
]

RELATED = [("best-budget-app", "Best budget app"), ("simple-budget-app", "Simple budget app"),
           ("free-budget-app", "Free budget app"), ("safe-to-spend", "How much can I spend before payday?"),
           ("vs/ynab", "Forgenta vs YNAB"), ("vs/monarch", "Forgenta vs Monarch Money"),
           ("vs/rocket-money", "Forgenta vs Rocket Money")]


def render(p):
    url = f"https://getforgenta.com/{p['slug']}/"
    faq_html = "<h2>Frequently asked questions</h2>" + "".join(
        f"<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>" for q, a in p["faq"])
    related = "".join(f'<li><a href="/{s}/">{html.escape(t)}</a></li>' for s, t in RELATED if s != p["slug"])
    ld = json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]]},
        ensure_ascii=True)
    return f"""<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{html.escape(p['title'])}</title>
<meta name="description" content="{html.escape(p['desc'])}" />
<link rel="canonical" href="{url}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{html.escape(p['h1'])}" />
<meta property="og:description" content="{html.escape(p['desc'])}" />
<meta property="og:url" content="{url}" />
<meta property="og:site_name" content="Forgenta" />
<link rel="icon" type="image/png" href="/forgenta-icon.png" />
<link rel="stylesheet" href="/answers/answers.css" />
</head>
<body>
<header class="wrap">
  <a class="brand" href="https://getforgenta.com/">FORGENTA</a>
  <p class="kicker">Budget app &middot; Safe to spend before payday</p>
</header>
<main class="wrap">
<h1>{html.escape(p['h1'])}</h1>
<p class="lede">{html.escape(p['lede'])}</p>
{p['body']}
{CTA}
{faq_html}
<nav class="related"><h2>Related</h2><ul>{related}<li><a href="/answers/">All answers</a></li></ul></nav>
</main>
<footer class="wrap foot">
  <p>&copy; Forgenta by <a href="https://treforged.com/">TRE Forged LLC</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></p>
  <p class="fine">General information, not financial advice.</p>
</footer>
<script type="application/ld+json">{ld}</script>
</body>
</html>
"""


if __name__ == "__main__":
    for page in PAGES:
        out = ROOT / page["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        text = render(page)
        assert text.isascii(), page["slug"]
        out.write_text(text, encoding="utf-8", newline="\n")
        words = len(re.sub(r"<[^>]+>", " ", text).split())
        print(f"{out.relative_to(ROOT.parent)}  {words} words")
