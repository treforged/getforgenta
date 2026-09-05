# UX rules audit — reel rules 6-15, against this codebase

Source: ten UX checklist rules transcribed from an Instagram reel caption (a
stranger's opinion about consumer-app UX), handed to this desk as "a good
concept" to evaluate. Each rule below is judged on its own merits for a
budgeting app, not adopted because it appeared on a list. Every verdict below
is backed by `file:line`; anywhere the app's actual behavior could not be
established by reading the code, that is stated plainly instead of guessed.

**Not verified in this pass:** none of this was exercised on a running device
or simulator. Everything below is a static read of the source, the routes, the
Capacitor config and the two platform link manifests
(`apple-app-site-association`, `assetlinks.json` + `AndroidManifest.xml`). A
live check (`dev-signin` + a real phone or simulator) would be needed to catch
anything that only shows up at runtime — e.g. actual dropped frames, a gesture
that doesn't register, or a permission dialog that fires at the wrong instant
on a real OS. Where that distinction matters it is called out per rule.

---

## Rule 6 — X closes a modal/flow; a left arrow goes back one screen

**Verdict: ALREADY DONE.**

Every overlay in the app is `X` = close the whole overlay, consistently:
- `src/components/shared/FormModal.tsx:65` — `<button onClick={onClose}><X size={16} /></button>`
- `src/components/shared/CalcDrawer.tsx:76-77` — same pattern
- `src/components/vehicles/LumpSumPanel.tsx:65-66` — same pattern
- `src/components/shared/DeckShell.tsx:70-73` — the bank-review deck's own "way out" closes the entire run, not one card
- Also consistent in `AppLockSetupModal.tsx:126`, `BuildFormModal.tsx:88-89`, `MaintenanceFormModal.tsx:268-269`, `ForecastAssumptionsPanel.tsx:63`, `DashboardCustomizer.tsx:59`, `FounderNoteModal.tsx:44`, `InstructionsModal.tsx:64` — 10+ independent call sites, all wired to `onClose`, none of them to "step back one screen."

Where a flow genuinely has steps, a distinct `ChevronLeft` "Back" control moves
one screen back, and it is a *different* control from the close:
- `src/pages/Onboarding.tsx:203-204` (`back()`), `:670-678` (`{step === 'welcome' ? 'Skip setup →' : <><ChevronLeft size={14} /> Back</>}`)
- `src/components/shared/AppTour.tsx:94` (`X` closes the tour), `:123` (`ChevronLeft` steps back one card)

One gap worth naming without it changing the verdict: `AppLockSetupModal.tsx`
is itself a multi-step flow (`intro` → `pin-entry` → `pin-confirm` → `done`,
line 55) and has no `ChevronLeft` at all — only the top `X` (line 126), which
closes the whole setup rather than stepping back one step. That is a missing
*capability* in one flow, not an instance of X and back-arrow meaning the same
thing or the wrong thing — the rule as stated (X vs. arrow have distinct,
consistent meanings) holds everywhere both controls are present.

---

## Rule 7 — never a blank screen while loading; use a skeleton/spinner/progress bar

**Verdict: BROKEN — consistent at the page level, inconsistent inside pages.**

Every top-level route has a dedicated skeleton and none of them render blank:
- `src/pages/Transactions.tsx:720` → `TransactionsSkeleton`
- `src/pages/DebtPayoff.tsx:339` → `DebtSkeleton`
- `src/pages/Forecast.tsx:306` → `ForecastSkeleton`
- `src/pages/SavingsGoals.tsx:777` → `GoalsSkeleton`
- `src/pages/BudgetControl.tsx:953` → `BudgetSkeleton`
- `src/pages/Dashboard.tsx:18,1310,1469-1473` → `MetricSkeleton` / `ChartSkeleton` / `ScheduleSkeleton`, per-section
- `src/App.tsx:125-139` (`PageLoader`) is the route-transition fallback and additionally distinguishes "still loading" from "offline" from "taking unusually long" (`SLOW_ROUTE_MS`, line 123) rather than spinning forever

But three *sub-components mounted inside those already-loaded pages* return
`null` while their own data is in flight, which is exactly the blank-screen
pattern the rule forbids, just at a smaller scale:
- `src/components/settings/MerchantRulesSettings.tsx:97` — `if (isLoading) return null;` — the entire "Merchant memory" card in Settings renders nothing until its query resolves, no skeleton.
- `src/components/savings/SurplusRankingSection.tsx:354` — `if (loading) return null;`, with a comment at `:351-353` stating this is deliberate ("Only the load is hidden... this section used to stay dark below two rows"). Deliberate or not, it is still a blank patch of the Goals page for the duration of the load.
- `src/components/dashboard/SocialFollowRow.tsx:25` — `if (loading) return null;`, lower severity since it's one small row inside an already-rendered card.

**Proposal:** small — 2-3 files. Give each of these three components the same
one-line-skeleton treatment the page shells already use (a `Skeleton` from
`src/components/ui/skeleton.tsx`, already imported elsewhere e.g.
`src/pages/Vehicles.tsx:5`) instead of `return null`. No new pattern to invent;
just apply the one that already exists everywhere else.

---

## Rule 8 — preserve exact scroll position when a user leaves a feed and returns

**Verdict: NOT APPLICABLE**, with one real equivalent that already works.

This is not a social feed app — there is no infinitely-scrolling content list
you navigate away from and back into. The closest analog, opening a
transaction to edit it and returning to the list, is implemented as an
in-place modal rather than a route change:
- `src/pages/Transactions.tsx:19,1219` — `FormModal` is opened over the transactions list; the page component underneath never unmounts, so its scroll position is never touched by React and needs no explicit preservation code.

The one place scroll IS forced is on an actual route/pathname change, which is
correct behavior for moving to a different screen, not "leaving and returning
to the same feed":
- `src/App.tsx:246-254` (`ScrollToTop`) — resets to top on every `pathname` change (used by `BrowserRouter`).

Stretching rule 8 onto tab-switching or route navigation would be wrong per
the brief's own caution; there is no genuine feed here for the rule to
protect, and the one place an equivalent exists (transaction detail open/close)
already preserves position by construction.

---

## Rule 9 — tapping the already-selected bottom tab returns to the top of that tab

**Verdict: MISSING.**

`src/components/layout/MobileNav.tsx:36-93` is the whole bottom bar. It reads
`pathname` only to decide which icon is styled "active" (`:59`, `const active
= pathname === item.to`) and renders a plain `<Link to={item.to}>` (`:61-63`)
for every entry. There is no `onClick` handler at all, so tapping the tab you
are already on does nothing — React Router does not fire a navigation to the
same path, `ScrollToTop` (`src/App.tsx:246-254`) is keyed on `pathname` and
does not re-run, and none of Dashboard/Transactions/Vehicles' *internal*
sub-tabs (the "Accounts", "Plan", "Goals" panels folded into these routes per
the comment at `MobileNav.tsx:25-27`) get reset either.

Concretely: scroll deep into Transactions, switch its internal tab to
"Accounts," tap the Transactions bottom-tab icon again — nothing happens. The
rule's behavior is absent, not broken.

**Proposal:** one file, small. Add an `onClick` to the `Link` at
`MobileNav.tsx:61` that, when `active` is already true, calls
`window.scrollTo` (or the page's own scroll container, per the same
`env(safe-area)`/`scroll-main` pattern used elsewhere, e.g. `App.tsx:250`) and
resets that page's own sub-tab state to its default. The second half needs a
shared reset hook or a lifted callback, since sub-tab state lives inside each
page (Dashboard/Transactions/Vehicles), not in `MobileNav` itself — so call it
"a few files" once the sub-tab reset is included, "one file" if only the
scroll-to-top half is done first.

---

## Rule 10 — feeds should load the next batch before the user reaches the bottom

**Verdict: NOT APPLICABLE**, with a real equivalent that is currently unbounded rather than paginated.

There is no infinite-scroll feed. The transactions list — the one place the
rule's intent (pagination for a growing list) could map onto real behavior —
fetches the user's **entire** transaction history in one query, with no
`.limit()` / `.range()`:
- `src/hooks/useSupabaseData.ts:1042-1056` (`useTransactions`) — `supabase.from('transactions').select('*').eq('user_id', ...).order('date', { ascending: false })`, no bound.
- `src/pages/Transactions.tsx:1101` — `filtered.map(t => {...})`, no virtualization (no `react-window`/`react-virtual` in `package.json`).

The default view is small in practice — `filterMonth` defaults to the current
month (`Transactions.tsx:100`), so most users see one month's worth by
default — but selecting "All" (`filterMonth === 'all'`, `:315`) renders every
transaction the account has ever had, unpaginated, in one unvirtualized map.

This is not what rule 10 describes (there is no scroll-triggered fetch to be
"too late"; all the data is already in memory), so **NOT APPLICABLE** is the
honest verdict for the rule as written. The unbounded query is a separate,
real scale risk worth flagging on its own terms — it was not measured against
a real large account in this pass, so whether it is currently a problem is
**UNVERIFIED**; it would need a test account with several years of
transactions and a timed render to say more.

---

## Rule 11 — likes/follows/saves update immediately, then sync in the background

**Verdict: mixed — ALREADY DONE for one real equivalent, and deliberately REJECTED for money-affecting writes, for a stated reason.**

There are no likes/follows here, but the brief is right that "optimistic
update, then sync" has a real equivalent: reordering priorities in the surplus
ranking list.
- `src/components/savings/SurplusRankingSection.tsx:140-152` — a local `draft` state, explicitly commented "so a drag or a tap moves the list at once and does not wait on the round trip," re-seeded from the server value only when it actually changes (`:148-152`).
- `:237-240` (`apply`) — `setDraft(next)` happens synchronously, `commit(next)` (the mutation) fires right after — the UI moves immediately, the write follows.
- `src/hooks/useSurplusRanking.ts:222,224` — success and failure both toast, so a failed write is not silent, though the local `draft` is not force-reverted on error (only re-synced the next time the server's own signature changes) — a user who reorders and then gets an error toast keeps seeing their attempted order until they navigate elsewhere. Minor, not measured against a real failure in this pass.

For the money-decision surface (accept/skip/edit a bank charge), the
**opposite** choice was made on purpose, and it's documented:
- `src/components/transactions/DecisionDeck.tsx:188-211` (`decide`) — the card does **not** advance until `await write()` resolves; on failure it shows `Not recorded — ... This charge is still waiting on you.` (`:207`) instead of moving on. The comment at `:191-195` states the reasoning directly: *"A deck that slides forward regardless would leave the user certain they decided something the database never heard about."*

This is the correct call for a finance app and should not be "fixed" toward
the reel's version: an optimistic swipe that silently fails to write a
category change is exactly the kind of quiet failure this house's own rules
already forbid. Rule 11's instinct (perceived speed) loses to data integrity
here, deliberately, and that tradeoff is the right one for this class of
action.

---

## Rule 12 — save drafts/unfinished input automatically; going back must not erase it

**Verdict: BROKEN — a real, well-documented mechanism exists and covers most forms, but not the Garage.**

The mechanism is a shared hook, not ad hoc per form:
- `src/hooks/useFormDraft.ts:1-27` — writes the open form's values to `localStorage` on every keystroke (undebounced, on purpose — a tab close gives no time to flush a timer, per the comment), and the doc states the exact invariant: *"a draft is only removed by an explicit open→closed transition or by `discard()`, never by a mount or an unmount."* That is precisely rule 12's ask, done deliberately.

It's wired into six surfaces:
- `src/pages/Transactions.tsx:6,403,1225`, `src/pages/BudgetControl.tsx`, `src/pages/DebtPayoff.tsx`, `src/pages/SavingsGoals.tsx`, `src/pages/Accounts.tsx`, `src/components/vehicles/VehicleMoneyPanels.tsx` (all `grep -l useFormDraft`, confirmed).

It is **not** wired into the Garage's build and maintenance forms, which use
the same `FormModal` shell but plain `useState`:
- `src/components/builds/BuildFormModal.tsx:22` (`const [form, setForm] = useState(empty)`), no `useFormDraft` import anywhere in the file.
- `src/components/builds/MaintenanceFormModal.tsx` — same pattern.

Both forms do get a related but narrower protection for one specific gesture
— tapping the backdrop on a dirty form auto-saves instead of discarding, via
a separate, also-deliberate mechanism:
- `src/lib/form-dismiss.ts:1-56` (`backdropAction`) — "pristine dismisses, dirty saves," dated to a specific Tre instruction (2026-08-18, quoted at `:4-5`).
- `src/components/builds/BuildFormModal.tsx:55` calls it for the backdrop tap.

But the **X button in that same modal bypasses it entirely**:
- `src/components/builds/BuildFormModal.tsx:88-89` — `<button onClick={onClose}>` — a direct close, no `backdropAction` check, no draft to fall back on. Typed input in a Garage build or maintenance-log form is lost the instant `X` is tapped, or the instant the page unmounts (switching bottom tabs, backgrounding the app) — the one case `useFormDraft` exists specifically to catch, and does catch everywhere else.

**Proposal: one file per form, two files total.** Add the same
`useFormDraft` call already used in six other places to
`BuildFormModal.tsx` and `MaintenanceFormModal.tsx`. The hook, the storage key
convention (`draftStorageKey`), and the `draftRestored`/`onDiscardDraft` props
on `FormModal` already exist and are already exercised by tests
(`src/hooks/__tests__/useFormDraft.test.tsx`) — this is wiring, not new design.

---

## Rule 13 — ask for notifications/camera/photos/location only at the point of use

**Verdict: ALREADY DONE for notifications; NOT APPLICABLE for camera, photos and location — the app has none of those features.**

Notifications are asked for at the exact moment there is a real notification
to send, not at launch or at settings-toggle time, and this is explicitly
documented as a deliberate choice:
- `src/components/settings/NotificationSettings.tsx:23-24` — *"There is still no permission prompt here. Permission is asked at the first moment there is something real to send."*
- `src/lib/notification-service.ts:72-85` (`ensurePermission`) is called from inside `runNotificationCheck` at `:102`, immediately before scheduling the actual notification (`:107-114`) — never anywhere else in the codebase (`grep -rn ensurePermission src` returns only its definition, its test, and this one call site).
- It also respects a prior "no" without re-prompting (`:76-80`, `if (display === 'denied') return false`), which is the OS-level version of the same "don't ask again if they said no" principle.

Camera, photo-library and location permissions are genuinely absent, not
mishandled:
- `package.json:30` — the only Capacitor permission-bearing package installed is `@capacitor/local-notifications`. No `@capacitor/camera`, `@capacitor/geolocation`, or `@capacitor/push-notifications`.
- `src/components/builds/BuildPhotoUploader.tsx:92-93` — build/maintenance photos go through a plain `<input type="file" accept="image/jpeg,image/png,image/webp">`, which hands the OS's own file/photo picker sheet to the user without the app ever requesting persistent photo-library access.
- No `Geolocation` or `navigator.geolocation` reference anywhere in `src`.

There is nothing to fix here; the rule doesn't transfer to features that don't exist.

---

## Rule 14 — quick actions open in a bottom sheet, dismissed by swiping down

**Verdict: MISSING.**

Every overlay in the app — `FormModal`, `CalcDrawer`, `LumpSumPanel`,
`AppLockSetupModal`, `BuildFormModal`, `MaintenanceFormModal`,
`ForecastAssumptionsPanel`, `DashboardCustomizer`, `FounderNoteModal` — shares
one CSS primitive that centers itself in the viewport rather than anchoring to
the bottom:
- `src/index.css:191-203` (`@utility modal-overlay`) — `display: flex; align-items: center; justify-content: center;`. This is a centered dialog, not a bottom sheet, on every device width including phones.

There is no swipe-down-to-dismiss gesture anywhere. The only drag interaction
in the app is horizontal, on the bank-review deck cards, and it means
accept/reject a charge, not dismiss an overlay:
- `src/components/transactions/DecisionDeckCard.tsx:136` — `drag={reducedMotion ? false : 'x'}` (x-axis only).
- No bottom-sheet library is present (`grep "vaul\|react-swipeable" package.json` — no matches); `framer-motion` is already a dependency (`package.json:49`) and used for animation elsewhere, so a drag-to-dismiss sheet would not need a new package, just new code.
- Dismissal today is tap-`X` or tap-backdrop only (every file cited under rule 6 and rule 12).

**Proposal: a real project, not a quick patch.** `modal-overlay` and
`FormModal` are shared primitives used across roughly 15+ call sites, and both
already carry hard-won, commented fixes for iOS WebKit containing-block bugs
and safe-area insets (`FormModal.tsx:44-48`, `CalcDrawer.tsx` per its own
comments). Converting the shared shell to a bottom sheet with a working
swipe-to-dismiss, without regressing any of that prior work, touches the
primitive every modal in the app depends on — this is sized like "a real
project" (a shared-component redesign with a device-verification pass), not a
few-file tweak, even though the drag mechanics themselves are a few dozen
lines with `framer-motion`.

---

## Rule 15 — notifications and shared links open the exact content, not home

**Verdict: split — BROKEN for shared links (deliberately, for a stated reason), MISSING for notification taps.**

**Shared links.** `/builds/share/:token` is a real, working route
(`src/App.tsx:344`) meant to be shared outside the app. On the web it works
exactly as rule 15 wants — any URL is a real route in a SPA. On native it does
not, and the reason is explicit and deliberate rather than an oversight:
- `android/app/src/main/AndroidManifest.xml:32-36` — *"Deliberately scoped by pathPrefix to the auth routes only: claiming the whole getforgenta.com host would pull public links such as /builds/share/:token into the app behind a login wall."*
- `public/.well-known/apple-app-site-association:1-17` and `public/.well-known/assetlinks.json` confirm the same scoping on iOS: only `/auth-callback`, `/auth`, `/akoya-oauth` (and Android additionally lists no others, `AndroidManifest.xml:41-42`).
- `src/App.tsx:371-459` (`DeepLinkHandler`) only branches on `auth-callback` and `oauth` hosts (`:386`, `:443`); every other incoming URL falls through and does nothing.

So: a person with the app installed who taps a shared build link gets the web
page in a browser, not the app, on purpose — because every other screen in
the app sits behind `ProtectedRoute` (`src/App.tsx:167`, `:299`), and claiming
that link as an app-link would otherwise dump a signed-out visitor at a login
wall instead of the public page they were sent. **This is the app trying and
correctly avoiding a worse failure, not simply missing the feature** — the
real fix, if this is ever prioritized, is not "add the path to the AASA/asset
links," it's "make `/builds/share/:token` work for a signed-out user inside
the native shell too," which is a different and larger change than a link
manifest edit.

**Notification taps.** Genuinely missing, no comment or reasoning found:
- `grep -rn "localNotificationActionPerformed\|addListener.*[Nn]otification" src` returns nothing — there is no listener anywhere that reacts to a tapped local notification.
- `src/lib/notification-service.ts:107-114` (`LocalNotifications.schedule`) attaches no `extra` payload identifying which bill, month or milestone the notification was about.
- A user who taps "a bill you cannot cover" (per the copy at `NotificationSettings.tsx:73`) lands on whatever the app's default route is, not the bill or the relevant month.

**Proposal for the notification half: a few files.** Add an `extra: { route:
'/transactions?...' }` (or similar) to the `schedule()` call at
`notification-service.ts:107-114`, keyed per notification kind in
`decideNotification`'s output, and register a
`LocalNotifications.addListener('localNotificationActionPerformed', ...)` in
`DeepLinkHandler` (`App.tsx:371`) or a sibling hook that calls `navigate()`
with that route. The shared-link half is not a few-file fix — see above.

---

## Ranked by user impact — most severe first

1. **Rule 15, notification taps** (MISSING) — the app already earns the tap
   with a specific, true claim ("a bill you cannot cover"), then discards the
   context the moment it's tapped. This is the rule where the gap most
   directly wastes the value of a feature that already works up to the last
   step.
2. **Rule 12, Garage forms** (BROKEN) — a typed build name, cost, or
   maintenance note is silently gone on `X` or on switching tabs, while the
   identical action is safe everywhere else in the app. The inconsistency
   itself is the tell: users who trust the app's draft-saving behavior
   elsewhere have no reason to expect this one surface to betray it.
3. **Rule 9, bottom-tab re-tap** (MISSING) — small in isolation, but it's the
   single most-used gesture pattern (bottom nav) missing a one-line fix that
   every other five-tab consumer app has trained users to expect.

Do first, in that order — items 1 and 3 are genuinely small (a few files / one
file), item 2 is two files with a mechanism that already exists. Rule 14
(bottom sheets) is the most visible gap but is sized as a real project and
should not be picked up opportunistically alongside these three.

Everything else (rules 6, 8, 10, 11, 13, and the shared-link half of 15) is
either already correct, not applicable to a budgeting app, or — in the case of
the deliberate rejections under rules 11 and 15 — correctly built to resist
the reel's advice rather than adopt it.
