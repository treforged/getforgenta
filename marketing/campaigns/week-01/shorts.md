# Week 1 shorts: three shot lists

Campaign 3. One vertical file each, posted to YouTube Shorts, TikTok and Instagram Reels. Record all
three in one sitting, post one on Tuesday, one on Thursday, one on Saturday.

## Rules that apply to all three

- **Record in demo mode. Never in a signed-in session.** A signed-in recording puts real balances on
  TikTok permanently, and there is no taking it back. Demo is entered by clicking **Try Demo** on
  `/auth`. There is no route and no flag for it, so once you are in, move around by clicking the
  app's own links: a typed URL drops you back to `/auth` and out of demo.
- 25 to 45 seconds. Vertical, 1080x1920.
- **On-screen text at all times.** Most of this audience watches muted.
- The hook lands in the first 1.5 seconds and the number is on screen by second 5.
- No outro, no "link in bio" spoken, no logo card. The last frame is the last useful frame.
- Tagged link goes in the description or the bio, per `../utm.md`, never in the spoken script.
- Every figure shown is the same figure as the answer page it comes from. Three surfaces disagreeing
  about the same number is the fastest way to look like you made it up.

## Short 1: the 72-month trap

Source: `/answers/is-a-72-month-car-loan-bad.html`. Post Tuesday.

| Time | On screen | Voice / text |
|---|---|---|
| 0.0 to 1.5s | Big text: **$192 a month cheaper** | "Stretching your car loan to 72 months saves you a hundred ninety two a month." |
| 1.5 to 5s | Text flips to: **$2,894 more expensive** | "It costs you twenty eight ninety four." |
| 5 to 15s | Screen recording: the term slider going 48 to 72, the payment and total interest moving together | "Same car, same rate, twenty eight thousand at nine percent." |
| 15 to 30s | The two-year balance table: $15,252 versus $20,282 | "Here is the part nobody shows you. Two years in, the short loan has about five grand of equity. The long one has none. You cannot sell it, you cannot trade it, you are stuck with it." |
| 30 to 38s | Back to the payoff view | "If you take the long term anyway, pay it like the short one. Nothing stops you." |

## Short 2: the $2,400 cart that is really $4,078

Source: `/answers/what-a-car-build-really-costs.html`. Post Thursday.

| Time | On screen | Voice / text |
|---|---|---|
| 0.0 to 1.5s | Big text: **Your $2,400 build is $4,078** | "Your cart says twenty four hundred." |
| 1.5 to 5s | **$4,078** lands | "It is four thousand and seventy eight." |
| 5 to 22s | Build page, adding lines one at a time: tax $168, freight $120, hardware $95, fluids $130, labor $780, the seized bolt $210, dyno $175 | "Tax. Freight. Gaskets and hardware. Fluids and plugs. Six hours of labor. The bolt that snapped. Dyno time." |
| 22 to 32s | The build total against the budget bar | "Parts were fifty nine percent of it. That ratio holds whether your build is eight hundred dollars or eighteen thousand." |
| 32 to 40s | The running total | "Price the whole list before you commit, not after." |

## Short 3: the number to shop by

Source: `/answers/how-much-should-i-spend-on-a-car.html`. Post Saturday.

| Time | On screen | Voice / text |
|---|---|---|
| 0.0 to 1.5s | Big text: **The payment is the wrong number** | "You are shopping by the wrong number." |
| 1.5 to 6s | Take-home $2,800, then **10% = $280 for everything** | "Take-home twenty eight hundred. Ten percent is two eighty a month, and that is everything." |
| 6 to 20s | The cost lines stacking: insurance $180, then fuel, then a maintenance set-aside | "Insurance quotes at one eighty. Fuel. Money set aside for tires and brakes. The loan payment you can actually carry is close to zero." |
| 20 to 32s | Back to the total | "This is why people your age end up with a car that owns them. It is not the sticker price, it is insurance." |
| 32 to 40s | Plain text card | "Get three insurance quotes before you shop, on the exact cars. The spread between a sedan and a coupe worth the same money can be over a hundred a month." |

## What gets recorded on Sunday

`teardown/shorts_posted` (the number you shipped, not the number you filmed), and from week 2
onwards `teardown/median_views`. Median across the week's videos, not the total, so one lucky video
cannot hide the other two.

```
node marketing/scripts/marketing-report.mjs --add "2026-08-10,teardown,shorts_posted,3,upload log"
```
