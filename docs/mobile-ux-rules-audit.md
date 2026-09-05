# The mobile UX rules, audited against this app

Tre sent `https://www.instagram.com/reel/DcmoHfNJDWO/` (@agenticmatt, "UX rules 6–15") and
said **"this is a good concept."** This is what it actually says and where Forgenta stands
against each line — measured in the code, not guessed.

## How this was handled, because the source is untrusted

The caption was read with `yt-dlp --skip-download --dump-json`: **metadata only, nothing
downloaded, nothing installed, nothing executed.** The text is a list of UX principles and
contains no instructions aimed at an assistant, but it is third-party content either way and
is treated as DATA. Nothing here was adopted because the reel said so; each line was checked
against the code and judged on its merits.

## The scorecard

| # | Rule | Forgenta | Evidence |
| --- | --- | --- | --- |
| 6 | An X closes a modal or flow; a left arrow goes back one screen | ✅ | `FormModal` closes with `X`; the wizard's Back is `ChevronLeft` |
| 7 | Never show a blank screen while loading — skeleton, spinner or progress | ✅ | `PageSkeleton`, `TransactionsSkeleton`; loaders throughout |
| 8 | Preserve exact scroll position when returning to a feed | ❌ **NOT BUILT** | no `ScrollRestoration`, no saved offset anywhere |
| 9 | Tapping the selected bottom tab returns to the top of that tab | ✅ **BUILT TODAY** | `MobileNav.scrollMainToTop`, `MobileNav.tabToTop.test.tsx` |
| 10 | Load the next batch before the user reaches the bottom | ➖ **N/A today** | no infinite feed — the ledger renders a bounded month |
| 11 | Likes/follows/saves update immediately, then sync | ➖ **mostly N/A** | no social actions; money writes SHOULD wait for the server (see below) |
| 12 | Save drafts and unfinished input automatically | ✅ | `useFormDraft`, used by 8 surfaces |
| 13 | Ask for notifications/photos/camera/location only at the moment of use | ❌ **VIOLATED** | see below — this is the real finding |
| 14 | Quick actions open in a bottom sheet, swiping down dismisses | ⚠️ **PARTIAL** | sheets exist; swipe-down-to-dismiss is not wired |
| 15 | Notifications and shared links open the exact content | ✅ | `DeepLinkHandler` in `App.tsx` |

## Rule 13 is the one worth acting on

`registerForPush()` runs from `AuthContext` **on sign-in**, so the operating system's
notification prompt appears seconds after somebody first gets into the app — before they have
seen a single notification-worthy thing, and before they have any reason to say yes.

The code beside it already reasons about this and reaches the wrong stop:

> *"It also has to happen AFTER sign-in — a token with no user is a row we cannot address and a
> permission prompt the person has been given no reason for."*

That is right about the token and stops one step short about the prompt. After sign-in is
better than before it. **At the moment the user asks for a reminder is better than either.**

This matters more than politeness: on iOS the notification prompt is a **one-shot resource**,
exactly like the review prompt (`src/lib/review-moment.ts` already documents that reasoning at
length for reviews). A declined prompt cannot be re-presented by the app — the user has to go
to Settings and find it. So asking at the cheapest possible moment spends the single chance to
ever have this user's attention on a screen they had no reason to say yes on.

**Proposed, not built:** move `registerForPush` behind the first notification-shaped intent —
turning on a reminder, opting into a streak nudge — and keep the sign-in call only for a device
that has ALREADY granted permission, where `checkPermissions` returns granted and no prompt is
shown. `push-registration.ts` already calls `checkPermissions` first for a related reason, so
the mechanism exists.

## Rules 8 and 14 are real but smaller

**Rule 8** is worth doing for the Transactions ledger specifically, which is the only long list
in the app: open a row, come back, and the position is lost. It needs the `#scroll-main` offset
saved per route.

**Rule 14** — the sheets do not dismiss on swipe-down. Worth noting that they *do* dismiss on
backdrop tap and on `X`, so nothing is trapped; this is polish, not a dead end.

## Rule 11 does not apply here, and adopting it would be a mistake

"Update immediately, then sync in the background" is right for a like. **It is wrong for
money.** An optimistic balance that later fails to write shows somebody a number that is not
true about their finances — which is the single thing this app must never do. The existing
behaviour, where a money write waits for the server and reports failure, is correct and should
stay. Recorded here because a future reader working down this list would otherwise "fix" it.
