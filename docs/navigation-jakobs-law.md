# Navigation, measured against the apps people already use

Written 2026-09-06 at Tre's request. **This is a plan, not a build.** One slice has shipped
(the hamburger moved to the top right, `7dce33b5`) and item 1 has now shipped too; the rest below
is unbuilt and ranked.

## The argument, in one paragraph

**Jakob's Law: people spend the vast majority of their time on OTHER apps, so they arrive at
Forgenta already carrying a model of where things live.** Every place we differ from that model,
they pay for it — not with confusion they report, but with a half-second of hesitation they never
mention and we never see. That is what makes this worth doing deliberately: **the cost is real and
invisible**, so it will never arrive as a bug report and cannot be prioritised by waiting for one.

Tre's own reference is Instagram: `+` top LEFT, identity CENTRE, hamburger far TOP RIGHT, and a
floating pill tab bar at the bottom.

⚠️ **The law is a reason to match a convention, not a reason to copy an app.** Where Forgenta is
genuinely a different kind of thing — a finance app has no feed and no compose button — matching
Instagram would be cargo-culting. Each row below says which it is.

## Two constraints on everything in this document

1. **Do not take information away to make it tidier.** Moving something behind a menu is fine.
   The page that had the answer must still have it. (This repo has already shipped a control that
   made a promise it broke, twice; a tidier screen that answers fewer questions is the same
   failure wearing better clothes.)
2. **Every item names its acceptance evidence, and "looks better" is not evidence.** A rendered
   frame at a stated viewport, a tap target in px, or a count.

---

## Where we are, and what it costs

| Part of the chrome | Forgenta **today** (measured) | What the model says | Cost of differing |
|---|---|---|---|
| Top bar, LEFT | Empty since `7dce33b5` | A primary action (`+`) or back | **Low.** An empty corner costs nothing; it is space, not a wrong answer |
| Top bar, CENTRE | Brand lockup, absolutely centred, links home | Identity — the account or the place you are | **Medium.** Ours identifies the APP; theirs identifies the PLACE. A person who wants to know where they are must read the tab bar instead |
| Top bar, RIGHT | ✅ Hamburger, 44×44, 9px from the edge | Menu / overflow | **Was high, now none.** Shipped |
| Bottom bar | 5 fixed destinations, `fixed inset-x-0 bottom-0`, full width, `border-t` | 4–5 destinations, increasingly a floating pill inset from the edges | **Low-medium, and cosmetic.** The COUNT and the fixedness already match; only the shape differs |
| Identity / profile | **Nowhere.** No avatar, no account surface in the chrome | Top-right avatar, or the last tab | **Medium.** "Which account am I in?" has no answer without opening the menu — and partner-view makes that a real question |
| Settings | Inside the drawer, behind the hamburger | Behind the same menu, or under profile | **Low.** This already matches |
| Back | Browser/OS back only. No in-app affordance | OS back on Android; a top-left chevron on iOS for pushed screens | **Medium on iOS.** Nothing in the chrome offers back, so a person deep in a flow relies on a gesture we never mention |

---

## Ranked by how often a person meets it

Ranked by **encounters per session**, not by how wrong each one is. A wrong home for settings
costs once a month; a wrong bottom bar costs every session.

### 1. ✅ SHIPPED — identity now has a home in the vacated top-left
`src/components/layout/IdentityBadge.tsx` + `src/lib/identity-badge.ts`, wired into
`MobileTopBar.tsx`. **Measured at 390px in a same-origin iframe on Tre's real signed-in account:**
label `"TRE"`, initials `T`, accessible name `"Signed in as TRE"`, **70×44px at left=9**; the
hamburger still **44×44 at 13px from the right edge**; **no overlap**, and page horizontal
scroll **0**.
- ⚠️ **THE PARTNER-VIEW FRAME WAS NOT OBTAINED, and that half of the acceptance is UNMET.**
  Tre's account has no partner linked — the drawer offers no switch — so partner view is not
  reachable on real data from this desk. The partner branches are covered by unit tests instead,
  including the load-bearing one (an unnamed partner must still read as NOT-YOU), which was
  **mutation-verified**: making it fall through to the signed-in user's own identity turns that
  test red. A unit test is not a rendered frame; do not record this as visually verified.
