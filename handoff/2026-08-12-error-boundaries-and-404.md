# Error boundaries + a real 404 page — 2026-08-12

Branch `autopilot/getforgenta-0811-173709`. Unattended session, committed locally, not pushed.

## The ask

An error in one card could white-screen the whole app, and a bad URL got the framework
default, which reads as "the app is broken" rather than "you typed the wrong address".
Wrap at the route level and around the heavy widgets, with a fallback that says **what**
failed and offers a way back.

## What was already there, and what actually wasn't

Route-level boundaries existed for the eleven dashboard-layout routes, and `NotFound`
existed. The real gaps:

1. **Ten routes had no boundary at all** — `/`, `/auth`, `/auth-callback`, `/onboarding`,
   `/oauth`, `/akoya-oauth`, `/builds/share/:token`, the four Legal routes and the three
   Premium routes. A crash on any of them white-screened.
2. **The fallback named nothing** ("Something went wrong loading this page") and offered
   **no way back** — only a retry, on the page that had just failed.
3. **No widget-level boundaries anywhere.** Any widget crash took its whole page.
4. **`NotFound` was unbranded** — bare `bg-muted`, and an `<a href="/">` that forces a
   full page reload, sending a signed-in user to the marketing homepage.

## What changed

**`ErrorBoundary.tsx`** — three new optional props, all backward compatible:
- `label` — what the user calls the thing inside. The fallback reads "Forecast couldn’t
  load." instead of an anonymous apology, and `componentDidCatch` now logs the label too,
  so the console line names the surface before anyone opens a stack trace.
- `variant='widget'` — a compact fallback shaped like the card it replaces, carrying the
  promise "The rest of this page still works." It offers no navigation, because the page
  around it is intact and *is* the way back.
- `homeTo` — where the way-out button goes; `null` hides it.

Also new: a short technical detail line under the friendly sentence. It is what a support
conversation actually needs, and hiding it entirely helps nobody.

**Decision — `homeTo={null}` on the routes that ARE the destination.** `/`, `/dashboard`
and the layout boundary show retry only. A "Back to dashboard" button clicked from
`/dashboard` navigates to the page you are already stuck on and appears to do nothing —
a dead button is worse than no button. Public routes (`/auth`, Legal, the share page)
pass `homeTo="/"`: a signed-out visitor sent to `/dashboard` just bounces to `/auth`,
which is not a way back either.

**`NotFound.tsx`** — rebuilt: logo, the attempted path shown verbatim, a `<Link>` (client
nav, no reload) to `/dashboard` when signed in or in demo and to `/` when not, plus a
"Go back". It says the account and data are fine, because the whole point is that this
should not read as breakage.

**Widget boundaries** on the eleven dashboard widgets (label pulled from the existing
`WIDGET_META` via a new `widgetLabel`, so there is one source for a widget's name) and on
the four heavy off-dashboard widgets: `CreditCardEngine`, `BankActivity`, the Forecast net
worth chart, `MaintenanceLog`.

### 🔬 The subtle bug found while building this, and the reason for `<Widget>`

`renderWidget(id)` is a **function call**, not a component. Wrapping the call site —
`<ErrorBoundary>{renderWidget(id)}</ErrorBoundary>` — runs the widget's data-mapping
during **Dashboard's own render**, so anything the widget's body throws propagates past
its boundary to the page boundary. The boundary would have looked correct and caught
roughly half of what it appeared to cover. Fixed with a one-line `Widget` component that
calls `render(id)` inside its own render, i.e. inside the boundary's subtree. The
evidence below exercises exactly this path — the throw is inside `renderWidget`, and it
was caught by the widget boundary.

## Evidence — `handoff/evidence/2026-08-12-error-boundaries/`, all at 390×844

Real crashes deliberately thrown into the running app (Vite dev, demo mode — no personal
data), screenshotted, then removed. `grep TEMP-EVIDENCE src/` is clean.

| Shot | What it shows |
|---|---|
| `widget-error-phone.png` | `throw` inside `renderWidget('wealth_overview')` → **"Wealth Overview couldn’t load"** in a card, healthy Financial Health cards still rendered above it |
| `widget-error-phone-full.png` | the same, full page — the dead card in its place in the stack |
| `route-error-phone.png` | `throw` at the top of `DebtPayoff` → **"Debt Payoff couldn’t load."**, detail line, **Try again + Back to dashboard**, header and bottom nav still rendered, URL still `/debt` |
| `404-phone.png` | `/settings/billing-history` → branded 404, the path shown, **Go to homepage** (signed out) + Go back |

**Isolation was measured, not asserted:** during the widget crash, **23 sibling
`.card-forged` widgets were still rendered** and the body still held 4,133 characters of
text — the page did not white-screen. Console showed the boundary's own line,
`Page render error: Wealth Overview …`.

**After removing both deliberate crashes**, a smoke pass over demo Dashboard, Debt,
Forecast and Activity: **0 fallbacks visible, 26/7/5/7 cards rendered, 0 console errors.**

Gates: **tsc 0**, eslint clean on all 11 touched files, **`npm run build` green (894ms)**,
full suite **892/892** across 115 files — 883 before + 9 new (4 boundary, 5 NotFound), which
reconciles exactly.

## Not done, deliberately

- **The cookie banner overlaps the bottom of every page on a phone**, including the 404's
  second button — visible in the first capture. That is pre-existing app-wide chrome, not
  something this change introduced, and fixing it is an app-wide layout question. The
  committed shots have the banner accepted so the pages themselves are legible. Worth its
  own slice.
- **No boundary around individual modals or the layout nav internals.** The layout
  boundary already covers the shell; going finer was not asked for.
- The capture scripts live in `backups/2026-08-12_errorboundary/` (gitignored, so not
  committed) — `shots.mjs`, `shots2.mjs`, `shots3.mjs`, `verify.mjs`, plus the originals
  of every file touched.
