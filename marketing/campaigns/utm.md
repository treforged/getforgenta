# UTM conventions and the exact links

Written 2026-08-12. Referenced by `measurement.md` §3.

A tagged link is the only free way to tell GA4 which campaign sent somebody. Untagged traffic from
these channels lands in one undifferentiated `referral` bucket, and a channel you cannot separate is
a channel you cannot kill.

## The three parameters

| Parameter | Value | Why |
|---|---|---|
| `utm_source` | the platform: `reddit`, `youtube`, `tiktok`, `instagram`, `facebook`, `email` | Where the person was standing |
| `utm_medium` | the format: `social`, `video`, `newsletter`, `profile` | Groups formats across platforms |
| `utm_campaign` | **the campaign id, verbatim**: `pit-crew`, `project-ledger`, `teardown`, `payment-letter`, `answer-engine`, `carousel` | Same string as the counts CSV, so GA4 and `marketing-report.mjs` name the same thing |

Lowercase, hyphens, never spaces. GA4 treats `Teardown` and `teardown` as two campaigns and will
happily split one campaign's numbers across both without telling you.

## The two rules that matter more than the conventions

1. **Never put a UTM on a getforgenta.com link that lives on getforgenta.com.** A self-referral
   starts a fresh session and destroys the original attribution, so an answer page linking to another
   answer page would launder a Reddit visit into a "direct" one. Internal links stay clean.
2. **Campaign 1 (Pit Crew) carries no links at all**, by design and because of a ban already paid
   for. Its attribution is the profile click, which shows in GA4 as a plain `reddit.com` referral. Do
   not "fix" this by adding a link to a comment.

## The links, ready to paste

Video descriptions (YouTube Shorts):

```
https://getforgenta.com/?utm_source=youtube&utm_medium=video&utm_campaign=teardown
```

TikTok and Instagram bio link (one link, swap the source to match the platform you are editing):

```
https://getforgenta.com/?utm_source=tiktok&utm_medium=video&utm_campaign=teardown
https://getforgenta.com/?utm_source=instagram&utm_medium=social&utm_campaign=carousel
```

Reddit profile bio (campaign 1's only link, and it is on the profile, not in a comment):

```
https://getforgenta.com/?utm_source=reddit&utm_medium=profile&utm_campaign=pit-crew
```

Newsletter, one link per issue, pointing at that week's answer page:

```
https://getforgenta.com/answers/is-a-72-month-car-loan-bad.html?utm_source=email&utm_medium=newsletter&utm_campaign=payment-letter
```

Build thread footer, when a link is appropriate at all (forum only, never the advice comments):

```
https://getforgenta.com/?utm_source=reddit&utm_medium=social&utm_campaign=project-ledger
```

## App store links

The web UTMs above stop at the website. Installs need each store's own scheme, and both are free.

**Google Play** reads a `referrer` parameter and surfaces it in Play Console. The value is a single
URL-encoded UTM string:

```
https://play.google.com/store/apps/details?id=com.treforged.getforgenta&referrer=utm_source%3Dyoutube%26utm_medium%3Dvideo%26utm_campaign%3Dteardown
```

Read it at Play Console, Acquisition reports, filter by Traffic source.

**App Store** ignores UTMs entirely. It uses a campaign token appended to the product URL:

```
https://apps.apple.com/us/app/forgenta-track-build-wealth/id6762540239?ct=teardown&pt=<provider-token>
```

Read it at App Store Connect, Analytics, Acquisition, Campaigns. The provider token is in App Store
Connect and is the same for every campaign. If it is not to hand, ship the link without `pt` rather
than delaying the post: `ct` alone still groups in Campaigns.

## Checking a tag actually worked

GA4, Reports, Acquisition, Traffic acquisition, then switch the dimension to **Session campaign**.
A campaign that never appears there was either never clicked or was tagged wrong, and those two are
worth telling apart before you conclude a channel is dead. Remember the consent gate: everything in
GA4 is a floor, not a count.