- ⚠️ Constraint 1 held: **the partner-view banner stays.** A 44px badge in a corner does not
  show the fact more prominently than a banner does, so it does not earn the banner's removal.
- **One job, deliberately:** the badge always goes to Settings. Making it switch back out of
  partner view would give one control two behaviours depending on the state it is itself
  reporting, and the banner already offers that switch.
- **It never invents a name.** An email is used for the INITIAL only, never the label — a guessed
  identity on a finance screen is the most expensive thing this chrome can say.

### 2. The bottom bar's shape — *every session, seen constantly*
Five destinations is already right and the labels are already there. Only the **shape** differs: a
full-width bar with a top border, versus the floating inset pill people now expect.
- **Do:** float and inset it, keeping all five destinations and their labels.
- **Acceptance:** a 390px frame; five destinations still present; each tap target ≥44px; and
  ⚠️ **content must not scroll under it invisibly** — the layout already reserves
  `pb-[calc(5.5rem+env(safe-area-inset-bottom))]`, so that padding must be re-measured, not assumed.
- **Honest note:** this is the most visible item and the least broken one. It is polish.

### 3. ✅ SHIPPED — back on pushed screens
`src/components/layout/BackButton.tsx`, `src/lib/nav-back.ts`, `src/lib/nav-routes.ts`.
**Pressed in a browser at 390px, not merely rendered:** `/dashboard` corner = IDENTITY (idx 0) →
drawer → Settings gives `/settings` corner = **BACK**, control **44×44 at left=9** (idx 1) →
**pressing it returns to `/dashboard`** and the corner reverts to IDENTITY (idx 0).
- **It REPLACES the identity badge rather than sitting beside it, and that is MEASURED.** At 390px
  the centred wordmark starts at **x=110** and the badge ends at **x=90** — a **19px** gap. A 44px
  control does not fit there, so stacking was impossible rather than merely inelegant. Nothing is
  lost: the pushed screens are Settings, the AI advisor and Premium, and Settings is itself where
  the account lives.
- **An unknown route counts as pushed**, so a new screen gets its way out for free. The opposite
  default ships a screen with no exit, which is the bug being fixed.
- ⚠️ **THE FRESH-ENTRY CASE IS NOT BROWSER-VERIFIED.** `history.back()` on a deep link — a push
  notification, a pasted URL, the native WebView's first navigation — leaves the APP. `nav-back.ts`
  reads react-router's own `idx` (never `history.length`, which counts pages from before this app
  loaded) and falls back to `/dashboard`. Loading `/settings` directly while signed out redirects
  to `/auth`, so that path could not be reached from this desk; it is covered by mutation-verified
  unit tests only. **A unit test is not a rendered frame.**
- ⚠️ Rule 8 (`0982aa18`) held: back is `navigate(-1)`, which produces a POP, which is what the
  scroll restoration listens for. A reconstructed path would PUSH and land at the top of a page the
  person had scrolled down.

### 4. Top-bar centre says the APP, not the PLACE — *every session, low cost each time*
The brand tells you which app you are in, which you already knew. The convention is that the
centre tells you where you ARE.
- **Do:** consider a contextual title on non-home routes, keeping the brand on home.
- **Acceptance:** frames of three routes showing three different titles.
- **Honest note:** the bottom bar already answers this, which is why it ranks below the others
  despite being met every session. **It may be right to do nothing here** — that is a legitimate
  outcome of a plan.

### 5. The empty top-left — *not a gap*
Instagram puts `+` there because creating a post is its primary action. **Forgenta has no
equivalent single action**, and inventing one to fill a corner would be copying the app rather
than the convention. Item 3 wants that space anyway.

---

## What is deliberately NOT here

- **A redesign of any screen's content.** This is the chrome only.
- **Anything about the dashboard's widget stack.** That is customisable per user and a different
  argument.
- **A colour or type pass.** Unrelated to where things live.

## Evidence standard for the whole document

Every "today" figure above was **read from the code or measured in a browser** on 2026-09-06:
the five destinations from `MobileNav.tsx:29-33`, the bar's positioning from its own className,
the trigger's 44×44 and 9px offset from a 390px same-origin iframe. ⚠️ **Nothing here was
remembered.** Where a figure is not measured, the row says so.
