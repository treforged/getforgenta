# The Payment Letter: setup and issue 1

Campaign 4. Capture with a Google Form, send with Resend. Both free, neither asks for a card.

⚠️ **Nothing here was created for you.** The Resend tools are not available to an unattended session,
and the Google Form needs Tre's own account. Both are drafted below and take about 15 minutes.

## Capture: the Google Form, 10 minutes

1. forms.new, title **The Payment Letter**.
2. Description: *One number, the math behind it, and one thing to do about it. Every Thursday. Car
   money, written for people who actually like cars.*
3. One question: **Email address**, short answer, **Required**, with response validation set to Email.
   Resist adding a name field. Every extra field costs signups, and you are not going to use the name.
4. Settings, Responses, turn off "Collect email addresses" (the question already does it, and the
   automatic version demands a Google login, which will cost you a third of the audience).
5. Send, link icon, shorten, then put that link in the newsletter mentions and the bio.

The response count is itself the free metric for `subscribers_net_new`.

**Why a form and not a signup box in the app.** It exists this afternoon, needs no deploy, no
endpoint and no spam handling, and it is the version you can throw away. Revisit at roughly 200
subscribers, when a real form on the site is worth the work.

## Send: Resend, 5 minutes

1. Audiences, create **Payment Letter**.
2. Paste the form's emails in. Weekly, by hand, until it is tedious enough to automate.
3. Broadcasts, new broadcast, plain text. From `contact@treforged.com`, and the domain is already
   verified there.
4. **Send yourself a test first, and read it on a phone.** This audience opens email on a phone or
   not at all.

Unsubscribe is not optional and Resend handles it. Do not remove the footer.

## Issue 1, ready to send

> **Subject:** The $192 that costs $2,894
>
> **Preview:** Same car, same rate, two very different outcomes.
>
> ---
>
> Somebody asked this week whether a 72-month loan is a bad idea, and the honest answer is that it is
> not evil, it is just expensive in a place nobody looks.
>
> **The number.** On $28,000 at 9%, going from a 48-month loan to a 72-month one drops the payment
> from $696.78 to $504.72. That is $192 a month back in your pocket, and it costs $2,894 in extra
> interest.
>
> **The math nobody shows you.** Two years in, the 48-month buyer owes $15,252 and the 72-month buyer
> owes $20,282. If that car is worth around $20,000 by then, which is an ordinary outcome, one of you
> has five grand of equity and the other has none. Same car, same day, same driver.
>
> That is what being underwater actually means, and it has nothing to do with interest. You cannot
> sell it without writing a check for the difference. You cannot trade it without rolling negative
> equity into the next loan. If it gets totaled, insurance pays what the car is worth, not what you
> owe.
>
> **This week, ten minutes.** Open a loan calculator and put in your real rate and your real balance.
> Find out what you owe today versus what the car is worth today. If you do not like the gap, the fix
> is not refinancing, it is paying the long loan at the short loan's payment. Nothing stops you doing
> that, and nobody will suggest it to you.
>
> The whole thing written out, with the tables:
> https://getforgenta.com/answers/is-a-72-month-car-loan-bad.html?utm_source=email&utm_medium=newsletter&utm_campaign=payment-letter
>
> See you Thursday.
> Tre

## The shape, every week

One number. The math, written out. One thing to do that takes under ten minutes. One link. No
banner, no images, no second call to action. Five minutes to read.

## What gets recorded on Sunday

```
node scripts/marketing-report.mjs --add "2026-08-10,payment-letter,subscribers_net_new,0,Google Form responses"
node scripts/marketing-report.mjs --add "2026-08-10,payment-letter,open_rate_pct,0,Resend broadcast"
```

Both targets (+10 net new per week, 40% opens) are due at week 4, so week 1 prints as 🟡 tracking
rather than a failure. ⚠️ Open rate is inflated by image proxies and privacy relays, so treat 40% as
a directional floor and watch clicks next to it. Record what Resend says, not what you wish it said.
