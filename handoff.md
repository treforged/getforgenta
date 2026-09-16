# handoff.md - FIRST UP NEXT TIME

## FIRST UP - 2026-09-16 (Ada, ELEVENTH session). THE NAV IS WALKED AND THE GLASS PILL IS SHIPPED.

⚠️ **TRE SAYS HE INSTALLED "THE NEW VERSION" (2026-09-16 ~20:25Z) AND WHICH BUILD IS UNSETTLED.**
854 finished uploading at 19:11:03Z, so it had ~73 minutes to process and IS plausibly what he has -
but 849 was the only installable build for most of today, and **849 carries NONE of today's work**
(head `45669b71`, checked by ancestry: no nav IA, no Plaid auto-open, no glass pill; 854 has all
three). **The cheap discriminator is the tab bar itself, not a build number:** a FLOATING PILL
inset from the edges is 854, a full-width bar stuck to the bottom edge is 849. Do not assume he has
seen today's work because he has updated.
⚠️ **He also said "i thought i told you this" - he did not tell THIS session**, so it reached the
predecessor tab or Sam. Same relay family the charter already records: a message is a nudge, the
record is the record.

**THE QUEUE IS EXHAUSTED. iOS 854 IS IN TESTFLIGHT** (run `35138359218`, altool
`UPLOAD SUCCEEDED with no errors` at 19:10:56Z) and it carries everything below. Everything is on
origin/main, 0/0, tsc clean, lint 0 errors, test:tz **466 files / 4712 tests green in three zones**
(same count as the previous session - the suite did not shrink).

**FIRST UP NEXT TIME: item 5** (lower the control-style ceiling opportunistically) - or whatever
Tre sends. **Item 3, native glass, is blocked on him borrowing a Mac**, and the no-Mac half is now
done: `docs/native-glass-mac-session.md` is the runbook for that session.

### WHAT SHIPPED THIS SESSION
* **`[nav]` the new nav IA is WALKED IN A REAL BROWSER** - `5e6d779a`, new `npm run check:nav`
  (`scripts/check-nav-doors.mjs`), 390x844 and 1440x900, signed in. Measured: hamburger absent on
  the four tab routes, present and TAPPABLE on /account (44x44 at 337,5, hit-tested with
  `elementFromPoint` because visible-and-covered is what put Settings out of reach on every notched
  iPhone in 2026-08), press lands on /settings, badge -> /account, one ordinary Sign Out distinct
  from the Security panel's all-devices control, desktop Settings button 101x33.
  **Proven red twice on real prior states**, restored byte-exact.
* **`[nav]` the phone tab bar is a FLOATING LIQUID-GLASS PILL** - `936c3cf8`. Inset 14/13/13px at
  390x844, 71px tall, `rounded-full`. `npm run check:glass` measures **mean 255.00 per-pixel change
  under scroll against 0.00 still-frame noise** - real `backdrop-filter`, not a painted fill.
  The safe-area inset moved from `paddingBottom` to the BOTTOM OFFSET; `overflow-hidden` is
  load-bearing or the blur paints a rectangle outside the pill.

### ⚠️ THREE INSTRUMENT FAULTS FOUND THIS SESSION, ALL OF WHICH WOULD HAVE READ AS APP DEFECTS
Written down because each is a trap the next session will meet in the same place.
1. **CLAUDE-IN-CHROME CANNOT SET A PHONE VIEWPORT HERE.** `resize_window` returned
   *"Successfully resized ... to 390x844"* and `window.innerWidth` stayed **1154**, twice.
   `outerWidth` reads 0. **The call succeeds and nothing happens** - the same family as
   `Start-ScheduledTask`. Tre's ask said to walk it with Claude-in-Chrome; it was walked with
   PLAYWRIGHT instead, and that substitution is the reason the walk is trustworthy.
2. **A SELECTOR THAT REQUIRED AN ICON FOUND NOTHING** - `IdentityBadge` renders INITIALS ("DW"),
   not a `<svg>`, so requiring one asked for the one thing the control does not have. Its zero was
   a fact about the selector.
3. **A SIGN-OUT COUNT OF 2 WAS ONE REAL CONTROL AND ONE 0x0 BOX** - `Sidebar.tsx`'s own Sign Out
   row is in the DOM at 390px inside an `lg:` wrapper. Every count in that gate now requires a
   rendered box. And Settings is FOUR panels; the all-devices control lives in **Security** only.

### ⚠️ AND THE GATE'S FIRST RED RUN BLAMED ITSELF - FIX THIS SHAPE WHEREVER IT APPEARS
The bar assertions originally found the bar by `nav[class*="rounded-full"]` - **its own correctness
marker** - so restoring the pinned bar printed *"CONTROL FAILED: no bar with a pill radius was
found"* and exited 2. **An exit-2 tooling fault gets re-run and then ignored; an exit-1 finding gets
fixed.** It now matches the rendered fixed-position `<nav>` in the bottom half of the viewport - true
of both shapes - and the radius is an ASSERTION about what was found, not a condition of finding it.

### WHAT SHIPPED EARLIER TODAY, newest first
* **`[nav]` Settings had THREE doors on a phone, now ONE.** Identity badge -> `/account`;
  hamburger renders ONLY on the Account tab and goes straight to `/settings`; the drawer is
  DELETED; Settings gained an ordinary **Sign Out** and Upgrade to Premium at the bottom.
* **`[bank]` "Connect a bank" now OPENS PLAID** instead of dropping the user on a page.
  `FreeBankLinkNotice` -> `/accounts?tab=banks&connect=1` -> `Accounts.tsx` reads it once, strips
  it, passes `autoOpen` -> `PlaidLinkButton` fires once on mount, ref-guarded.
* **`[design]` the tab strip pinched its corners on every screen**, plus two unclipped card lists.
  New `npm run check:concentricity` (rendered, 3 viewports incl. 390px phone).
* **`[a11y]` the username field had NO visible focus state**, second occurrence. New repo-wide
  `focus-visible.gate.test.ts`.
* **`[pmf]` the survey gate leaves a qualifying fixture row** in the production table.
  `public.pmf_responses_real` excludes reserved TLDs.

### 🚨 TESTFLIGHT: A PUSH NEVER UPLOADS. DISPATCH IT.
    gh workflow run "iOS Build & Upload to App Store" --ref main
**iOS 849 uploaded 17:10Z** (run 35126037599). **TODAY'S LATER COMMITS ARE NOT IN ANY BUILD YET** -
the nav change and the Plaid change both landed after 849 was cut. **Dispatch once, at the end, not
per commit** - Apple caps uploads per app per day.
⚠️ **Android 839 and iOS 848 were both WRONG ANSWERS to "is it on my phone".** 839 is Android and
appears nowhere in TestFlight; 848 was BUILT and its upload step reads **skipped**, on a run whose
conclusion reads **success**. **Read the UPLOAD STEP'S conclusion, never the run's.** Full detail in
`CLAUDE.md`.

### ⚠️ THE TRAP THAT NEARLY STRANDED DESKTOP, and it will catch the next person too
`primary-nav.ts` records that **the desktop rail has NO Settings row** - dropped deliberately
because "the Account page links to it". The hamburger is `lg:hidden`. So "only from the hamburger"
does NOT mean delete Account's Settings button; it is `hidden lg:inline-flex` and
`settings-reachable.gate.test.ts` holds both widths. **Do not simplify that breakpoint away.**

### ⚠️ TWO OF TRE'S OWN INSTRUCTIONS NOW CONFLICT, AND THE LATER ONE WINS
2026-08-18: *"make settings accessible from a hamburger in the top left at all times."*
2026-09-16: *"the hamburger ... is only viewable and accessible from the account page."*
Both are recorded in `MobileTopBar.tsx`. A session reading only the older comment would revert this.

### RESUME QUEUE - START AT ITEM A (items 0-4 below are DONE)

A. [ ] 🚨 **BIG BLANK SPACES - AND IT IS NOT ONLY SETTINGS.** Ask `387f4d00`.
   Tre, 2026-09-16 16:30: *"format the pill in the settings tab cleaner. and reduce the empty space
   in the top right. some other tabs also have this issue. big blank spaces."*
   ⚠️ **DO NOT MARK THIS DONE OFF `845db7ee` - I nearly did, and it is wrong twice.** That
   commit landed **16:53 ET** and his ask is **16:30 ET**, so it cannot be an answer to what he was
   looking at; and by ancestry it is **NOT in build 854** (head `936c3cf8`), so it is on origin and
   on nobody's phone.
   **THE DELIVERABLE IS AN INVENTORY.** His own words are "some other tabs also have this issue",
   so the screen he named is a sample, not the scope. Every tab's top-right whitespace, a rendered
   frame each, then fix what the inventory finds.
   ⚠️ **INSTRUMENT: `resize_window` REPORTS SUCCESS AND MOVES NOTHING** - measured on two
   desks today. Any phone-width check made with Claude-in-Chrome is silently taken at DESKTOP width.
   Use Playwright with a real viewport (`.env.deck-walk.local`, the pattern every `check:*` uses),
   and read frames at `--force-device-scale-factor=2` - at default scale a near-black `#18181b` has
   already read as BLUE on this machine and nearly became a filed palette defect.

   ✅ **THE INVENTORY PROBE IS BUILT, PROVEN RED AND SHIPPED: `npm run check:topright`.** It was
   parked outside `scripts/` for TEN faults and nine runs before it earned promotion, and no number
   from it was reported to anyone in the meantime. The fault log is kept below because every one of
   them is a way a rendered-geometry probe can lie while looking healthy.
   Two instrument faults were found and FIXED in it; a third is open:
   1. FIXED - it climbed ancestors until it reached `main`, which on most routes IS the whole
      content column, so it reported **305 rows and a 4908px header inside an 844px viewport**,
      with a NEGATIVE right gap. Impossible numbers, which is the only reason they were caught.
   2. FIXED - `HEADER_ZONE_PX` was declared in Node scope and the function runs IN THE PAGE, so it
      died with `is not defined`. **That is the LOUD version; a name that existed in both scopes
      would have captured the wrong value silently.**
   3. FIXED - `headerPx` read **4872 on a phone**. The zone admitted any element whose TOP was in
      the band, so a long list container beginning under the title ran the whole page. Requiring
      the element to FIT the band brought every header to a plausible **217-258px**.
   4. FIXED - `headerRows` counted distinct tops of EVERY leaf, so an icon, a label and a
      baseline-shifted span inside ONE row each scored as a row (9-24 rows in a 240px band). Now
      counted from the title plus INTERACTIVE items at 12px granularity: **2-4 on phone, 4-9 on
      desktop**, which is readable as rows.
   5. FIXED - bounding the band had EXCLUDED any header taller than it, so three phone routes
      reported no header at all and the probe lost sight of exactly the tall headers it hunts.
      Elements are now CLIPPED to the band rather than dropped: **18 of 18 pairs now report a
      header**, against 15 before.
   6. FIXED - `headerPx` was saturated at the band ceiling (238-256 everywhere). Now measured to
      the last ROW ITEM's bottom: **95-256, varying per route**, which is a reading rather than a
      constant.
   7. FIXED (the reference edge) - `contentRight` was the widest drawn element IN THE ZONE, which on
      most routes IS the title row's own control. **Hiding that control lowered the reference and
      the measured edge TOGETHER, so a planted defect was invisible.** Deriving a reference from the
      thing being measured. Now taken from the LAYOUT - the content column, found by walking up from
      the title while the ancestor still fits the viewport - which does not move when a button is
      hidden. Phone now reads 14px and desktop 36px baseline, i.e. the column padding.
   8. FIXED (the plant's boundary) - it selected `r.left >= hb.right`, and `hb` is the `<h1>`'s
      BLOCK box, which fills the column. So the boundary WAS the column edge and the plant hid
      nothing. Now uses the glyph extent, shared with the metric.
   9. FIXED (the plant's lifetime) - plant and measurement were two `page.evaluate` calls, and React
      re-renders in the gap and wipes the inline style, so the "after" reading came from a page that
      had already healed. Now one evaluation. **Same family as a reset whose verification runs
      before the app has had its say**, which this repo already records.
   10. FIXED, AND THE PROBE IS NOW PROVEN. `titleRight` took the max right over every title-row
       element, including the PADDED ROW WRAPPER holding the title and its controls - so it was
       pinned to the column's inner edge and every route reported exactly its padding. Excluding
       anything that STARTS left of the title's glyphs (a container, not content) closed it.
   ✅ **RED CONTROL: DETECTED ON BOTH VIEWPORTS - `rightGap 14 -> 243` on phone, `36 -> 1225` on
      desktop.** Eight runs refused to print a trusted table and the ninth earned it. **The numbers
      below are the first from this probe that are evidence rather than output.**
   ✅ **PROMOTED: `scripts/inventory-top-right-space.mjs`, wired as `npm run check:topright`.**
   11. FIXED - **THE READINGS WERE FLAKY AND A RED CONTROL DOES NOT CATCH THAT.** Proving the probe
       can see the defect says nothing about whether the page had finished settling when it looked:
       `/dashboard` phone read **14px on one run and 270px on the next with no code change**. Each
       route is now measured TWICE, 1.5s apart, and a disagreement is printed as **UNSTABLE** rather
       than averaged - an average of two readings, one of a half-rendered page, is a confident
       number with nothing behind it. Result: **18 of 18 pairs, zero unstable**, red control still
       DETECTED on both viewports. The numbers below are stable and repeatable.
   12. FIXED - **A BIG `rightGap` IS NOT WASTE, AND I NEARLY ACTED ON FOUR THAT WERE NOT.** The new
       `onRow` column is what separates them, and `colPx` exposes the second artefact:
       * `onRow 0` - nothing is on the title row at all. Checked by hand, **every one was benign.**
         The Command Center's four buttons sit BELOW the title on a phone because **Tre asked for
         that on 2026-08-19**, after a `flex-row` at 390px drew them on top of the title; the
         comment recording his instruction is still in `Dashboard.tsx`. "Fixing" that 270px would
         have reverted his own decision and restored the overlap he reported.
       * Desktop `/account` and `/settings` at 306px are the **`max-w-2xl mx-auto` CENTRING
         MARGIN**, not slack - the walk climbs past the centring wrapper, which `colPx 1440` beside
         a 672px content box now makes visible.
       ⚠️ **SO THE ANSWER TO HIS ASK IS A NEGATIVE RESULT, AND IT IS A REAL ONE:** at 390px and
       1440px, **no route wastes top-right space by accident.** The screen he named, Settings, was
       fixed by `845db7ee` and now reads **14px on a phone** - the column padding, i.e. content
       reaches the edge. ⚠️ **AND THAT FIX IS STILL IN NO BUILD**, which is the thing that
       actually matters to him: by ancestry `845db7ee` is not in 854. **Dispatch iOS and he will
       see it.**
       **STATED LIMITS, so nobody trusts this past its reach:** two widths only; `colPx` exposes the
       centring artefact but does not correct for it; and 2-3 desktop routes still drop out of a run
       intermittently, so a missing row means "not measured", never "clean".
   🗑️ **SUPERSEDED - the claim this replaced, kept because it was wrong in an instructive
      way: "THE INVENTORY VINDICATES HIS 'some other tabs also have this issue'". It does not. The
      numbers were real and the reading of them was wrong, which is the more dangerous half.**
      **NEXT: nothing to lift. Dispatch the iOS workflow so `845db7ee` reaches his phone, and keep
      `check:topright` as the gate that answers this class of complaint by measurement next time.**
   🗑️ **SUPERSEDED - the original fault 10 text:** `titleRight` IS MEASURING A CONTAINER.
       The control still reads NOT DETECTED, and the reason is now located. Every route's gap equals
       its column padding exactly (14 phone / 36 desktop) EXCEPT desktop `/account` and `/settings`
       at 306 - a baseline that uniform means something always reaches the column's inner edge on
       the title row. That something is a PADDED ROW WRAPPER: it survives the leaf filter (its child
       does not fill it), it is counted in `titleRight` because that takes the max right over all
       title-row elements, and the plant cannot hide it because its `left` is at the column's LEFT,
       not right of the title.
       **THE FIX: exclude from `titleRight` any element that SPANS the title** - one whose `left` is
       left of `textRight`. A container is not content, and a gap measured to a container's edge can
       never be anything but the padding. That also explains why the whole column has looked like a
       constant.
   ✅ **THE CONTROL HAS REFUSED TO PRINT A TRUSTED TABLE ON EVERY ONE OF EIGHT RUNS, and it was
      right every time.** It first looked like a broken control, then like a weak plant; it was
      neither. **No number from this probe has reached anyone**, which is the only reason eight
      wrong readings cost nothing.
   🗑️ **SUPERSEDED - the original fault 8, "the fault is in the plant, not the metric". It
      was in both, and asserting where it was NOT is what cost two of the eight runs.** The plant selects elements with `r.left >= hb.right`
      - but `hb` is the `<h1>`'s BLOCK box and an `<h1>` fills its column, so that boundary is the
      column edge and the plant hides essentially nothing. **Point the plant at `textRight` (the
      glyph extent) instead of `hb.right` and it should go red immediately.**
      Three narrowing steps are already done and should not be repeated: the plant was widened from
      buttons-only to every element (a plant NARROWER than the metric reports "not detected" from a
      probe that detects fine - the most expensive possible reading of a control); `titleRight` moved
      off `hb.right`; and the glyph width is now measured with canvas `measureText`, **because a
      `Range` over a BLOCK element's contents returns its full-width LINE BOX, not its text.**
   ✅ **THE CONTROL IS DOING ITS JOB - it has refused to print a trusted table on every run, and
      that refusal is the reason none of these numbers has been reported to anyone.**
   🗑️ **SUPERSEDED - the original fault 6:** `headerPx` IS NOW SATURATED. Every route
      reads **238-256px**, which is the band ceiling (`h1.bottom + 220`), not the header. **An
      identical value across independent samples is a bug signature**, and this column now measures
      the constant rather than the app. Either derive the header's end from the first real content
      block, or delete the column - a saturated number that looks like a measurement is worse than
      no column.
   7. 🚨 **OPEN - NO PROVEN-RED CONTROL.** Nothing yet shows this probe CAN report waste where
      waste exists. Until it has been driven red against a known-bad header, its quiet columns are
      not evidence.
   🔍 **ONE LEAD, EXPLICITLY FROM AN UNPROVEN INSTRUMENT AND NOT A FINDING:** with the
      instrument now PROVEN (see fault 10), so this is no longer a lead - it is the inventory, and
      it is recorded above. The earlier phone `/debt`
      371px reading came from the BROKEN reference and should be discarded, not carried forward.
      If that survives a proven-red control it is a bigger instance of the exact thing he reported,
      **on a screen he did not name** - which is the argument for the inventory. **Do not act on it
      or repeat it to him until the probe is trustworthy.**
   🗑️ **SUPERSEDED - the original fault 4, kept so the reasoning is not lost:** `headerRows` IS
      NOT A ROW COUNTER. It reads 9-24 distinct tops in a
      ~240px band, which cannot be rows. It counts distinct rounded `top` values across every leaf,
      so icons, baselines and staggered items inside ONE row each score as a row. **Count bands of
      the header's own interactive items, not tops of all leaves** - and note the `below` column,
      which counts actions under the title row, already behaves sensibly and may be the better
      signal on its own.
   5. 🚨 **OPEN, AND IT IS THE FIX FOR 3 CREATING A NEW BLIND SPOT.** Bounding the band
      EXCLUDES any header taller than it: `/transactions`, `/forecast` and `/goals` now report no
      header at all on phone, where before they reported a wrong one. **A tall header is exactly
      the waste being hunted, so the probe currently cannot see its own subject.** Clamp the rect
      to the band instead of dropping the element.
   ⚠️ **AND THE MAJORITY-OF-ROUTES CONTROL DID NOT CATCH 5** - 15 of 18 still passed it. A
      control tuned to "most routes have a header" cannot notice that the three it lost are the
      three that matter.
   ✅ **AND ONE APPARENT FAULT IS PROBABLY THE APP, NOT THE PROBE - CHECK BEFORE "FIXING" IT.**
   `/dashboard`, `/accounts` and `/goals` all report the title "Command Center", and `/forecast`
   reports "Transactions". That looks like a navigation-settling bug and may simply be true: those
   routes appear to be TABS of one shell. `handoff.md` already records that the widget stack lives
   under the Overview tab only. **Verify which it is before rewriting the navigation half** - the
   repo's own record is that chasing the wrong layer here cost three wrong diagnoses once already.
   **NO NUMBER FROM THIS PROBE HAS BEEN REPORTED TO ANYONE**, and none should be until fault 3 is
   closed and it has a positive control that can be shown to fail.

B. [~] **NOTIFICATIONS - AND THE ORDER IS REGISTRATION, SENDER, CADENCE.** Ask `384ca151`
   (`cb36caa1` was the duplicate, dropped; survivor verified live after the drop).
   Tre wants a higher daily volume that is not spammy, suppressed while he is IN the app, still
   firing when BACKGROUNDED. **Cadence is the last of three and is worthless without the first two.**
   🚨 **BOTH RECORDED CAUSES OF THE iOS FAILURE ARE REFUTED BY THE BUILD RUNNING THE FIX.**
   Checked by ancestry, not by the record: the `production` entitlement (`8561f0d0`) and the
   listener race (`ec67489f`) are **both ancestors of `936c3cf8`, the head of build 854**, which he
   has installed. That build recorded **152 consecutive `timeout` rows with `permission=granted`**,
   latest 21:10Z on 2026-09-16, and `device_tokens` has never held a single iOS row.
   **So the entitlements comment in `ios/App/App/App.entitlements` is now a WRONG CAUSE beside a
   RIGHT FIX** - it names three Apple-portal steps as the remaining blocker, but signing SUCCEEDS,
   which means the profile already carries the capability. Do not spend another session on it.
   ✅ **WHAT SHIPPED TOWARD IT:** a `timeout` row now records `net=up`/`net=down`
   (`probeReachability`), so the 153rd attempt names its own cause instead of repeating the 152nd.
   **Its limit is written beside it: it probes ordinary HTTPS, NOT APNs' port 5223**, so `net=up`
   narrows to "online and APNs still silent" and does not clear the network. `net=down` is
   conclusive. His home network is already recorded as blocking TestFlight and Tailscale.
   **NEXT:** read a fresh `push_registration_status` row from his device and branch on `net=`.
   The sender is the second gate - all 13 `push_send_runs` since 2026-09-05 are `dry_run=true`.
   **A cadence policy he has not vetoed:** max 3/day, quiet hours 21:00-08:00, dedupe per
   (user, kind, day), never send "nothing happened".

C. [ ] **THE INCOMING HALF OF A TRANSFER IS STILL SPENDING-SHAPED** - the residue item 0 left, and
   it is named rather than implied. `pay-schedule.ts:1437` gives any non-income rule an
   expense-shaped transaction, so `detectTransferLegs` records OUTFLOWS ONLY; marking an inflow
   `transfer` today would book arriving money as a cost. That function needs a third shape first.



0. [x] **DONE - A TRANSFER TO HIS OWN ACCOUNT IS NO LONGER SPENDING.** `63085f10`, on origin, 0/0.
   `rule_type` is now `proposal.transfer?.ruleType ?? proposal.direction`, and
   `src/lib/transfer-rule-detection.ts` is what decides. Gates: tsc clean, lint 0 errors,
   `test:tz` **466 files / 4725 tests** green in three zones (4712 -> 4725, +13 = the new tests;
   the suite did not shrink). Proven red by mutation twice, restored byte-exact by sha256.
   ⚠️ **THE INHERITED DESIGN WOULD NOT HAVE FIXED IT, and only the premise test caught that.**
   The plan was to reuse `detectTransferPairs`. Measured: **the Fidelity account holds ZERO
   `synced_transactions` rows** - Plaid returns holdings for it, not a feed - so there is no
   inflow leg and nothing to pair. A pairing-only fix passes its own tests and leaves the number
   untouched. **Linking the destination changed nothing, which is exactly what he reported.**
   So there are TWO signals: the pair (both legs synced - covers card autopay), and the provider
   explicitly saying `TRANSFER_OUT`/`TRANSFER` **while the row names exactly one other account he
   owns**. The one-sided signal is deliberately the narrower: no self-match, no generic word
   ("Savings Account" must not match every row saying SAVINGS), and silence when two accounts
   match - he really does hold two called "Robinhood individual". A run must be UNANIMOUS.
   ⚠️ **OUTFLOWS ONLY, AND THAT IS CORRECTNESS, NOT SCOPE.** `pay-schedule.ts:1437` gives any
   non-income rule an expense-shaped transaction, so marking an INFLOW `transfer` would book
   arriving money as a cost - strictly worse than today. Marking the incoming half needs that
   function to learn a third shape first. **That is the residue; it is not done.**
   ✅ **THE DB GATE THE PREDECESSOR COULD NOT RUN:** `recurring_rules.rule_type` has **no CHECK
   constraint**, and `transfer` (4 rows) / `investment` (6 rows) are already in production.
   🚨 **AND HE HAD ALREADY ACCEPTED THE BAD RULE, so the code fix alone would have left his
   own number wrong.** Row `ebc1f0a4-ce8a-43ef-abe4-c22abd1af180` ("Fidelity", $25, created
   2026-09-16 20:38:05Z) was live as `rule_type='expense'`, `deposit_account=null`. Repaired in
   place to `rule_type='investment'`, `deposit_account='eb3f82fe-79ac-4d86-9e4a-2b626eda6ef6'`,
   read back after the write. **UNDO, exact:**
       update public.recurring_rules set rule_type='expense', deposit_account=null
       where id='ebc1f0a4-ce8a-43ef-abe4-c22abd1af180';
   **NO BUILD IS NEEDED FOR THAT HALF.** `isTransfer` has been derived from `rule_type` since
   2026-08-19, so **build 854, which he has installed, computes it correctly from the repaired
   row on his next refresh.** The CODE half only changes FUTURE proposals and is not in any
   build - **iOS was deliberately NOT dispatched:** 849 and 854 both uploaded today, Apple caps
   uploads per app per day, and nothing in this commit is visible without proposing a new rule.
   Batch it with the next slice.

<details><summary>The original diagnosis, kept because its premise was wrong in an instructive way</summary>

0. [x] 🚨 **MONEY CORRECTNESS - A TRANSFER TO HIS OWN LINKED ACCOUNT IS BOOKED AS SPENDING.**
   Tre, 2026-09-16: *"i was suggested a rule for $25 coming out of my check to my fidelity
   account. even though my fidelity is link it made the rule into a variable expense and not a
   transfer like it should have. it's not tracking money moving out from one account to another."*
   Ask `a0dc44ba`. **DIAGNOSED IN FULL - do not re-derive it, and do NOT treat it as a label
   bug: the rule really is created as an expense.** The chain, each link with evidence:
   1. `src/lib/rules-from-history.ts` groups charges by `merchantKey|account_id|direction` and
      has **no concept of transfers or owned accounts** - grepping that file for
      transfer/internal/counterparty returns nothing relevant.
   2. It takes its category from `suggestCategory(recent.category)` (line 334).
   3. `src/lib/plaid-category-map.ts:62-73` maps `TRANSFER_IN`, `TRANSFER_OUT` and `TRANSFER`
      to **`'Other'`** - an app EXPENSE category - with an honest comment that a transfer's
      meaning "lives entirely in the counterparty".
   4. `src/lib/pay-schedule.ts:1446` derives `isTransfer` from
      `rule_type === 'transfer' || 'investment'`. The suggestion never sets `rule_type`, so
      `isTransfer` is false and `src/lib/monthly-expense-model.ts:146` counts it in `living`.
   **CONSEQUENCE, and it is why this outranks any layout work:** inflated expenses, understated
   savings rate, and wrong inputs to the forecast engine and the cash floor. Every money page.
   ✅ **THE PART THAT ALREADY EXISTS - REUSE IT, DO NOT REBUILD:**
   `detectTransferPairs(synced, accounts)` + `indexPairsByLeg` already pair a debit in one
   linked account against the credit in another (`BankActivity.tsx:317-320`), and
   `DecisionDeck.tsx:464` already consumes it as `isTransferLeg`. **The suggestion path simply
   never consults it - which is exactly why his Fidelity being LINKED changed nothing.**
   **THE FIX:** when a charge is a transfer leg to an account the user owns, propose
   `rule_type: 'transfer'` (or `'investment'` for a brokerage) instead of a variable expense.
   ---
   **THE FIX IS FULLY DESIGNED - THESE ARE THE EXACT EDIT POINTS, ALL READ THIS SESSION:**
   * `src/lib/transfer-pair-detection.ts` - `detectTransferPairs(txns, accounts)`,
     `indexPairsByLeg(pairs)`, `legLooksLikeTransfer(leg, account)`. **Already written, already
     correct, already used by BankActivity/DecisionDeck. Reuse it; do not write another.**
   * `src/lib/rules-from-history.ts:266` `ProposalInput` already carries `charges` =
     *"Every settled synced row, all accounts, all history"* - **exactly the population
     `detectTransferPairs` wants** - but has **NO `accounts` field**. Add one (optional, so
     existing callers keep compiling), and when it is present build a leg-id Set from
     `indexPairsByLeg(detectTransferPairs(charges, accounts))`.
   * `src/lib/rules-from-history.ts:~320` is where each proposal object is pushed. Mark the
     proposal when its charges are transfer legs.
   * `src/lib/rule-proposal.ts:52` `RuleProposal` - add the flag here (it is the type's home;
     `rules-from-history.ts` only re-exports it at line 42).
   * 🎯 **`src/lib/rule-proposal-write.ts:65` IS THE LINE THAT CAUSES THE BUG:**
     `rule_type: proposal.direction`. Direction is income/expense, so an outflow is ALWAYS
     written as an expense. This becomes
     `rule_type: proposal.isTransfer ? 'transfer' : proposal.direction`, and that single change
     is what makes `pay-schedule.ts:1446` return `isTransfer: true` and
     `monthly-expense-model.ts:146` stop counting it as spending.
   * Find the caller of `proposeRulesFromHistory` and pass `accounts` through.

   ⛔ **ONE THING I COULD NOT VERIFY - CHECK IT FIRST, DO NOT ASSUME:** whether
   `public.recurring_rules.rule_type` ACCEPTS the value `'transfer'` (a CHECK constraint or
   enum could reject it). The query was blocked by the handoff gate before it ran. Run:
       select rule_type, count(*) from public.recurring_rules group by rule_type;
   plus the column's constraint. `pay-schedule.ts:1446` reads `rule_type === 'transfer' ||
   'investment'`, so the app plainly EXPECTS those values - but "the reader expects it" is not
   "the writer is allowed to store it", and that gap is exactly where this would fail silently.
   ⚠️ Consider `'investment'` rather than `'transfer'` when the destination account is a
   BROKERAGE (Fidelity is one) - both satisfy `isTransfer`, and the app already distinguishes
   them.

   ⚠️ **MONEY MATH: highest effort, adversarial verification, and the test must assert a NUMBER**
   (that `living` spending FALLS by the transfer amount), never just that a label changed. A
   green test over a renamed field would leave the forecast exactly as wrong as it is now.

</details>



1. [x] **DONE - THE NAV IS WALKED IN A REAL BROWSER.** `5e6d779a`, `npm run check:nav`
   (`scripts/check-nav-doors.mjs`). Every assertion in the old item passed, measured: hamburger
   absent on Home/Transactions/Debt/Garage, present and TAPPABLE on Account (44x44 at 337,5,
   hit-tested with `elementFromPoint`), press -> `/settings`, badge -> `/account`, one rendered
   ordinary Sign Out distinct from Security's all-devices control, desktop Settings button 101x33.
   Proven red twice on real prior states, restored byte-exact.
   ⚠️ **NOT walked with Claude-in-Chrome, which Tre's ask named** - its `resize_window` reports
   success while `innerWidth` stays 1154, so it cannot set a phone viewport at all. Playwright,
   signed in via `.env.deck-walk.local`, is the instrument that works here.

2. [x] **DONE - THE FLOATING LIQUID-GLASS PILL IS SHIPPED.** `936c3cf8`. Inset 14/13/13px at
   390x844, 71px tall, `rounded-full`, real translucency measured by `npm run check:glass`
   (mean 255.00 per-pixel change under scroll, 0.00 still-frame noise). `check:rail`,
   `check:account` and `check:concentricity` re-run green. The safe-area inset moved from
   `paddingBottom` to the BOTTOM OFFSET - that is the difference between a pinned bar and a
   floating one, not a tidy-up.
   ⚠️ **A NEW ASSERTION GUARDS THE THING NOTHING COVERED: CONTENT CLEARANCE.** The bar's footprint
   (gap + height = 84px) and `DashboardLayout`'s `pb-[calc(5.5rem+env(safe-area-inset-bottom))]`
   reserve (88px) live in different files and nothing makes them agree. `check:nav` now scrolls
   /dashboard to its end and measures the real gap: **14px**. If you change the bar's height or
   gap, that margin is what you are spending.

3. [ ] **NATIVE GLASS IS RE-APPROVED AND THE BLOCKER IS NOW AN INSTRUMENT, NOT A DECISION.**
   Tre, 2026-09-16: *"i want native glass. i just dont have access to a macbook rn. i can borrow a
   friends at some point. maybe this weekend."* Ask `7bcea8d0`.
   **Prepare everything that does not need a Mac so the borrowed session is spent MEASURING, not
   installing.** The bridge exists (`24fa97cb`) and apply/remove compile (`4b9cc178`).
   ⚠️ **TELL HIM THE ARCHITECTURE FINDING BEFORE HE SPENDS THE WEEKEND:** a native view ABOVE the
   WebView samples app content correctly but COVERS that surface's own web-rendered icons and
   figures; the shape that works needs a SECOND transparent WKWebView for chrome. That is analysis,
   not measurement - and the Mac is what turns it into measurement.

4. [x] **DONE - iOS 854 IS IN TESTFLIGHT.** Run `35138359218`, `workflow_dispatch`, head
   `936c3cf8`, run_number 754, `VERSION_CODE=854` (= 754 + 100), marketing version 6.6.
   Verified through all three gates this repo has learned to require, not one of them:
   * the RUN reads `success` - **necessary and not sufficient**, it is what 848 also read;
   * **step 20 `Upload to App Store Connect` reads `success`, not `skipped`** - the event was
     `workflow_dispatch`, which is what satisfies the upload condition;
   * **altool's own `UPLOAD SUCCEEDED with no errors`**, once, at 19:10:56Z. Checked because
     step 20 swallows Apple's cap error 90382 into a warning and still exits green. `90382`
     appears 3 times in the log and **all three are in the echoed script SOURCE**
     (`elif grep -q '90382'` and its echo), none in output - so that branch did not fire.
   854 carries the nav IA, the Plaid auto-open and the floating glass pill (confirmed: the
   `rounded-full shadow-lg` bar is in `936c3cf8`).
   ⚠️ **AN UPLOAD IS NOT AN INSTALL.** TestFlight still has to finish processing and Tre still has
   to update. "On origin", "on a build" and "on his device" stay three separate facts and a desk
   may assert only the first two.

5. [ ] **Lower the control-style ceiling opportunistically.** `control-style-ratchet.gate.test.ts`
   holds 36 input surfaces / 18 select surfaces. Consolidate only when a file is being touched
   anyway - the wholesale rewrite was DECIDED AGAINST (money pages, cosmetic gain).

6. [ ] **NOT MINE, ROUTED TO SAM:** an untriaged ask "Read scripts/daily-check-prompt.md and follow
   it exactly" - that file exists only in `trading/`. It is **Wes's**. Left untriaged deliberately
   rather than cleared: clearing it here is how a request disappears when both desks assume the
   other has it.

<details><summary>Older queue items, superseded</summary>


1. [x] **DONE - the bridge compiles and its couplings are gated.** `24fa97cb`.
2. [~] **THE CAPABILITY IS BUILT AND COMPILES; THE SURFACE HAS NO CANDIDATE.** `4b9cc178` adds
   `apply`/`remove` (UIVisualEffectView above the web view, `isUserInteractionEnabled = false` so it
   does not swallow taps). Swift green on the runner. Frame-sync deliberately NOT built (Sam).
   ⚠️ **AND I COULD NOT FIND A SURFACE TO PUT IT ON, which is the finding.** Sam authorised "one
   surface with no web content of its own". Worked to the end, four cases: a pinned bar needs a
   transparent CSS background to sample anything, and then the native view covers the bar's own
   labels; left opaque it blurs a flat colour; a modal scrim covers its own dialog; a decorative
   empty region has nothing under it to blur. **The app-lock cover in AppDelegate is the one
   genuinely content-free native surface and it is a HARD NO** - it exists so the app-switcher
   snapshot hides his financial data, and translucency defeats exactly that.
   **SO THE SECOND TRANSPARENT WKWebView IS NOT ONE OPTION, IT IS THE ONLY SHAPE THAT WORKS** -
   now reached constructively rather than asserted. Still analysis; this machine cannot measure it.
   **Do not tag a v* build until there is something to look at.**
3. [ ] **THE MATERIAL, ONCE THE ARCHITECTURE IS SETTLED.** `UIVisualEffectView` / `UIGlassEffect` behind
   `#available(iOS 26.0, *)`, added as a SIBLING of the WebView. **The expensive part is already
   named and has not got cheaper:** every glass surface needs its frame computed in JS and
   re-pushed on every scroll, resize, rotation and keyboard event. Start with ONE surface, not a
   system. CSS stays the fallback and must keep working.
   ⚠️ **AND READ `CLAUDE.md`'s "NATIVE iOS MATERIAL IS A FORK" NOTE BEFORE BUILDING** - a native
   view BELOW the WebView blurs the native background and sees no app content; ABOVE it samples
   correctly but covers that surface's own web-rendered icons and figures. The architecture that
   works needs a SECOND transparent WKWebView for chrome content. **That is analysis, not
   measurement**, and the bridge now existing does not settle it.
4. [ ] **NOTHING HAS RUN ON A DEVICE.** When the material is worth looking at, ship deliberately
   (`workflow_dispatch` or a `v*` tag) and report the BUILD NUMBER - `VERSION_CODE = run_number +
   100`. A mobile fix is not delivered until a build carries it.
6. [~] **CONTROL CONSISTENCY - STARTED. THE ACCESSIBILITY HALF IS DONE; THE STYLE HALF IS NOT.**
   **DONE:** `UsernameClaim.tsx` had **NO VISIBLE FOCUS STATE AT ALL** - it hand-rolled a copy of
   the shared wrapper/input pair, so the input had `outline-none` and the wrapper had no
   `focus-within` ring. A keyboard user tabbing into "Choose a username" landed on an invisible
   cursor. **SECOND OCCURRENCE** - `field-classes.ts` exists because FriendLink had it on 09-13.
   Measured in a browser both ways: hand-rolled stays box-shadow `none` through focus, shared goes
   to a 1px gold ring. New repo-wide `focus-visible.gate.test.ts`, proven RED on the REAL defect
   (names UsernameClaim.tsx:159), restored byte-exact, 4 positive controls asserting both
   directions. **The old `field-consistency.test.ts` reads ONE FILE and could never have caught it.**
   **STYLE HALF: DECIDED AND CLOSED AS A RATCHET, NOT A REWRITE.** `control-style-ratchet.gate.test.ts`
   freezes the count at 36 input surfaces / 18 select surfaces; it may fall, never rise. Proven red
   by planting one new surface. **The signature is the SURFACE** - layout utilities stripped, tokens
   sorted - because 36 sounds like 36 designs and is not: almost all are the same
   `bg-secondary border border-border ... text-foreground` differing only in padding and text size.
   **I deliberately did NOT rewrite 87 call sites across the money pages for a cosmetic gain.**
   Lower the ceiling opportunistically when a file is being touched anyway, and set the constant in
   the same commit. Old scoping kept below for the numbers:
   **(historical) the style half:** 42 distinct text-input class signatures across 87 inputs,
   18 across 44 selects, shared constant used by ~38 of 136 controls. Most differ only in
   width/margin over one core, so it is one design hand-copied, not 42 designs. Do it in slices,
   **money pages LAST**, and widen the gate to a ratchet that can only go down.
   ⚠️ **Discover candidates by the ELEMENT, never by the shared constant** - a hand-rolled control
   is exactly the one that does not import it. 2026-09-14 one-switch lesson, and it is why the
   focus gate above found this.

   Original scoping, kept because the numbers are the acceptance evidence:
   ("consistency across tabs", 2026-09-13). MEASURED 2026-09-16, brace-aware matcher:
   **42 distinct text-input class signatures across 87 inputs; 18 distinct select signatures
   across 44 selects.** The shared constant in `src/components/shared/field-classes.ts` is used
   by **12 of 87**. `field-consistency.test.ts` enforces the rule on **ONE FILE** (FriendLink).
   Most variants differ only in width/margin utilities over one shared core - so this is one
   design hand-copied 40 times, not 40 designs. **The deliverable is CONSOLIDATION and the
   COUNT is the acceptance evidence.** Do it in slices, money pages LAST, and widen the gate to
   a repo-wide ratchet that can only go down.
   ⚠️ **Discover candidates by the ELEMENT, never by the shared constant** - a hand-rolled
   input is exactly the one that does not import it. That is the 2026-09-14 one-switch lesson.

5. [ ] **NOT MINE, ROUTED TO SAM:** an untriaged ask "Read scripts/daily-check-prompt.md and follow
   it exactly" landed in this desk's queue. That file exists only in `trading/` - it is **Wes's**.
   Left UNTRIAGED deliberately rather than cleared: clearing it here is how a request silently
   disappears when both desks assume the other has it.


## FIRST UP - 2026-09-15 (Ada, EIGHTH session). THE BOUNCE REMOVAL IS VERIFIED IN A BROWSER.

`1323450a`, on origin/main 0/0 BY CONTENTS. `npm run check:onboarding-stay` is the new gate.
**FIRST UP NEXT TIME: nothing here is mine.** Every queue item below is Tre's or deliberately
deferred - read the queue before assuming there is work, and if he has answered one of his, start
there. The desk closed itself out on Sam's confirmation with NO successor, deliberately: a warm
desk on a repo nobody is working is what the charter warns about.

⚠️ **THE TWO THINGS TO CARRY FORWARD, both now in `~/.claude/rules/common/testing.md`:**
1. **`shouldLeaveOnboarding` HAD NO PRODUCTION CALLER** while carrying six passing assertions - the
   effect restated the rule inline. An extraction done FOR testability is the highest-risk shape
   for this, because extracting and wiring are two steps and only the first has a test watching it.
   **Grep for the caller of anything you have just TESTED, not only of anything you are scoping.**
2. **ARM B OF THE NEW GATE CANNOT BE DRIVEN RED**, and the file says so in its own header. A
   finished account leaves by TWO independent mechanisms (`ProtectedRoute` writes the device cache,
   and Onboarding's FIRST branch leaves on it before the rule is consulted). **Only ARM A is
   evidence about the rule.** Do not "fix" ARM B into looking symmetrical.

## FIRST UP - 2026-09-15 (Ada, SEVENTH session). THE BOUNCE IS REMOVED AND THE EXPOSURE IS CLOSED.

`9a6f1e43` attribution · `40489985` its correction · pdf coverage · `d779ea9d` the bounce removed.
All on origin/main 0/0 BY CONTENTS. Asks closed: `ac098dec`, `0d9f8fae`, `3d6e26a0`, `cebedd1e`,
`c2a7da61`, `0512d777`.

### 1. TRE DECIDED: "remove the bounce" - DONE, `d779ea9d`
It was a MIGRATION for accounts that finished setup on an older surface and never got the flag
written; `display_name` was the tell. **`Auth.tsx:493` sets `display_name` AT SIGNUP**, so the tell
stopped separating legacy from brand-new and new users were skipping setup entirely.
The rule is now the pure export **`shouldLeaveOnboarding`** - it lived in a `useEffect` and so had
never been tested. Proven red three ways including reinstating the real bounce AND a dead gate
returning false for everybody. `legacy_name` retired (33 profiles checked ALL NULL first, so
nothing stored is orphaned); the attribution gate is what caught it was unwired.

### 2. THE REDDIT-SCOUT EXPOSURE IS CLOSED WITHOUT TRE, `3d6e26a0`
The ask said deletion needed a CLI token this machine lacks. **It did not need deletion** - the MCP
has `deploy_edge_function`, so v39 is a TOMBSTONE that reads NO secrets and returns 410.
⚠️ **`verify_jwt: true` WAS NOT THE FIX, AND THIS IS THE PART TO REMEMBER.** It was already on at
v38. **The publishable ANON KEY is a valid JWT for this project and ships in the web client**, so
`verify_jwt` only means "a JWT this project signed". MEASURED after the deploy: anon key -> **410**
(it reached the body), no header -> 401, control function answered normally. Before v39 that reach
hit a body reading ANTHROPIC_API_KEY, RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY behind one
burned header check. Divergence recorded in `supabase/functions/reddit-scout/PRODUCTION-IS-TOMBSTONED.md`.

### RESUME QUEUE - START AT ITEM 1

1. [x] **DONE - THE BOUNCE REMOVAL IS VERIFIED IN A REAL BROWSER.** `npm run check:onboarding-stay`
   (`scripts/check-onboarding-stay.mjs`), a DISCRIMINATING PAIR on the walk account, both arms green:
   ARM A `display_name='Walk Tester'` + `onboarding_completed=false` -> **stays on `/onboarding`**
   with both wizard markers on screen; ARM B `onboarding_completed=true` -> **leaves to `/dashboard`**.
   The profile is restored and the restore is READ BACK. Gates: tsc 0, eslint 0 errors, `test:tz`
   **4,661 tests / 459 files green in all three zones**, `walk:routes` 27/27 + 17 links.
   ⚠️ **AND THE WIRING WAS THE REAL FINDING: `shouldLeaveOnboarding` HAD NO PRODUCTION CALLER.**
   The exported rule carried six passing assertions while the effect held its OWN copy of the same
   condition - a green suite over a function the app never ran, and two copies free to drift. The
   effect now calls the export.
   ⚠️ **ARM B CANNOT BE DRIVEN RED BY MUTATING THE RULE, and that is a fact about the app.** With the
   rule mutated to return false for everybody, ARM B still passed: `ProtectedRoute` mounts
   `useOnboardingStatus`, which writes `forged:onboarding_done_<uid>`, and Onboarding's FIRST branch
   leaves on that cache before the rule is consulted. A finished account leaves by TWO independent
   mechanisms. **Only ARM A is evidence about the rule** - and ARM A was proven RED with the REAL
   pre-fix defect (landed `/dashboard`, 0/2 markers), restored byte-exact by sha256.
   Also measured: a case-SENSITIVE marker match read the wizard as missing, because the field label
   is uppercased by CSS and `innerText` reports the RENDERED case.

2. **`e72a8df4` ROTATE `REDDIT_SCOUT_SECRET` - still Tre's, but it now guards NOTHING.** The
   tombstone reads no secrets, so this dropped from "live exposure" to hygiene. **Do NOT redeploy
   the real reddit-scout body before this is rotated** - that puts three credentials back behind
   the same burned guard.
3. **`a40f1e23` reviewer sign-in** - Ada previously called this the highest-value item in Tre's
   queue. He has now signed into reviewer on localhost, so re-read the ask: part of its premise may
   already be satisfied. **TEST THE PREMISE BEFORE BUILDING.**
4. **`f22f17b1` native iOS - BLOCKED ON TRE, do NOT start Swift** (no Xcode here). A
   `UIVisualEffectView` is a SIBLING of the WKWebView, so below it never sees app content and above
   it covers that surface's own web content; the working architecture needs a SECOND transparent
   WKWebView. Recorded in `CLAUDE.md` under DECIDED.
5. **`7dd28827`** the App Store key is upload-only and needs the Sales and Reports role - Tre's.
6. **`798c0ed9`** leaderboard freshness: deliberately deferred with a stated trigger (real
   participation, or the bucket functions extracted somewhere both runtimes import). Trigger has
   NOT fired at 1 sharing user. Not work.

### THINGS THAT COST ME TIME - READ BEFORE REPEATING THEM

- **THE SHELL MANGLES BACKSLASHES IN HEREDOCS, three separate times this session - INCLUDING IN THIS VERY SENTENCE, whose escape was eaten on the first write.** A JS `\b (word boundary)`
  became a literal BACKSPACE (0x08) inside a regex, and the gate reported **PASS** while hunting a
  string that cannot occur. **"non-ASCII: 0" did not catch it because 0x08 is BELOW 127.** Scan for
  CONTROL characters, build escapes from explicit codepoints, and prefer line-index edits.
- **A GATE THAT FINDS CANDIDATES BY THE FUNCTION NAME IS BLIND TO THE PATH THAT DOES NOT CALL IT.**
  `handleFinish` writes `onboarding_completed` DIRECTLY - the one path that means somebody really
  onboarded - and my first gate could not see it.
- **`--reporter=basic` DOES NOT EXIST in this vitest.** Both arms of a mutation died at startup and
  the "red" was the harness, not the test.
- **`$?` AFTER A PIPE is the last command's status.** `npx tsc --noEmit | tail` reported 0 over real
  errors.
- **A hand-bolted `/Encrypt` entry is NOT an encrypted PDF** - pdf.js ignored it and parsed happily,
  so that test passed for the wrong reason until it was checked.

## ⇢ FIRST UP — 2026-09-15 (Ada, FIFTH session). ITEMS A AND B ARE BOTH SHIPPED.

`3ebf4d79` the friend_links grant + a real-PostgREST gate · `2e562f10` the Account-tab IA
reconciliation. Both on origin/main 0/0 BY CONTENTS. Asks closed with evidence: `6a85c2cd`,
`ad4f33ab`, `c4cdcc58` (all three thirds).

### A. ✅ THE FRIENDS CARD — ONE MISSING COLUMN GRANT, AND NO TEST HERE COULD SEE IT
`invitee_username` was added on 2026-09-15 by a migration that did not extend the column-scoped
SELECT grant from `20260826_friend_links.sql`. `cc8aecb1` put it in the hook's select list, so
every signed-in user's own read answered 403/42501. **Confirmed before fixing**: 8 granted columns
against the hook's 9.
⚠️ **THE HYPOTHESIS IN THE PREVIOUS HANDOFF WAS EXACTLY RIGHT** — recorded because a confident
un-run hypothesis is usually the thing that wastes a session, and this one saved one.
⚠️ **AND VERIFYING IT BY SQL WOULD HAVE LIED.** Every SQL tool here runs as service_role and
bypasses column grants entirely. `set local role authenticated` DOES enforce them (proven by a
control: `invite_code_hash` still 42501 under the switch), but the page is what settled it.
**New gate `npm run check:friend-read`**, wired into package.json: signs in with a real JWT,
DERIVES the column list from `useFriendLink.ts`, performs that exact read, requires a 403/42501 on
`invite_code_hash` as a positive control, and then opens /account, presses Profile and asserts the
error text ABSENT *and* the card PRESENT with every `friend_links` response 200.
Proven red with the real defect class (`revoked_by` in the list): 403/42501 and the live page
showing "Could not load your friends." with statuses `[403,403]`.
⚠️ **TWO INSTRUMENT TRAPS MEASURED WHILE BUILDING IT.** The card's "Friends" heading renders WHILE
THE QUERY IS IN FLIGHT, so waiting on text measured the loading state and recorded ZERO reads —
indistinguishable from a denial. And **demo mode disables this query outright** (`enabled: !isDemo`),
so a demo run shows "Loading..." for ever and measures nothing; the flag is cleared and then
ASSERTED off.

### B. ✅ `c4cdcc58`'s LAST THIRD — ONE MOUNT, AND THE INVITE LINKS STILL LAND
The saved patch is applied and deleted. `PartnerLink`/`FriendLink` now render on `/account` only;
Settings keeps a pointer card and **redirects `/settings?friend_code=…` to `/account` carrying the
search string**, because those URLs are in already-sent emails and invites last 7 days.
**The IA gate was RE-STATED, not weakened**: `settings-ia.ts` gained `ACCOUNT_PAGE_ONLY`, and the
gate asserts exactly-one-on-`/account` AND zero-in-Settings. Deleting the two map entries would
have gone green and declared nothing.
**THE PRE-FILL IS PROVEN END TO END FOR THE FIRST TIME** — it could not be until A was fixed:
with the persisted section parked on `leaderboard`, `/settings?friend_code=PROBE-CODE-1234` landed
on `/account?friend_code=PROBE-CODE-1234`, section `["Profile"]`, input value `PROBE-CODE-1234`.

Gates on `2e562f10`: tsc 0, lint **0 errors / 34 warnings**, `test:tz` **4630 ×3 zones over 456
files** (up 4, exactly the tests added), `walk:routes` 27/27 + 18 link targets declared,
`check:account` PASS, `check:friend-read` PASS.

### C. ✅ `25de22e9` / `98830520` item 1 — THE TWO NAVIGATIONS WERE DIFFERENT SETS, `1df1e5bf`
Measured: the rail declared **7** destinations against the phone bar's **5** — three desktop-only
(`/ai`, `/settings`, `/premium`), one mobile-only (`/account`), and two shared destinations with
DIFFERENT LABELS at different widths.
**Fixed BY CONSTRUCTION**: new `src/lib/primary-nav.ts` is mapped by both components, so they
cannot drift. ⚠️ **A test comparing two hand-declared lists had already been tried here and
failed** — `nav-routes.test.ts` never read the rail, so Forecast existed twice for days.
⚠️ **REACHABILITY WAS CHECKED BEFORE REMOVING ANYTHING**: `/settings` is linked from Account
(now in the list at both widths), `/premium` has 17 in-app links including every `PremiumGate`,
`/ai` is mounted inline in Account's Forgenta AI section and had ZERO in-app links besides the rail
row. **Upgrade is now less prominent on desktop** — stated, not hidden; it is the trade the ask
asks for, and mobile has always been on the other side of it.
**Two existing gates went red and were RIGHT to**: `nav-no-redirect-targets`'s blind-scan assertion
caught that it had nothing left to read, and `Sidebar.iconOnlyNames` hand-named five labels. Both
repointed at the shared list rather than relaxed.
`7a19ac46` is closed too — it was the NEEDS-TRE half, and his clarification removed the need.

### ⇢ RESUME QUEUE — START AT ITEM 1

1. **`f05b9c82` THE REMAINING LEADERBOARD STATS — TAKEN, MEASURED, NOT BUILT. START HERE.**
   **THE ENUMERATION HE ASKED FOR IS DONE: exactly ONE of the four renders "not ready" —
   `debt_payoff`.** `UNSOURCED_METRICS` in `src/lib/leaderboard-metrics.ts` holds only that one;
   `budget_adherence` was wired on 2026-09-15. Confirmed against the live database with a positive
   control in the same read (56 public tables, so a zero is a real absence): `leaderboard_snapshots`
   holds rows for `savings_streak` (2), `goal_progress` (2), `budget_adherence` (1), latest week
   2026-09-14 — **and none for `debt_payoff`.**

   ⚠️ **A PREMISE IN THAT FILE IS FALSE, AND I WAS CUT OFF BEFORE MEASURING THE REPLACEMENT.**
   Its header says *"no table in `public` matches `%balance%` or `%statement%`"*. Four do:
   `accounts`, `debts`, `liabilities`, and crucially **`account_reconciliations`**, whose columns
   are `user_id, account_id, source_table, effective_date, actual_balance, projected_balance` —
   **a DATED, PER-ACCOUNT BALANCE HISTORY, which is exactly what `debt_payoff` was recorded as
   lacking.**
   ⚠️ **DO NOT BUILD ON IT YET.** The read that settles it is one query, and it is unrun:

       select source_table, count(*), count(distinct user_id), count(distinct account_id),
              min(effective_date), max(effective_date)
       from public.account_reconciliations group by source_table;

   **Cash accounts only → the original refusal stands**, and `debt_payoff` needs balance capture
   built before the metric. **Rows covering CARDS → the metric is buildable today**, and the
   header's refusal (plus its correct warning that `net_worth_snapshots.total_liabilities` includes
   the car loan and would inflate the score) must be REWRITTEN with the measurement, not deleted.
   **Either way: dropping a metric from `UNSOURCED_METRICS` and wiring it is ONE commit**, or a
   switch appears in front of somebody with nothing behind it. And his bar stands — a stat that
   cannot be computed honestly gets NO TILE, never a zero.

2. `1a805cf2` the AI advisor into the Account tab after the Leaderboard section. ⚠️ **Re-measure
   the premise first**: `AiAdvisor` is ALREADY mounted in Account's `ai` section and `/ai` is no
   longer a rail row (`1df1e5bf`), so this may be largely done — grep before building.
   `AI_ADVISOR_ENABLED` must be shown still holding; if there is no real gate, say so as a finding.
3. `f22f17b1` native iOS material. Tre OVERRULED the recommendation: "I want native iOS material."
   The cost is that a native view is a SIBLING of the WebView, so every glass frame crosses the
   bridge on every scroll/resize/rotation.
4. `e72a8df4` rotate the reddit-scout webhook secret, `3d6e26a0` delete the edge function — both
   NEEDS TRE, both still open, both live exposures rather than tidying.

---

## ⇢ FIRST UP — 2026-09-15 (Ada, second session). Two commits, both on origin/main 0/0 BY CONTENTS.

`2f45062c` the leaderboard pair · `0d2152c4` self-on-board + the sidebar overflow + a widened gate.
Everything below was exercised on **his own localhost, signed in as tre@treforged.com, READ ONLY**
before it was committed — his standing rule.

### DONE, with the measurement that settled each
| ask | what it actually was |
| --- | --- |
| `a0328857` | ✅ `4b217aea` DUPLICATED rather than moved: `FriendLink` kept its own `FriendsLeaderboard` mount and `FriendLink` renders inside Account's **Profile** section. One mount now. Live: Profile has no global card, no "Week of". Sam independently confirmed on the running app |
| `a6c2de42` | ✅ TWO defects. (1) rows were gated behind `!empty`, so a user WITH friends and nothing published saw a sentence and no board. (2) **the board was built from `friends` alone, so it could place everyone except the reader** — his shares row and his snapshot both existed for the exact metric and week on screen. Live now: `You 5%` / `Tre Private` |
| `98830520` items 2,3,4 | ✅ **ONE BUG, and the arithmetic proves the link**: nav rows sized content by the `collapsed` FLAG while the rail sized itself by CSS, so at rest on a mouse the badge ran to 80.3px against a rail ending at 72 — and the nav reported exactly 9px of horizontal overflow. Plus two further 2px overflows on the rail ROOT (the header's 83-in-71, and the dot escaping its own 16px wrapper) |
| `98830520` item 5 | ➖ MOOT, said rather than dropped: his fix was to put the bolt inside the Debt highlight. The bolt is no longer rendered at all in the narrow rail, so there is nothing to move |

### ⚠️ STILL TRE'S, AND IT CANNOT BE GUESSED — `7a19ac46`
**`98830520` item 1: which desktop sidebar SECTION does not match the mobile page?** He is at
localhost and can point in one gesture. Mobile is the REFERENCE — do not reconcile by changing it.

### ✅ THE GATE'S UNPROVEN HALF — `196f5929` — CLOSED 2026-09-15 (FOURTH session)
**This section was the SECOND session's, and it was wrong in both of its claims.** Kept and
corrected rather than deleted, because the wrong diagnosis is the useful half.
It said the numeric badge was unexercised *because the walk account's review queue is empty*, and
that the fix was to *seed a review-queue row*. Both are false: `/demo` renders a real badge (“48”)
with no credentials and no database write, and the badge was unreachable **by construction** — it
renders only in the OPEN rail, which the width loop skips, and `escapedBadges` walks
`span.relative` children, which the count does not have. **A gate that cannot see a thing and an
account that has no data look identical from the outside.**
Closed by the `demo numeric badge pass` in `check:rail`, proven red both ways. Full detail at
queue item 4 below; the per-cell `numeric badge ABSENT (not exercised)` print stays, because ABSENT
at 72px is correct behaviour rather than missing coverage.

### ⚠️ MY OWN GATE POISONED ITS OWN NEXT RUN, AND IT WAS GREEN THROUGHOUT
`check:username` seeded a handle and cleared it in a trailing line, so **cleanup ran only on the
SUCCESS path** — and each leftover spent one of the account's two-per-week allowance. After two,
the account cannot change its username for seven days and the gate fails for a reason unrelated to
the code.
**And the teardown I added to fix it was defeated by the feature it tests**: `username_changes` has
no DELETE policy (deliberately — a user who can delete their own history defeats the limit), so the
DELETE silently affected zero rows, and the reset-to-null was REFUSED as a third change. **Both
calls returned without error and neither did anything.** The gate now writes NOTHING; the walk
account keeps `@walkprobe` permanently. Proven by a RED run followed by a GREEN one and then reading
the database back: history_rows 0. Fixed in `0f0…` (see `git log`).

### ⚠️ FOUR INSTRUMENT LESSONS FROM THIS SESSION
* **A TEST ASSERTED THE DEFECT AND PASSED FOR DAYS.** `"says nobody is sharing, rather than drawing
  an empty table"` REQUIRED the friend's name to be absent — enforcing exactly what Tre reported as
  broken, and contradicting two headers in the source it was testing.
* **THE REACHABILITY SUITE COULD NOT HAVE CAUGHT THE DUPLICATE**: it stubs `FriendLink` out, and the
  duplicate lived inside the real `FriendLink`. The new file renders the REAL card, and pairs the
  absence with a POSITIVE CONTROL on the same marker — "not in Profile" and "this test cannot find
  the board anywhere" are otherwise the same green.
* **`element.matches(':hover')` READ TRUE WHILE THE `:hover` WIDTH RULE HAD NOT APPLIED.** A CDP
  hover made the rail report 72px and I nearly recorded "hover expansion is broken". Playwright's
  real hover reads **234px** with all 9 labels. Use `check:rail` for that question, not in-page JS.
* And `waitFor(rows).toHaveLength(2)` returns INSTANTLY here — rows are built from the participant
  list before the query resolves. Wait on the VALUE.

### `23c07655` USERNAME CHANGES — ✅ DONE, `9635c38e`
No duplicate existed: `a43f10fc` was the CLAIM form and is genuinely finished. **The first finding
was that there was NO WAY TO CHANGE A HANDLE AT ALL** — read-only once claimed — so a limit alone
would have been a gate in front of a wall. The limit is a **Postgres trigger**, because
`20260913_profile_usernames` grants `update (username)` to every authenticated user and a handle can
be PATCHed straight to PostgREST without the app running.
**Its acceptance probe found three defects before any reached a user**, all recorded in the
migration headers: `23502` on clearing a handle, a **clear-and-reclaim bypass my own "first claim is
free" rule opened**, and `to_char(...,'OF')` emitting `+00`, which ECMA-262 cannot parse — so every
refusal arrived as `Invalid Date` and lost the unlock time, the exact half he asked for.
New gate `npm run check:username`, proven red on the TRUE pre-fix code. ⚠️ It does NOT exercise the
limit itself (three real changes would leave a week-long lockout on the walk account); the trigger is
proven against the live database instead.

### QUEUE CLEARED OF WHAT WAS ALREADY TRUE — 7 asks closed with evidence at the end of the session
`e73b2da6` self-row · `0536fb3c` the contradicting sentence · `98830520` (items 2/3/4 fixed, 5 moot,
**item 1 carried as `7a19ac46`**) · `b33ba840` the dev server · `32f41119` / `f885d016` notices ·
`c099afe3` the Reddit Scout question · `26cdb035` the two sign-in answers.

**`c099afe3` — HIS RECOLLECTION WAS RIGHT, and the answer came from the scheduler rather than from
anyone's memory:** `cron.job` holds **8 active jobs and none is reddit**, with a positive control in
the same read (the query CAN see `cron.job`, 8 rows named) so the zero is a real absence.
⚠️ **TWO THINGS SURVIVE THAT THE DELETION DOES NOT FIX:** `supabase/functions/reddit-scout/index.ts`
is still in the repo and still deployable (filed as `2e52390b`), and **the webhook secret is still
BURNED** — it sat as plaintext in `cron.job.command` where any DB reader could see it, and deleting
the job does not unburn an already-exposed secret. So `e72a8df4` (rotate it) is NOT satisfied by the
jobs being gone.

**`26cdb035` — the sign-in answer, and this session proved the shape:** *"In Chrome, sign in at
localhost:8080 as the reviewer account once and leave the tab open — I drive it read-only from
there."* Tonight I drove his PERSONAL Chrome session read-only for the whole session without ever
touching a password. One tap, not a task. `a40f1e23` stays open because the tap is his.

### ⚠️ A COMMITTED GATE WAS RED ON MAIN AND NOBODY HAD RE-RUN IT — fixed, `d05ef59a` closed
`check-mobile-squeeze` was FAILING on origin/main over **the exact element its own comment declares
out of scope**. The multi-column-grid exemption was written for "above floor / monthly burn" by name
and **could never fire for it**: the walk-out loop stops at the first full-width ancestor without
testing it, and on /dashboard that ancestor IS the two-column grid.
**The control that separates "fixed" from "blinded"** — with the exemption disabled the detector
immediately finds the tile again, same numbers, exit 1. So the measurement is intact.
⚠️ **AND WHAT I COULD NOT PROVE, stated rather than implied:** re-proving it against the ORIGINAL
2FA defect failed — removing `min-w-0` PASSED, because `39fe3c3e` moved the button under the text so
that property is no longer load-bearing. Reproducing the real defect needs the beside-the-text
layout back. The evidence is the exemption control, not a re-proof.
⚠️ **Its first run after ANY source edit reliably exits 2** ("only 8 text-bearing elements") while
Vite recompiles. Correct behaviour — it refuses to call a half-rendered page clean — but it wastes a
run every time and should wait on content rather than a timeout. Same family as the sleep I removed
from `check:username`.

### `6eeb8fe3` REMOVE ADD-BY-EMAIL — MEASURED, NOT STARTED. Start here.
Stopped at the 5h cap before writing code, so **nothing is half-done**. What is already measured
against the live database, so the next session does not pay for it again:

| fact | value |
| --- | --- |
| `friend_links` rows, total | **1** |
| accepted, unrevoked | **1** (Tre's own link) |
| **live pending EMAIL invites** | **0** — so removing the path strands nobody |
| rows carrying an `invitee_email` | **1** |
| people with a username | **2** |

The email surface to remove: `invite` action in `useFriendLink.ts:249`, `invitee_email` on the
`FriendLinkRow` type and its select list, the pending-invite card in `FriendLink.tsx`, the email
field, the `friend-link` edge function's `invite` action — and the INDEX
**`friend_links_one_pending`**, which is `btree (inviter_id, lower(invitee_email))`. That index is
literally the "does this address have an account" lookup his ask is about.

⚠️ **THE COLUMN DROP IS THE ONE IRREVERSIBLE STEP, and it holds a real person's address.** His ask
is explicit that hiding the field while keeping the column is not what he wants, so it should go —
but **snapshot the row into a locked-down backup table first and then drop**, the pattern this
repo already used for the §1 table rename. Verify the snapshot by reading it back AFTER the drop,
not before: a backup verified only at write time is verified against the moment nothing had
happened yet.
**Privacy line for the commit body, from his ask:** an email lookup lets anyone test whether a
given address has an account.

### NEXT, after that
1. ~~`6eeb8fe3`~~ (above) remove add-friend-by-email, usernames only — remove the STORAGE and INDEX too.
   Privacy line for the commit body: an email lookup lets anyone test whether an address has an
   account.
3. `f05b9c82` the remaining leaderboard stats. ENUMERATE how many render "not ready". A stat that
   cannot be computed honestly gets NO tile, never a zero. Note `isMetricSourced` currently offers
   only goal_progress and savings_streak while all four are enabled in the DB — Sam flagged it and I
   read it as the guard doing its job.
4. `1a805cf2` the AI advisor into the Account tab AFTER the Leaderboard section. The leaderboard
   split is now clean, so this is unblocked — but **`AI_ADVISOR_ENABLED` must be shown still
   holding**, and if there is no real gate, SAY SO as a finding rather than assuming one exists.
5. `f22f17b1` native iOS material. **Tre OVERRULED the recommendation: "I want native iOS
   material."** Capacitor plugin + native build; the cost is that a native view is a SIBLING of the
   WebView, so every glass frame must cross the bridge on every scroll/resize/rotation.

---

## ⇢ FIRST UP — TRE IS AT HIS SCREEN, IN CHROME, WAITING (2026-09-15, handed over mid-task)

**Do this before anything else.** He is showing defects on his own localhost:8080 and the
predecessor was cut by the handoff gate one call into attaching.

1. **Attach to Chrome.** ONE ToolSearch call:
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__get_page_text`
   then `tabs_context_mcp` FIRST. **Measured a moment ago: the MCP group held exactly ONE
   tab, `chrome://newtab/` (tabId 1527590848) — his own tab is NOT in the group**, so open
   or use your own and never navigate one he is looking at. Say which tab you are on.
2. **DO NOT START A DEV SERVER.** `localhost:8080` is already live (his words, via Sam).
3. ⚠️ **THAT BROWSER IS SIGNED IN AS HIS PERSONAL ACCOUNT, not the reviewer.** Everything
   you see is HIS real money until he says he switched. **"no friends on this account" and
   "the section is broken" look identical from outside** — check WHICH ACCOUNT before
   concluding anything about an empty leaderboard. Read only; mutate nothing.

### His six, in Sam's order
| id | what |
| --- | --- |
| `a6c2de42` | the friends leaderboard is not showing; should be its own section INSIDE Leaderboard. Unreachable / empty / erroring are three different defects — prove REACHABILITY first |
| `a0328857` | leaderboard content is ALSO appearing in the Account section — a regression against `4b217aea`; the move may have DUPLICATED rather than relocated. Assert BOTH directions: present in Leaderboard, **ABSENT** from Account |
| `23c07655` | username changes: twice per rolling 7 days. He says he asked before — FIND the earlier ask and close it rather than filing a duplicate. The real test is the THIRD attempt in the window, and the refusal must say when it unlocks |
| `6eeb8fe3` | remove add-friend-by-email, usernames only. Remove the STORAGE and INDEX too — hiding the field while keeping the column is not what he asked. Privacy win for the commit body: an email lookup lets anyone test whether an address has an account |
| `f05b9c82` | finish the remaining leaderboard stats. ENUMERATE how many render "not ready". A stat that cannot be computed honestly gets NO tile, never a zero |
| `f22f17b1` | ⚠️ **TRE OVERRULED THE RECOMMENDATION: "I want native iOS material."** The CSS estimate said don't; he said do. It needs a Capacitor plugin + native build, and the cost is that a native view is a SIBLING of the WebView, so every glass surface's frame must be pushed across the bridge on every scroll/resize/rotation. Behind the five above |

### `1a805cf2` — THE AI ADVISOR MOVES INTO THE ACCOUNT TAB, AFTER THE LEADERBOARD SECTION
His words: *"that AI advisor that's only for localhost right now, that's going to go into
the profile tab um, after the leaderboard."* Section order becomes: the existing account
sections, then Leaderboard, then AI Advisor.
**SEQUENCE IT BEHIND `a0328857` AND `a6c2de42`** — placing it now means positioning against
a layout that is about to change.
⚠️ **IT IS LOCALHOST-ONLY TODAY AND GIVING IT A HOME MUST NOT SHIP IT.** `AI_ADVISOR_ENABLED`
gates the `/ai` route in `src/App.tsx` — find where that flag comes from, keep it, and SHOW
in the commit that it still holds. **And if it turns out there is no real gate — if
"localhost only" is an accident of how it is currently reached — SAY SO as a finding rather
than assuming one exists.** That is larger work, and this feature talks to users about their
money.

### AND `98830520` — FIVE MORE ON THE DESKTOP SIDEBAR. `47239c60` was closed TOO EARLY.
Same surface, seen properly on his screen. Mobile is the REFERENCE for item 1 — do not
reconcile by changing mobile.
1. the desktop left sidebar's SECTIONING must match the mobile-sized page. **Ask him which
   section he means rather than guessing** — he is at localhost and can point.
2. a horizontal SCROLL BAR appears bottom-left when the sidebar is CONDENSED.
3. the NOTIFICATION NUMBER on Transactions must stay visible when compressed.
4. the LIGHTNING BOLT beside Debt is "cut off partially kind of weirdly" when compressed.
5. **his own fix for 4, and try it first because it is cheap:** the Debt item already has a
   highlight around it; putting the bolt INSIDE that highlight should sit it correctly.

⚠️ **2 AND 4 ARE PROBABLY ONE BUG** — a glyph or badge overflowing the 72px rail clips the
glyph AND produces the horizontal scrollbar. Check that before fixing them as two things,
and say so if it is one: this portfolio has a recorded case of two fixes raising a count.
**ACCEPTANCE is geometry, not a look:** frames at desktop and iPad in BOTH states, asserting
the badge and bolt are fully INSIDE their container by measurement, plus
`scrollWidth == clientWidth` so the scrollbar cannot come back silently. `npm run check:rail`
is the harness to extend — it already measures clipping past the rail's edge at both widths
and already carries the two traps (blur focus first, or `focus-within:w-52` holds the rail
open; read wrapping from each element's own line-height, not a ratio against neighbours).
Concentricity applies to the bolt-inside-highlight change: r_inner = r_outer − gap, only
where gap < r_outer.

Also untriaged and NOT this desk's: *"Put the link to my C5 build right under the car image
on my website"* — that is **treforgedwebsite (Ellis)**. Route it; do not build it here.

### Shipped this session, all on origin/main 0/0 by CONTENTS
`38725a19` route walk · `e445b0ca` sidebar · `31769d45` glass · `4b217aea` Account
sections · `39fe3c3e` the 2FA banner squeeze. Five new gates, every one proven RED first:
`walk:routes`, `check:rail`, `check:glass`, `check:account`, `check-mobile-squeeze.mjs`.



## ⚠️ FIRST UP — 2026-09-15 (Ada, FOURTH session). A LIVE BREAK IS ITEM A. READ IT FIRST.

Shipped today and on origin/main 0/0 by contents: `8f683f56` friend-link v10 + the capability line,
`5449b8f4` the rail badge gate, `359b93d2` the segmented control's one shape, `621bf96e` the
dashboard quick look, `dfa3104a` this file. Asks closed with evidence: `6eeb8fe3`, `196f5929`,
`b9fe1d41`, `30c2df81`. Gates on the last green commit: tsc 0, lint **0 errors / 34 warnings**,
`test:tz` **4626 ×3 zones over 456 files**, `walk:routes` 27/27, `check:rail` and `check:account`
PASS.

### A. `6a85c2cd` — THE FRIENDS CARD IS BROKEN FOR EVERY SIGNED-IN USER. FIX THIS BEFORE ANYTHING ELSE.
**Measured in a real browser, signed in, against the production database.** `/account` → Profile
renders **“Could not load your friends.”** with a Try again button. The client's own PostgREST read

    GET /rest/v1/friend_links?select=id,inviter_id,invitee_email,invitee_username,…
    403  {"code":"42501","message":"permission denied for table friend_links"}

fires twice. **THE EDGE FUNCTION IS NOT THE PROBLEM** — a direct signed-in call to `friend-link`
`action:"status"` returned `200 {"friends":[],"pending":[]}` in the same session. This is
`useFriendLink`'s DIRECT read.

**HYPOTHESIS, NOT CONFIRMED — the SQL was blocked by the handoff gate before it ran.**
`invitee_username` was added on 2026-09-15 and the hook's select list was extended to include it in
`cc8aecb1`; the column-level GRANT on `friend_links` for `authenticated` was probably never
extended to the new column, and Postgres answers `42501` for a column the role does not hold.
**Confirm before fixing:**

    select grantee, privilege_type, column_name from information_schema.column_privileges
    where table_schema='public' and table_name='friend_links'
      and grantee in ('anon','authenticated') order by 1,2,3;

then diff it against the select list in `src/hooks/useFriendLink.ts`.
⚠️ **VERIFY THE FIX BY OPENING THE PAGE, never by re-running the query yourself** — the MCP SQL
tool runs as **service_role**, which bypasses column grants and would report clean over a card that
is still broken for every user.
⚠️ **WHY NOTHING CAUGHT IT: no test in this repo performs a real PostgREST select.** `cc8aecb1`
shipped green — 4614 tests, tsc 0, lint 0 — over a card broken for everybody. Consider whether the
fix should carry a check that actually reads the table as `authenticated`.

### B. `c4cdcc58`'s LAST THIRD — THE SLICE IS WRITTEN AND IT IS RED. `ia-slice-NOT-COMMITTED.patch`
**The duplication is real and measured**: `PartnerLink` and `FriendLink` render on **BOTH**
`src/pages/Account.tsx` (section `profile`) and `src/pages/Settings.tsx` (panel `account`) — the
same duplicated-rather-than-moved shape `a0328857` fixed for `FriendsLeaderboard`. Two live copies
of an invite form each keep their own pending-invite state.

**I wrote the fix, gated it, and it went RED, so I did NOT commit it.** The diff is saved at the
repo root as **`ia-slice-NOT-COMMITTED.patch`** (146 lines, `git apply` it) and the working tree is
back to green. What it does: removes the Settings copy, leaves a pointer to `/account` in its
place, **redirects `/settings?friend_code=…` to `/account` keeping the search string**, and makes
Account force its section to `profile` when an accept param is present.

⚠️ **THE REDIRECT IS LOAD-BEARING AND IS ALREADY PROVEN TO WORK.** Invite emails mail
`${APP_URL}/settings?friend_code=…` and an email cannot be edited after it is sent; invites last 7
days. Measured with the persisted section parked on `leaderboard` first: the redirect lands on
`/account?friend_code=…` and the Profile segment becomes selected. **Do not drop that half.**

**THE 6 FAILURES ARE TESTS ASSERTING THE OLD IA, and updating them is the rest of the job:**
`Settings.securityControls.test.tsx` (3 — Partner Link / Friends render under the Settings Account
tab), `useFriendLink.test.tsx` (1 — “is mounted in Settings beside the partner card”), and
`settings-ia.gate.test.ts` (2 — “declares nothing twice, and nothing that no longer renders”,
“keeps the three moves Tre asked for”). **That last gate is the interesting one: read it before
changing it — it exists to stop exactly this kind of edit, so satisfying it must mean re-stating
the IA, not weakening the gate.**

⚠️ **AND DO A. FIRST.** The pre-fill could not be verified end to end because the friends card is
throwing 403 — the code field never rendered. The redirect half is proven; **the pre-fill half is
NOT**, and it cannot be until A. is fixed.

## Resume queue — 2026-09-15 (Ada, THIRD session). ORDERED. Each item is a POINTER, not a report.

0. **`c4cdcc58` TRE-APPROVED IA PASS — TWO THIRDS DONE, `621bf96e`. START HERE.**
   His ask was three things in ONE pass: *generalize the categories*, *make the dashboard a quick
   look*, *push detail to where it belongs* — **and reconcile it with the Account tab IA.** The
   first three shipped; **the Account tab reconciliation has NOT been started.**

   **WHAT SHIPPED, and why it touched no data.** A DISPLAY rollup: `rollUpByGroup` in
   `src/lib/types.ts` folds a `byCategory` breakdown into the six `CATEGORY_GROUPS`, and the
   dashboard leads with those instead of 8 of 26 categories. **No category deleted, no row
   rewritten, no migration** — which is what lets his own caution (reducing the SET rewrites rows
   on every account; keep the 7 unused ones without evidence beyond a three-user sample) cost
   nothing. Undo is deleting one memo and its two call sites.

   ⚠️ **THE OBVIOUS IMPLEMENTATION WOULD HAVE LOST MONEY ON SCREEN.** `byCategory` is **not**
   keyed only by `CATEGORIES` — the expense model mints its own keys, and /demo carries
   **`Auto Loan Interest`**, in no `CATEGORIES` entry. A rollup that walked `CATEGORY_GROUPS` and
   summed each group's categories would have **dropped it from the on-screen total** while every
   “groups cover categories” test stayed green. Found by reading the live breakdown, not the type.
   `rollUpByGroup` maps by NAME, with an explicit synthetic table and a real group for anything
   unrecognised; the total is asserted equal to the flat total.

   ⚠️ **TWO DEFECTS CAME OUT OF A RENDERED FRAME AND NOTHING IN THIS REPO COULD HAVE SEEN
   EITHER**: `CategoryIcon` is keyed by CATEGORY, so every GROUP row drew a `···` fallback glyph;
   and three rows replacing eight left the card **half blank** beside its taller sibling
   (`items-start`). Both were invisible to tsc, lint and 4626 tests.

   **Pressed, and the press asserts a CHANGE**: 3 rows → 12, `aria-expanded` false → true, and
   `Auto Loan Interest` — the exact key the naive rollup would have dropped — present in the
   detail. Reds proven both ways with byte-exact restores. Gates: tsc 0, lint 0/34, `test:tz`
   **4626 ×3 over 456 files** (up 8, exactly the tests added), `walk:routes` PASS 27/27.

   **NEXT, and it is the unstarted third**: reconcile with the **Account tab IA**. Read
   `src/pages/Account.tsx`'s section bar (Profile / Leaderboard / Forgenta AI) against what the
   dashboard now shows, and decide what belongs where. **Do not close `c4cdcc58` until that is
   done** — it was approved as one pass and closing it on the two easy thirds is the shape this
   file keeps warning about.

**On origin/main 0/0 by contents.** Today, in order: the `founder_waitlist` answer, the
`reddit-scout` exposure, `budget_adherence` wired, Forgenta AI as a gated Account section, item 6's
premise disproved, item 8's inventory, and the friends usernames-only removal.
Gates on the last commit: tsc clean, lint **0 errors / 34 warnings** (unchanged all day),
`test:tz` **4614 x3 zones over 454 files** — UP from 4604 this morning, and the rise is exactly the
tests added.

1. ~~**DEPLOY `friend-link`**~~ ✅ **DONE 2026-09-15 (Ada, FOURTH session) — version 10 is live, and
   `6eeb8fe3` IS NOW COMPLETE.** The server half was the last open piece; the empty-state copy that
   the previous session left undone on purpose shipped with it.

   **Verified BY CALLING the deployed function**, signed in as the walk account, three cases chosen
   to discriminate rather than to pass:
   | case | result |
   | --- | --- |
   | control — `status` | **200** `{"friends":[],"pending":[]}` — the function is alive and answering |
   | `{"action":"invite","email":…}` | **400** `Invalid discriminator value. Expected 'invite_username' \| 'accept' \| 'status'` |
   | `{"action":"invite_username","username":"zzz-no-such-handle-zzz"}` | **404** `No account with that username.` |

   **The 400 body is the assertion, not the status.** It ENUMERATES the actions the deployed schema
   accepts and `invite` is not among them — a bare 400 would have been satisfied by any malformed
   body. And the 404 proves `invite_username` still DISPATCHES and reaches the `profiles` resolver:
   a schema rejection would have returned the discriminator message instead.

   ⚠️ **THE DEPLOY TAKES SIX FILES, NOT THE TWO THIS QUEUE NAMED.** A deploy replaces the whole
   bundle, so `_shared/cors.ts`, `_shared/rate-limit.ts`, `_shared/tracer.ts` and
   `friend-link/invite-code.ts` must go up too or the function loses its own imports. The two named
   here were only the two that DIFFERED. Derive the list from what is deployed
   (`get_edge_function`), never from a sentence.

   ⚠️ **THE CLI CANNOT DEPLOY FROM THIS MACHINE** — `supabase functions deploy` exits
   `LegacyPlatformAuthRequiredError`, no `SUPABASE_ACCESS_TOKEN` anywhere and no stored credential.
   The MCP tool is the only route, and it needs every file's contents inline.

   ⚠️ **DEPLOYED `index.ts` IS NOT BYTE-IDENTICAL TO LOCAL, AND THE DIFFERENCE IS THREE COMMENTS.**
   Read back and compared file by file: **5 of 6 byte-identical**, `index.ts` differs by **1 byte**
   across three `// ── …` separator rules (`Shared reads`, `Actions`, `Entry point`) where the
   hand-transcribed copy miscounted box-drawing characters. **Zero semantic difference — every
   difference is inside a comment.** Recorded HERE because the next session that diffs deployed
   against local will otherwise read it as a stale deploy and redeploy for nothing. Not corrected,
   deliberately: a second live deploy of a working function to fix three dashes is the riskier move.

   ⚠️ **WHAT THE CALLS DID NOT EXERCISE**, said rather than implied: the walk account has no
   pending invites, so `status` returned `pending: []` and the **disclosure fix** — `pending` rows
   carrying `invitee_username` instead of `invitee_email` — is proven only by the source diff and
   by the unit tests, never by a live row. Exercising it needs a real pending invite, which sends
   real mail to a real person.

   **AND THE SCREEN NOW ADMITS WHAT THE PRODUCT LOST.** `FriendLink.tsx` says *"They need a
   Forgenta account and a username. You cannot invite someone who has not signed up yet."*
   **It is ALWAYS on, not only in the empty state** — somebody who already has one friend is the
   person most likely to go looking for the email field. Test:
   `FriendLink.inviteByUsername.test.tsx`, which renders twice, with a friend present the second
   time and a positive control asserting that friend really rendered.
   **Proven RED by the mutation that a reviewer would have approved** — the note gated on the empty
   state, inside a fragment so it still compiles: **1 failed | 4 passed**, and the failure is mine.
   ⚠️ My FIRST attempt at that mutation put the `<p>` beside an existing element inside
   `{cond && (…)}`, which is a JSX parse error — `Tests no tests`, exit 1. **That red proved
   nothing**; it is instrument trap #2 at the bottom of this queue, hit while trying to obey it.

2. **`6eeb8fe3` — THE DB HALF IS REFUSED, WITH EVIDENCE. Do not re-open it on the brief's say-so.**
   `invite_username` (`friend-link/index.ts:305`) resolves the handle to the target's email and
   calls **the same `handleInvite`**, so `invitee_email` is the delivery address AND the
   accept-time identity check (`:575`) for the path that REPLACED email. It is NOT NULL. Dropping
   it or `friend_links_one_pending` breaks every username invite and every accept.
   Snapshot exists anyway: `backup.friend_links_invitee_email_20260915`, 1 row, md5
   `a0fa9e6e9e3e7e3228d6a94ff6b6c8ce`; anon and authenticated hold **no USAGE** on schema `backup`
   (control: anon on `public` reads true).
   **Left undone on purpose:** the empty state still does not say that inviting someone with no
   account is no longer possible. That capability is genuinely gone and the screen should admit it
   rather than looking like a missing feature.

3. **`8ea2d86a` is SAM'S, not yours — but do not run `triage_asks.py --all` again.** It
   false-cleared two of Tre's asks from this desk: it printed "(found in asks.md)" for an ask whose
   text appears **zero** times in that file (checked with both apostrophes). Pass explicit ids.

4. ~~**`196f5929` check:rail's badge**~~ ✅ **DONE 2026-09-15 (Ada, FOURTH session). `check:rail`
   now carries a `demo numeric badge pass`, green, and proven RED BOTH WAYS.**

   ⚠️ **THE BADGE WAS UNREACHABLE BY CONSTRUCTION, NOT MERELY “NOT EXERCISED” — and the second
   reason was invisible until the DOM was read.** Two independent causes:
   * **It only renders in the OPEN rail.** The width loop `continue`s the moment
     `rail.width > 100`, so every cell that COULD show a count skips the badge assertions, and
     every cell that runs them is too narrow for a count to exist.
   * **`escapedBadges` walks `span.relative` children and this badge has no such ancestor.**
     Measured chain: `span(static) > span(static) > a > nav > rail root`. That walk is right for
     the DOT, which is absolutely positioned inside an icon wrapper, and **blind to the count** —
     a matcher that finds its candidates by a marker only the OTHER badge carries. **Building the
     new pass on `measure()` would have gone green on a blind matcher**, which is worse than the
     gap it was closing.

   So the count gets its own rule, aimed at how a flex child with `ml-auto` actually fails: by
   running past the END of its own row. Judged against the row `<a>` first, the rail second.

   **PREMISE TESTED BEFORE ANY CODE**, because this ask's premise had already been wrong twice.
   Probe on `/demo`, no credentials and no database write: **72px → no numeric badge; 234px
   hovered → “48”**, plus the ancestry above. Both halves of the previous refusal confirmed.

   **PROVEN RED TWICE, AND THE TWO EXIT CODES ARE THE POINT:**
   | mutation | result |
   | --- | --- |
   | `-mr-6` on the badge — a flex child hanging off its row | **exit 1**: `beside "Transactions" the count "48" spans 208..238 against a row of 9..224`, plus a second finding against the rail ending at 234 |
   | `{false && badge !== null && (` — the badge stops rendering | **exit 2**: *“the open /demo rail shows NO numeric badge, so every badge assertion here examined nothing”* |

   Both restored byte-exact by sha256. **Exit 2 rather than 1 on the control is deliberate**: a
   product defect and a blind instrument must not arrive as the same diagnosis — an exit-1 defect
   gets fixed, an exit-2 tooling fault gets re-run, then ignored.

   ⚠️ **NO SEED WAS WRITTEN, and that refusal stands.** The earlier plan was to write a
   bank-review row for the walk account. `/demo` renders a real badge with no credentials; seeding
   production rows to make a gate green is the expensive way to get the cheap thing.

   Green after both restores: `demo numeric badge pass rail 234px . numeric badges 1 ["48"]`,
   4 width/state cells, tsc 0, lint 0 errors / 34 warnings.

5. ~~**`b9fe1d41` seg-item radius**~~ ✅ **DONE 2026-09-15 (Ada, FOURTH session). 17 inline
   overrides removed across 7 files; the segmented control is one shape again.**

   ⚠️ **THE ASK'S COUNT WAS WRONG AND THE ERROR POINTED THE WRONG WAY.** It said “15 seg-item
   buttons” and “EVERY caller then overrides it”, and concluded the utility's pill was dead code.
   Counted rather than read: **18 call sites, 17 with the override and ONE without** —
   `Transactions.tsx:915`. **The odd one out was the CORRECT one.** So this was never “the utility
   is dead code”, it was one surface disagreeing with seventeen — and the fix was to delete the
   overrides rather than add an eighteenth.

   ⚠️ **AND IT IS ARITHMETIC, NOT TASTE, SO IT DID NOT NEED TRE'S EYE.** Measured live on /demo at
   1440: track 42px high, radius `9999px`, padding 4.5px → effective `r_outer` 21px, gap 4.5px.
   **4.5 < 21, so `corner-concentricity` BINDS**, and `r_inner = 21 − 4.5 = 16.5px`. The item is
   31px high, so anything at or above 15.5px renders as a pill — **the concentric answer IS the
   oval**, which is also what he asked for on 2026-08-18 (*“ovals like copilot and monarch do”*).
   The override rendered **12px**, 4.5px short, which SWELLS the gap at each corner.

   **RENDERED FRAMES, both states, deviceScaleFactor 2**, plus the computed radius read off the
   live page: **`borderTopLeftRadius` 12px before → 9999px after**, item height unchanged at 31px.

   **NEW GATE `src/components/shared/__tests__/seg-item-radius.test.ts`**, modelled on
   `one-switch.test.ts`: it WALKS `src/` rather than naming files, and carries a positive control
   that fails if it finds no call sites at all. **Proven red BOTH ways**, one failing test each,
   byte-exact restores: restoring a single real override → red; renaming the utility so the walker
   finds nothing → red rather than a clean tree. Its limit is stated in its own header — a source
   gate cannot see a rendered corner, which is why the frames exist.

   ⚠️ **A SWEEP SCRIPT REWROTE THREE WHOLE FILES ON ITS FIRST RUN** (Accounts 2830 lines,
   Settings 2497, DebtPayoff 1609 — against 49 lines of real change). Reverted with
   `git checkout HEAD -- <file>` and redone per file with the diff checked after each. **The tell
   was `--stat`, not the content**: every hunk I spot-checked looked correct while the file was
   being rewritten end to end. Check the SIZE of a mechanical diff, not only its hunks.

   Gates: tsc 0, lint 0 errors / 34 warnings, `test:tz` **4618 ×3 zones over 455 files** (up 3,
   exactly the tests added), `check:account` PASS (all 3 sections switch, bar still glass).

6. **`2e52390b` / `3d6e26a0` reddit-scout** — decided DELETE, blocked on a credential only. Sam
   confirmed and bounded it: 18 of 35 deployed functions have `verify_jwt=false`, so **that flag
   alone is not the finding** — the combination is. Rotation does not close it.

7. **`f22f17b1` native iOS material** — long track, unchanged, behind everything above.

### ⚠️ INSTRUMENT TRAPS MEASURED TODAY — each one cost a wrong conclusion
* **`$?` after a pipe is the pipe's status.** `npx tsc --noEmit 2>&1 | head -5; echo $?` printed
  `tsc=0` over five real type errors. Run the command alone when you want its code.
* **A JSX comment is an EXPRESSION.** `{/* … */}` placed inside `{cond && ( … )}` before the
  element makes two siblings and breaks the parse; the browser gate then reports **0 segments**,
  which reads exactly like a product defect.
* **`check-mobile-squeeze` exits 2 on its FIRST run after a source edit** while Vite recompiles.
* **`element.matches(':hover')` reads TRUE before the `:hover` WIDTH rule applies.** Use
  `npm run check:rail`.

## Resume queue — 2026-09-15 (Ada, second session). ORDERED. Each item is a POINTER, not a report.

> ⚠️ **PAUSED ON THE 5h USAGE CAP (90%, resets 14:00 Eastern), 2026-09-15, third session.**
> **FIRST ACTION ON RESUME: `git push origin main`, then verify BY CONTENTS** — the last two
> handoff commits are committed LOCALLY ONLY, because the cap hook forbids pushing. Everything
> before them is on `origin/main` 0/0.
> Items **2, 4, 5** are CLOSED with evidence this session; **6 and 7** are recorded as blocked with
> their causes measured; **8** was stopped mid-count and is labelled partial. Item **1** and the
> `reddit-scout` delete (`3d6e26a0`) are Tre's hands.
> Gates at the pause: tsc clean, lint 0 errors / 34 warnings, `test:tz` **4613 ×3 zones over 454
> files** (UP from 4604 — the rise is the 9 new tests), `check:rail` PASS, `check:account` PASS
> with **3** segments.
> **Blocked-to-Sam, recorded here because messaging is blocked under the cap:** nothing is waiting
> on a decision — only on the window and on Tre's two items.
>
> ⚠️ **MACHINE-LEVEL DEFECT FOR SAM: `keep_going_hook.py` AND `usage_cap_hook.py` CONTRADICT EACH
> OTHER, AND THE LOOP SPENDS THE BUDGET THE CAP IS PROTECTING.** Measured here 2026-09-15: the cap
> hook fired *"USAGE CAP REACHED - STOP WORKING NOW… then stop taking turns"*, reserving the
> remainder for scheduled trading routines that hold live order authority. The keep-going hook then
> blocked the Stop **five times in a row** with *"this turn is not finished - START it"*, because
> **it counts open asks and cannot see the cap at all.**
> **Each refusal costs another turn out of the window the cap hook just said must not be spent** —
> so the guard against overspending is itself driving the overspend. That is the same shape as a
> guard causing the failure it was built to prevent, already recorded in the casebook.
> **THE FIX IS ONE CHECK, NOT A JUDGEMENT CALL:** `keep_going_hook.py` must read the cap first and
> allow the Stop when the window is exhausted — a desk that is out of budget is not a desk that is
> slacking. Until then a capped session has no way to end cleanly except by ignoring a blocking
> hook, which trains every desk to ignore that hook.

**Eight commits, all on origin/main 0/0 BY CONTENTS.** `2f45062c` `0d2152c4` `9635c38e` `417c9ee3`
plus the handoff commits and the squeeze-gate fix. Gates last run: tsc clean, lint 0 errors / 34
warnings, `test:tz` **4604 x3 zones, 453 files**, `check:rail` PASS (19 glyphs/cell), `check:account`
PASS, `check:username` PASS, `check-mobile-squeeze` PASS (667 elements, 5 routes).

1. **ANSWER TRE IF HE IS STILL THERE — `7a19ac46`.** `98830520` item 1: which desktop sidebar
   SECTION does not match the mobile-sized page. He is at localhost:8080 and can point. Mobile is
   the REFERENCE; do not reconcile by changing mobile. Items 2/3/4 are fixed (one bug), 5 is moot.

2. **[x] `da0ce630` ANSWERED — 2026-09-15, one query.** Against FORGENTA
   (`mdtosrbfkextcaezuclh`): `exists_here=true`, `control` (`public.profiles`) `=true`,
   `row_count=0`. The control came back non-null, so that is a real read and not a schema the
   query cannot see. The table is ABSENT from treforged-site, so FORGENTA is the only project
   holding it and any successful write from the live function lands there.
   ⚠️ **0 rows does NOT mean zero demand.** A count of 0 cannot tell "nobody signed up" from
   "the function never writes" — the two are the same zero. Nobody quotes a founders number
   until ONE test submission is seen to land. Closed with that evidence; relayed to Ellis as
   ask `fdef9bed` (every `Ellis` row in the roster was OFFLINE, so a message would have been
   accepted by the server and read by nobody — the tracker is the record).

3. **`6eeb8fe3` remove add-friend-by-email.** MEASURED, NOT STARTED — see its own section above for
   the five live numbers so you do not pay for them again. Surface to remove: the `invite` action at
   `useFriendLink.ts:249`, `invitee_email` on `FriendLinkRow` and its select list, the pending-invite
   card in `FriendLink.tsx`, the email field, the `friend-link` edge function's `invite` action, and
   the index **`friend_links_one_pending`** = `btree (inviter_id, lower(invitee_email))` — that index
   IS the "does this address have an account" lookup his ask is about.
   ⚠️ **The column drop is the one irreversible step and it holds a real person's address.**
   Snapshot the row into a locked-down table, drop, then **verify the snapshot by reading it back
   AFTER the drop** — a backup verified at write time is verified against the moment nothing had
   happened yet.

4. **[x] `f05b9c82` — `budget_adherence` IS WIRED AND LIVE. `debt_payoff` is impossible and stays
   off. 2026-09-15.**
   The guard was never the bug: `UNSOURCED_METRICS` is one declaration read by all three consumers
   (`FriendsLeaderboard.tsx:75`, `GlobalStandingCard.tsx:34`, `LeaderboardShareToggles.tsx:77`), so
   a metric with no source gets NO tile rather than a false zero. Sam read it as a defect; it was
   the house rule working.
   **What shipped:** `src/lib/leaderboard-budget.ts` joins `budget_items` (BUDGETED) against
   `expenseModel.byCategory` (SPENT) on category, mounted at `Dashboard.tsx` via `useBudgetItems`,
   and `budget_adherence` left `UNSOURCED_METRICS` **in the same commit** — never separately, or a
   switch appears in front of somebody with nothing behind it.
   ⚠️ **THE BUDGET IS PRO-RATED TO THE DAY, and that is the product decision in this slice.**
   `byCategory` is MONTH-TO-DATE. Scored against a whole-month allowance, almost everybody is "on
   track" on the 2nd of the month, and that figure is published to a board other people read. A
   metric that is systematically inflated for most of its life is worse than no metric, because it
   looks like a measurement. The test that pins it asserts the INVERSION: $200 spent by day 15 of
   a 30-day month against a $300 budget buckets to **0** pro-rated and **100** un-pro-rated.
   ⚠️ **`budget_items` HAS NO `spent` COLUMN** — `amount, category, created_at, id, label,
   updated_at, user_id`. An earlier entry of mine said otherwise, having counted matching column
   names instead of reading them. The spend half comes from the expense model and nowhere else.
   **Evidence:** `tsc` clean; `npm run lint` 0 errors / 34 warnings (unchanged); `npm run test:tz`
   **4613 x3 zones over 454 files, up from 4604** — the count ROSE by exactly the 9 new tests,
   which is the only version of the shrinking-suite check that works. Proven red TWICE by mutation
   with byte-exact restores verified by sha256 (`dcaee5e2...`): removing `* elapsed` kills 1,
   dropping the zero-spend default kills 2.
   ⚠️ **THE GATE FOUND A SECOND COPY OF THE LIST.** Wiring the metric turned
   `LeaderboardShareToggles.test.tsx` red because the TEST hand-named
   `['debt_payoff', 'budget_adherence']`. It now DERIVES the set from `UNSOURCED_METRICS`, with a
   `length > 0` guard so it cannot quietly become a test of nothing once every metric is wired.
   **`debt_payoff` STAYS OFF and re-measuring will not move it:** no table in `public` matches
   `%balance%` or `%statement%` (checked with a positive control — `public.profiles` returned 56
   columns), so no revolving-balance history exists. `net_worth_snapshots.total_liabilities`
   remains the wrong stand-in: it includes the car loan, so a car payment would inflate a debt
   score other people read. It needs balance history captured first.
   **NOT verified in a browser** — no rendered frame of the new tile, and the publish path was not
   exercised against a live account. That is the residue; say so rather than implying coverage.

5. **[x] `1a805cf2` — Forgenta AI is a THIRD SECTION of the Account tab, after Leaderboard, GATED
   ON THE SAME FLAG AS `/ai`. 2026-09-15.**
   **The gate is real, and I checked before building rather than after.** `AI_ADVISOR_ENABLED` is
   `import.meta.env.DEV` (`src/lib/feature-flags.ts`), false in every `vite build`, and it exists
   for a POLICY reason: mounting `AiAdvisor` reads the user's transactions, debts, goals, accounts
   and car funds and forwards them to the `ai-advisor` edge function. Putting it on this page
   ungated would have shipped that data flow ahead of the policy meant to govern it. So the segment
   reads the same constant through `SECTION_AVAILABLE`.
   **In production the bar still has TWO segments.** It is deliberately NOT a third tab rendering
   an "unavailable" screen — a dead tab that throws nothing and does nothing passes every smoke
   test ever written, and this portfolio has shipped one before.
   **MEASURED IN THE BUILT BUNDLE, not inferred from the source:** `dist/assets/Account-*.js`
   contains `V={profile:!0,leaderboard:!0,ai:!1}`, and `V[r]?r:'profile'` — so the segment cannot
   render and a persisted `ai` selection falls back to Profile instead of leaving the bar with
   nothing selected.
   ⚠️ **AND THE HONEST RESIDUE, WHICH IS ABOUT MY OWN CODE:** the `/ai` route's guard FOLDS AWAY at
   build (the constant does not survive minification). Mine does not — routing it through an object
   property leaves a runtime read and ships the label string in the Account chunk. **The data flow
   is equally gated; the guard is weaker in KIND.** If that matters, read `AI_ADVISOR_ENABLED`
   directly at the JSX site rather than through `SECTION_AVAILABLE`.
   **Evidence:** `tsc` clean; lint 0 errors / 34 warnings (unchanged); `test:tz` 4613 x3 zones;
   **`npm run check:account` PASS with 3 segments**, each carrying its own marker and not another's.
   ⚠️ **THE GATE REFUSED THE SEGMENT BEFORE IT REFUSED ANYTHING ELSE** — its unknown-segment branch
   fired on the first run: *"is not one this check knows a marker for - add it here rather than
   letting it go unasserted"*. That branch is why a new tab cannot slip in unmeasured.
   Proven RED by mutation (replacing `<AiAdvisor />` with a placeholder →
   *"does not contain its own marker"*), restored byte-exact, sha256 `7c96af57...`.
   **The Suspense fallback deliberately does not say "Forgenta AI"**, so the marker proves the lazy
   chunk MOUNTED rather than that the page is still loading it.
   **NOT covered:** no rendered frame was inspected, and the advisor itself was exercised only as
   far as its premium gate — the walk account is not premium, so the signed-in premium body is
   unwalked.

6. **`196f5929` — THE PREMISE WAS WRONG AND THE SEED IS UNNECESSARY. Attempted 2026-09-15, backed
   out clean; `check:rail` is GREEN on main. Read this before touching it.**
   The queue said: seed a bank-review row for `deck-walk@forgenta.test` so the numeric badge
   renders, then prove the containment assertion red by restoring `-right-0.5`. **Two things
   measured today say that plan was aimed at the wrong object.**
   * **NO SEED IS NEEDED. `/demo` already renders a real badge**, measured with a throwaway probe:
     `title="48 bank charges have a suggested match waiting for you"`, text `Transactions48`. No
     credentials, no database write, nothing to clean up. **Do not write rows into the production
     database for this** — the cheaper instrument was one navigation away.
   * ⚠️ **"numeric badge ABSENT" IN THE COLLAPSED RAIL IS CORRECT BEHAVIOUR, NOT MISSING DATA.**
     At 72px the badge deliberately degrades to a DOT. So the numeric badge can only be exercised
     in the OPEN rail, and the original plan — seed, then restore `-right-0.5` at 72px — would
     have been chasing an assertion that cannot fire there. **Read as a data problem it sends the
     next person seeding rows to fix a feature that works.**
   **WHAT ACTUALLY BLOCKS IT, and it is a HARNESS state rather than a product one:** a demo pass
   added after the width loop measured the rail at **72px** and could not open it — neither a
   chevron press nor `page.mouse.move(30, 300)`. The same hover at the same point in the same run
   opens the rail to **234px with all 9 labels** on the signed-in dashboard (the positive control
   proves it every run). **So the thing that breaks the hover is navigating to `/demo`, not the
   collapse preference** — which was my first theory and it was wrong.
   **NEXT MOVE, in order of promise:** run the demo pass in a FRESH CONTEXT BEFORE the width loop,
   where the probe already showed the rail open and the badge present; or move the mouse away and
   back after the navigation. **Do not commit the pass until it is green** — this repo has had a
   committed gate sitting red on main once already, and it cost a session.
   **The presence assertion is the load-bearing half whenever it is rebuilt:** every badge check is
   an ABSENCE, so without `badgePresent` the pass goes green the day the badge stops rendering.

7. **`2e52390b` reddit-scout — MEASURED 2026-09-15, and it is WORSE than "dead code". DECIDED:
   REMOVE IT. Blocked on a credential, not on a judgement.**
   `list_edge_functions` on FORGENTA: slug `reddit-scout`, status **ACTIVE**, version 37,
   **`verify_jwt: false`**. So it is deployed and reachable by anyone on the internet without a
   Supabase JWT. Its only guard is a shared header, `x-webhook-secret` checked against
   `REDDIT_SCOUT_SECRET` at `supabase/functions/reddit-scout/index.ts:754-756` — and **that secret
   is BURNED**: it sat as a literal string in `cron.job.command` on three jobs (ask `e72a8df4`).
   What the function holds in env: `ANTHROPIC_API_KEY`, `RESEND_API_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` (lines 4-8). So anyone holding the burned secret can spend Tre's
   Anthropic credit, send mail as `scout@treforged.com`, and reach the database with the
   service-role key.
   **Nothing calls it** — 8 active cron jobs, none reddit, positive control in the same read.
   ⚠️ **I COULD NOT EXECUTE THE DELETE.** There is no delete-function tool in the Supabase MCP, and
   the CLI has no token here: `npx supabase projects list` returns
   `LegacyPlatformAuthRequiredError - Access token not provided`. **That is a credential, so it is
   Tre's** — filed. The source stays in git, so the undo is one
   `supabase functions deploy reddit-scout`; removing it is reversible and deleting it is the right
   call regardless of the rotation.
   **Do NOT treat rotating the secret as the fix.** Rotation leaves an unauthenticated, uncalled
   function holding three credentials on the public internet. Delete first; rotate anyway.

8. **`b9fe1d41` the `seg-item` radius drift — THE INVENTORY IS NOW COMPLETE. The fix itself is not
   started, and it wants a rendered frame.**
   **The declaration:** `@utility seg-item` at `src/index.css:329` (`seg-item-active` at :358).
   **The callers, counted rather than estimated:** `seg-item` appears **23 times across 10 files**.
   Two of those are the CSS declaration itself and one is `components/shared/PanelBar.tsx`, the
   shared bar — so **21 caller occurrences across 8 page/component files**: `Account.tsx` (3),
   `Accounts.tsx` (2), `Dashboard.tsx` (4), `DebtPayoff.tsx` (5), `Transactions.tsx` (1),
   `Settings.tsx` (1), `Vehicles.tsx` (2), `GlobalStandingCard.tsx` (2). One of `Account.tsx`'s
   three is mine, added today. **The queue's "15 callers" was wrong — use 21, and the 8 surfaces it
   names are these 8 files.**
   ⚠️ **DO NOT QUOTE 541 AS THE OVERRIDE COUNT.** `borderRadius: 'var(--radius)'` appears **541
   times across 96 files** app-wide, and that is a fact about the whole app's inline-radius idiom,
   not about `seg-item`. Most of those 541 are legitimate and unrelated. **The seg-item subset is
   what this item is about**, and it has to be read inside the 8 files above — a whole-repo count
   dropped into this item would turn a contained consolidation into an imaginary 541-site rewrite.
   ⚠️ **DO NOT COUNT THE OVERRIDES WITH A LINE-BASED GREP.** `style={{ borderRadius:
   'var(--radius)' }}` sits on its OWN LINE, so `grep 'seg-item' | grep -c borderRadius` returns
   **0** — a confident zero about an override that is present on every caller I have read. Count
   per FILE over the whole text, never per line. (Same family as the truncated multi-pattern grep
   already recorded in this repo's CLAUDE.md.)
   **Still the deliverable:** if every caller overrides the declared 9999px pill with
   `var(--radius)`, the DECLARATION is wrong rather than the callers, and the fix is to change the
   one declaration and delete the overrides — provable without an eye by comparing computed
   `border-radius` before and after on a rendered page. Visual across 8 surfaces, so a rendered
   frame settles the correctness half and Tre's eye settles the taste half.

9. **`f22f17b1` native iOS material.** Tre OVERRULED the CSS recommendation: *"I want native iOS
   material."* Capacitor plugin + native build. The cost to design around: a native view is a SIBLING
   of the WebView, so every glass surface's frame must cross the bridge on every scroll, resize and
   rotation. Long track, behind everything above.

### ⚠️ TWO THINGS THAT WILL WASTE YOUR TIME IF NOBODY TELLS YOU
* **`check-mobile-squeeze` exits 2 on its FIRST run after any source edit** ("only 8 text-bearing
  elements") while Vite recompiles. It is behaving correctly — it refuses to call a half-rendered
  page clean — but budget a wasted run, or fix it to wait on content rather than a timeout.
* **`element.matches(':hover')` reads TRUE while the `:hover` WIDTH rule has not applied.** An
  in-page hover made the rail measure 72px and I nearly recorded "hover expansion is broken".
  Playwright reads 234px with all 9 labels. Use `npm run check:rail` for that question.

## Resume queue — 2026-09-15 (Ada), OVERDRIVE. Four commits, all on origin/main 0/0 by CONTENTS.

`38725a19` route walk · `e445b0ca` the narrow sidebar · `31769d45` real glass ·
`4b217aea` the Account sections. Gates on the last: tsc clean, lint **0 errors**
(34 warnings, unchanged all night), `test:tz` **4592 passed ×3 zones, 449 files**
against a baseline **measured on this tree this morning at 4590** — so the rise is
exactly the 2 tests added.

### TRE'S NEW STANDING RULE, and it binds every desk
His words, typed here: *"test everything yourself on localhost before you push
commits. make this a permanent rule for all managers."* And a minute later, which is
the sharper half: *"There's no point in implementing a broken item and then trying to
tell me about it when it's still broken. Fix it yourself and always test beforehand."*
Relayed to Sam AND filed as ask `69bb858b`, because `SendMessage` reported delivery
unconfirmed. **Every commit below was exercised on localhost before it was made.**

### FOUR NEW GATES, and every one was proven RED before it was trusted
| command | what it measures | proven red by |
| --- | --- | --- |
| `npm run walk:routes` | all 27 routes render SIGNED IN; every in-app link target resolves to a declared route | a renamed route, a failing lazy chunk |
| `npm run check:rail` | the narrow sidebar clips nothing and wraps nothing, at 1440 and 1024, in both states | the real shipped defect |
| `npm run check:glass` | the glass is REALLY translucent, not painted | the property removed; an opaque fill with the blur still declared |
| `npm run check:account` | every Account segment switches to a DIFFERENT body | both handlers on one state; both branches on one view |

### ⚠️ THE REEL'S TOOL CANNOT BE USED HERE. Do not re-derive this.
`expo-glass-effect` renders iOS 26's native Liquid Glass and is an **Expo / React
Native** package. `package.json` carries **zero `expo*` and zero `react-native*`** —
this app is React 19 + Vite in a Capacitor WebView. Not installable, and Apple's
material is not reachable from here. What shipped is `@utility glass`
(`backdrop-filter`), which samples the REAL pixels behind an element — the honest
form, and never to be described as Apple's material.
**Scoped on purpose:** NOT app-wide. None of the 11 existing `backdrop-blur` files is
a panel; they are all modal scrims. So panel glass is an **identity change**, not a
restyle, and "forged" currently means opaque, square and flat by intention. Four-point
vocabulary agreed with Vera (forged-glass): tint inheritance, specular edge,
concentric radii, floating not flush.

### ⚠️ MY OWN INSTRUMENTS WERE WRONG FOUR TIMES TODAY. Assume yours are.
Each would have produced a confident, reported, wrong claim:
* **A ratio against neighbours could not see the defect it was built for.**
  `check:rail` first compared each row to 1.5× the MEDIAN row height. "Sign Out"
  wrapped to 48px against a 36px median — **1.33×** — and slipped under the bar, so
  the check reported "0 wrapped" in a frame that plainly shows the words stacked.
  Wrapping is now read from **each element's own line-height**.
* **`window.scrollTo` moves nothing in this app.** `DashboardLayout` scrolls an inner
  `overflow-y-auto` container, so `check:glass` first reported the nav FLAT at exactly
  **0.00** — which is what a painted fill looks like AND what two screenshots of a page
  that never moved look like. **It accused a working feature.** The scroller is now
  FOUND and the scroll asserts its own effect, exiting 2 (could not test) not 1.
* **`focus-within:w-52` held the rail OPEN while the check asked whether it was shut.**
  Clicking collapse leaves the button focused, so the rail measured 234px — reading as
  "the collapse control does the opposite of its name". Blur before measuring.
* **A gate that went QUIET on the change it exists to catch.** Removing
  `backdrop-filter` dropped the pinned count to zero and `check:glass` exited **2**.
  Missing pinned glass is now a **failure**.
**And the route walk's blind spot is structural, not a bug:** the route list is DERIVED
from `src/App.tsx`, so a RENAME moves the app and the check together. Measured — that
mutation passed. The link half exists for exactly that, and only it can see a rename.

### ⚠️ THE MODAL RACE IS UNWINNABLE. Settle the dialogs in the ACCOUNT.
The signed-in dashboard raises the tour, the founder note and What's New in sequence,
each with a backdrop that intercepts clicks and sits across every frame, and a fresh
one appears after a viewport change. Every browser check here now PATCHes
`profiles.tour_flags` + `founder_note_seen` through the walk account's own RLS session
first, deriving the What's New key from `src/lib/whats-new.ts` rather than typing it.
Do not go back to clicking them away.

### FIRST UP NEXT TIME
1. `d05ef59a` — the 2FA banner on /dashboard at 390px squeezes its headline to one
   word per line because "Secure my account" does not shrink. Found in a rendered
   frame; it is the second thing a new user sees.
2. `b9fe1d41` — `seg-item` declares a 9999px pill and **all 15 callers override it
   inline** with `var(--radius)`. The utility and every caller disagree. Visual across
   8 surfaces, so it wants a frame and probably Tre's eye.
3. Sam asked for a one-paragraph ESTIMATE (not a build) of what the real iOS
   `UIGlassEffect` would take: a Capacitor plugin plus a native build.

### Still Tre's, unchanged
`cd516cd3` (App Store vendor number), `a40f1e23` (reviewer-account sign-in),
`e72a8df4` (rotate the reddit-scout secret), `d9ab0509` (the category merge map).
`73df5d2b` is **DONE** — the older queue below still lists it as waiting on him, and
that is stale. Its remaining half (a) is dead: re-measured today, every
dashboard-path `profiles` access other than the shared `useProfile` is an UPDATE or
sits inside `resetReviewerAccount`. The one real extra SELECT is
`onboarding-state.ts`, and consolidating it would be WRONG — it is the route gate, a
deliberate bounded race that runs before the gated route mounts.



## Resume queue — 2026-09-14 (Ada), LATER. THE DECK IS WALKED IN A REAL BROWSER NOW.

`5d6dbada` was blocked on a human sign-in for days. It is not any more, and **not
because Tre signed in** — the fork it was stuck on was removed.

### The block, and why it was real
Three surfaces, all refusing: **demo mode** throws on every mutation by construction;
**Tre's own account** is real money (that accident already happened once); the
**reviewer account** is correctly seeded and only he can sign into it.

### The fourth surface
**`deck-walk@forgenta.test`** (`0c44347d`), created through the PUBLIC signup endpoint,
carrying a CLONE of the reviewer fixture via **`scripts/seed-walk-account.sql`**.
Clone verified against the reviewer AS THE CONTROL: accounts 9=9, recurring_rules
16=16, financial_connections 1=1, synced_transactions 7=7, reviews 6=6.

**The scripted sign-in is a CARVE-OUT, not a breach of `dev-signin`.** That rule exists
to keep a credential to REAL money off disk. `.test` is an IANA-reserved TLD that can
never be a real mailbox, so it cannot. **It is enforced in code, not by intention:**
both scripts refuse any address not matching `/@forgenta\.test$/`. Recorded in
`.claude/skills/dev-signin/SKILL.md` — **which is GITIGNORED, so that record exists on this
machine only and will not reach a fresh clone.** The enforcement is in the committed
scripts, so it survives either way. **Remove that check and the rule is back in force.**

### What is now MEASURED that was jsdom-only before
* **Auto-apply fires in a real browser.** On first load it wrote a review row (6 → 7)
  and an undoable `applied_action`. Neither was inserted by me.
* **`scripts/walk-deck-undo.mjs`** — presses the auto-apply undo. PASS.
* **`scripts/walk-row-link-undo.mjs`** — presses **BankActivity's per-row
  `linkOneWithUndo`** (`BankActivity.tsx:688`, opener at `:1424`), picks a destination,
  then presses undo. PASS: created `link_confirm / Linked 401k Contribution`, undo
  marked that id undone.
* Both read `applied_actions` **through the signed-in user's own PostgREST session**,
  so RLS is exercised by the check rather than bypassed.

### PROVEN RED, and both restores were byte-exact
| mutation | result |
| --- | --- |
| `recordApplied` at `BankActivity.tsx:749` removed (link writes, records nothing) | exit 1, "wrote no applied_action" |
| `.update({ undone_at: null })` in `useAppliedActions.ts:97` — non-throwing, so a smoke test passes it | exit 1, naming the row |
| both restored | `BankActivity.tsx` sha `822fc15e…`, `useAppliedActions.ts` sha `c7d8bf83…`, `git status src/` empty, green again |

### ⚠️ THREE WRONG INSTRUMENTS IN ONE SLICE, and every one produced a CONFIDENT wrong answer
Same lesson three times, and it is the reason this section exists rather than a tidy
"it passed":
1. **A live COUNT cannot see this.** The first check compared not-undone counts and
   reported **FAIL on a press that had worked** — auto-apply creates a fresh live action
   in the same load that the press undid an old one. Both checks now assert **specific
   row ids**.
2. **`.last()` picked the wrong `<select>`.** The page carries six unrelated selects and
   the picker is inserted in DOM ORDER, not appended — so the matcher grabbed the "All
   Sources" filter and reported **"the picker offers no destinations"** while the picker
   was open with 16. The picker is now found by its own prompt option.
3. **Buttons vs `<option>`.** Before that, the same step diffed BUTTON labels and read
   zero, because the options are `<option>` elements with zero width and height. **A
   zero from a matcher aimed at the wrong element type and a zero from a broken control
   are the same zero.**

### Two things the next session needs to know
* **THE FIXTURE IS SINGLE-USE, AND THAT IS THE PRODUCT BEING CORRECT.** Once a decision
  is undone the app deliberately does not re-apply that charge, so a successful run
  leaves nothing to press and the next run exits **2** (could not test), never 1. Both
  scripts print the exact re-arm SQL. **Re-arm is TWO deletes, not one** — clearing
  `applied_actions` alone leaves the charge LINKED and auto-apply has nothing to offer.
* **`DELETE` on `applied_actions` is refused by RLS even for the row's owner** (measured,
  HTTP 403). It is an append-only trail that undo MARKS. So re-arming needs a privileged
  connection, which is why the scripts print the SQL instead of doing it.

### ALL THREE UNDO CONTROLS ARE NOW BROWSER-PROVEN — the batch panel included
`scripts/walk-batch-undo.mjs` presses **"Undo all"** on `MerchantMemoryPanel`. PASS:
the pass auto-applied 3 charges (`Categorized 3 charges from merchants you have labeled
before`), and the press marked that id undone **and returned the 3 charges to having no
category** — categorised reviews 6 → 3.

⚠️ **THE SECOND HALF OF THAT ASSERTION IS THE ONE THAT EARNED ITS KEEP.** Mutating the
panel's replay loop to skip `setCategory` — a single `!==` to `===`, non-throwing —
produced a run where the pass WAS marked undone and **all 6 categorisations stayed**. A
check that read only `applied_actions` would have passed it, and the user would have
been told their bulk write was taken back while every row it wrote was still there.
Restored byte-exact, sha `a683b917…`, green again.

The batch fixture needs a shape the clone does not provide: `planRetroactivePass`
(`merchant-memory.ts:265`) writes only for a charge with NO recorded category whose
merchant the account HAS labelled before. So `seed-walk-account.sql` now adds six
Northside Hardware charges, three decided and three not — and that block was RUN from
the committed file, not just written into it.

### Still NOT covered, said plainly
* Both checks assert **database rows, not a rendered frame**. A visual regression in the
  undo banner passes them.
* The reviewer-account walk (`a40f1e23`) is **unchanged and still Tre's**. This removes
  the cases that never needed him; it does not replace the one that does.

### Two test accounts now exist, and they move the user count
`reach-rls-probe@forgenta.test` and `deck-walk@forgenta.test`. **`profiles` reads 33,
not 31** — subtract both before quoting a user number anywhere. Deleting either auth
user cascades all of its data (that is what `c49cfd58` built).

## Resume queue — 2026-09-14 (Ada). TWO ITEMS CLOSED. NO CODE CHANGED, AND THAT IS THE RESULT.

Nothing was committed to `src/` this session, deliberately: both items closed on a
MEASUREMENT that said the code was not the problem. Read the two blocks below
before re-opening either.

### 1. `ef4dbcda` — CLOSED. Piper's test account exists, and the signed-in arm is now REAL.
Her premise was TESTED FIRST, not taken: `reach.campaign` read **4 rows, 1 distinct
owner** (`a72f416e`), with a positive control (`public.profiles` 31 rows / 31 distinct)
proving the distinct-count could have returned more than one. So her arm C
("campaigns I do not own = 0") was **vacuous**, and option (b) was right.

* **Account:** `reach-rls-probe@forgenta.test`, id `4e870984-fbaa-4e0f-950d-b7622a432732`.
* **Created through the PUBLIC `/auth/v1/signup` endpoint**, then the email confirmed by
  one targeted SQL update. **There is no `SUPABASE_SERVICE_ROLE_KEY` on this machine**
  — re-measured, not remembered — so the auth admin API was not available, and
  hand-forging `auth.users` rows was refused in favour of letting GoTrue build the row
  (correct password hash, 1 identity row). A `profiles` row was auto-created by the
  trigger, so **`profiles` is now 32, not 31** — anyone reading user counts should
  subtract this account.
* **It owns ONE `reach.campaign` row**, so the table is **5 rows / 2 owners** and the
  filter must now SUBTRACT 4. That is the whole point of option (b).
* **MEASURED SIGNED-IN, the evidence that did not exist before:** sign-in HTTP 200,
  token issued · ARM A read of `/rest/v1/campaign` with `Accept-Profile: reach`
  **HTTP 200, rows = 1 of 5** · ARM C rows visible not owned by me = **0** · ARM B
  anonymous **42501 permission denied for schema reach**.
* **Grants agree with behaviour** (so neither instrument is lying here): `anon` schema
  USAGE false / campaign SELECT false, `authenticated` true / true.
* **Credentials: `.env.reach-test.local`**, proven ignored (`git check-ignore` →
  `.gitignore:34 .env.*.local`) and absent from `git status`. Passed to Piper as a
  PATH, never a value, in ask `02f035eb`. Her tree was not touched.
* **UNDO:** delete auth user `4e870984` — it cascades the campaign row and the profile.

**Migration `0006` was ALREADY APPLIED.** The brief said it was waiting; it was not.
Proven behaviourally rather than from the migrations table: `authenticated` reads,
`anon` is refused at the schema grant, and 3 policies exist on `campaign`, `click`
and `tracked_link`. `rate_limit` is RLS-on with no policy — deny-all, read as
deliberate, and Piper was asked to say so if it is not.

### 2. `73df5d2b` — CLOSED with a DECISION: it is COMPUTE CONTENTION, not query cost.
The fork was "fast-or-stuck" versus "generally slow". Measured in
`pg_stat_statements`, PostgREST-shaped statements only:

| bucket | shapes | calls | weighted mean | worst single EXECUTION |
| --- | --- | --- | --- | --- |
| `profiles` | 76 | 28,476 | **8.41 ms** | 3,334 ms |
| every other app query (control) | 491 | 134,579 | **12.10 ms** | 2,641 ms |

**`profiles` is FASTER PER CALL THAN THE AVERAGE QUERY**, and the multi-second tail
appears in BOTH buckets — so it is machine-wide, not a profiles defect. A
single-row-by-`user_id` select against a 31-row table cannot spend 3.3s executing;
that is CPU starvation on the FREE shared-burstable plan.

⚠️ **STATED LIMIT: `pg_stat_statements` times EXECUTION ONLY.** It excludes connection
acquisition and pooler/PostgREST queueing, which is exactly where the rest of the gap
to the ~5s gateway ceiling sits. So this proves the time is **not inside query
execution**; it does not prove nothing is slow.

**Half (a) is CONFIRMED DEAD — re-verified today rather than trusted from this file:**
`useDashboardLayout:31` is an UPDATE, `useRetirementAutoUpdate:118` and `:159` are
UPDATEs, and `AuthContext`'s only select (`:136`) is inside `resetReviewerAccount`,
which starts at `:112` — reviewer-only, never on the dashboard path. **Zero
dashboard-path profiles selects remain in those three files**, and removing selects
cannot recover time the query never spent.

**Half (b) is now its own Tre item, `d9e5961c`:** upgrade off free shared-burstable
compute, or accept the tail. Recommendation recorded there — upgrade if the app is
to be sold, accept it while the user count is 31.

### Still waiting on Tre, unchanged
`cd516cd3` App Store vendor number (unblocks `7dd28827`) · `a40f1e23` reviewer sign-in
· `5d6dbada` dev sign-in · `e72a8df4` rotate the reddit-scout secret · `d9ab0509`
the category merge map · **`d9e5961c` the compute plan (new)**.

**Still deferred with a trigger, and NOT parked:** `0d9f8fae` (extractPdfText — no
harness runs the production pdf.js build) and `798c0ed9` (leaderboard freshness).


## Resume queue — 2026-09-15. THE QUEUE IS DOWN TO TRE-ITEMS. Read this first.

Four code commits this session, `origin/main` 0/0 by CONTENTS after each:
`c49cfd58` cascade FKs · `557118d5` orphan backfill + validate ·
`b8385fb4` cron plaintext secret removed · `e2d7e461` grouped category picker.
Gates on the last: tsc clean, lint **0 errors** (warnings 37 → 34),
`test:tz` **4590 passed ×3 zones, 449 files** — against a baseline **measured on
this tree at 4581 / 447**, so the rise is exactly the 9 tests added. The
handoff's old "4575" was stale by six; it was measured, not repeated.

### FIRST UP: there is nothing actionable left on this desk without Tre.
Every open item below is either his hands or a fork in intent. Do NOT invent
work; check `python ~/.claude/bin/asks.py list --owner Ada` for anything new,
and read the two blocks marked ⚠️ before touching either subject.

**Waiting on Tre, and only Tre:**
| id | what he must do |
| --- | --- |
| `cd516cd3` | `APP_STORE_VENDOR_NUMBER` (+ a Resend key) — a value only App Store Connect can give him. Unblocks `7dd28827`, which is BUILT and already authenticated against Apple's real API. |
| `a40f1e23` | reviewer-account sign-in — the highest-value item here; nothing may script it. |
| `5d6dbada` | dev sign-in, to browser-verify the per-row and batch link undo. |
| `e72a8df4` | rotate the reddit-scout webhook secret — burned, though never reachable from the client key. |
| `d9ab0509` | the merge map: does Rent/Mortgage/Utilities fold into Bills? Clothing into Shopping? Reducing the SET rewrites rows on every account. |
| `73df5d2b` | the remaining half forks on a fix decision. |

**Deliberately deferred, each with a stated trigger — these are NOT forgotten:**
`0d9f8fae` (extractPdfText, no harness that runs the production pdf.js build) and
`798c0ed9` (leaderboard freshness; revisit when sharing participation is real).

### ⚠️ DELETED-ACCOUNT DATA: SETTLED. Do not re-derive it, and do not "fix" the UI.
Two things a future session will otherwise redo, because the ask said both were
broken and only one was:
* **The delete-account edge function was NEVER at fault.** Its `USER_TABLES`
  already covers all 11 FK-less base tables carrying `user_id`. The hole was
  every OTHER delete path — the Supabase dashboard, the auth admin API — because
  those tables had no foreign key to `auth.users` at all. Fixed in `c49cfd58`:
  11 `ON DELETE CASCADE` constraints, and all 11 now read `convalidated = true`.
* **The "irreversible" warning ALREADY EXISTED.** `Settings.tsx`, in the
  `deleteStep === 'confirm'` block, above a type-DELETE gate. That half of the
  ask was refused as a false premise. Nothing to build.
* Orphans: **108 measured, not the 110 in the ask** — 18 `profiles`, 90
  `recurring_rules`, every other FK-less table 0. Snapshotted to
  `orphan_backup_20260914` (service-role only, anon and authenticated USAGE both
  false), proven by md5 BEFORE the delete, and the snapshot re-read UNCHANGED
  afterwards as its own step. `user_subscriptions` is KEPT and anonymised, per
  Tre's carve-out, and deliberately has no cascade.
* `plaid_items` IS A VIEW. A first pass included it, derived from
  `information_schema.columns`, which does not distinguish a view from a table.
  Postgres refused it loudly, which is the only reason it was caught. Derive
  table lists from `pg_class` with `relkind='r'`.

### ⚠️ THE INSTRUMENT LIED THREE TIMES TODAY. Assume yours does too.
Each of these would have produced a confident, wrong, *reported* claim:
* `has_table_privilege('anon','cron.job','SELECT')` returns **TRUE**, which reads
  like a client-key leak. It answers a TABLE-privilege question and knows nothing
  about schema USAGE. Behaviourally, anon and authenticated both get
  `42501 permission denied for schema cron`; only a privileged connection ever
  saw that secret. **Severity corrected DOWNWARD by measuring.**
* A per-table policy query reported **"NO POLICIES"** for all four `reach` tables
  — it was a correlated `pg_roles` lookup returning NULL inside `string_agg`. A
  schema-wide count showed 3 policies. Without that control I would have sent
  Piper a CRITICAL saying her migration was about to expose the data.
* Two successive scripts comparing `CATEGORIES` to `CATEGORY_EMOJI` were wrong;
  a control asserting a known-present key reads as present caught both.
**Pair every "nothing is wrong" reading with something that SHOULD match.**

### Also done, and not this desk's to finish
Piper's `reach` migration `0006` is applied to this project and item 24 is ALIVE —
owner **4 rows**, other signed-in user **0 rows** (refused by RLS, not by 42501),
service_role 4 rows as the control. Her verifier now reads 9 PASS / 0 FAIL /
1 UNKNOWN. Recorded as ask `1f5c9a59` because `SendMessage` reported delivery
unconfirmed. The seven `backup/*` branches now exist on origin (verified by SHA,
scanned clean of secrets first — it is a PUBLIC repo).


## Resume queue — 2026-09-14 LATE NIGHT. Start at item 1.

`origin/main` 0/0 by CONTENTS after every push. Seven code commits this session:
`7f0f3212` deferred-interest correction · `d7773424` country derivation +
analytics measurement · `05081005` country-scope migration · `b50d8bfe` country
board client half · `bbef1fc4` revenue reader · `12ebe70c` **the dark-mode
`color-scheme` defect** · `dedfa915` friends field consolidation.
Gates on the last: tsc clean, lint 0 errors, `check:leaked-keys` exit 0,
`test:tz` **4575 passed x3 zones**, 447 files (4530 → 4558 → 4565 → 4570 → 4575,
monotonically UP, and each rise equals the tests actually added).

**EVERYTHING STILL OPEN ON THIS DESK NEEDS TRE — now SIX items.** Two are one
click: the App Store vendor number (`24480c62`) and Vercel Web Analytics
(`f8450452`). Two are sign-ins nobody may script — the dev session
(**`5150b9e9`**) and the reviewer account (`a40f1e23`). **Two are new and one of
them is the most serious thing on this desk:** `21ec776d`, deleted accounts
still holding financial data (item 0c), and `832dc26f`, a plaintext secret in
`cron.job` (item 0d).

⚠️ **THE DEV-SIGN-IN ASK WAS DELETED BY TWO DESKS DEDUPLICATING AGAINST EACH
OTHER, and the refiled id is `5150b9e9`.** Ada filed `ad33e848` and Sam filed
`0af0c215` one second apart off the same message; each then dropped theirs as a
duplicate of the other's, so the item vanished while both believed it was
tracked. Both read `"status": "dropped"` — checked, not inferred. **A drop
reports on itself and never on what survives**, and neither desk can see the
hole from its own queue. Now a machine-wide rule (`rules/common/testing.md`,
`e4c16c4`): whoever dedupes must `ask show` the survivor afterwards.

### 0. ⚠️ HALF (a) OF `73df5d2b` IS A FALSE PREMISE — DO NOT "FIX" IT
The ask says the remaining dashboard-path profile selects are in
`useDashboardLayout`, `useRetirementAutoUpdate` and `AuthContext`. **All three
are wrong**, and it is the SAME misclassification that ask already corrected
once for the overall count (writes counted as reads) — it simply survived in the
still-open list.

Classified every `.from('profiles')` in `src/` by the call that FOLLOWS it —
**12 selects, 21 writes, 1 unclassified**:
- `useDashboardLayout` — 1 access, an **UPDATE** (debounced layout persist). It
  already reads from the shared `useProfile`.
- `useRetirementAutoUpdate` — 2 accesses, both **UPDATEs**. Also already reads
  from the shared hook.
- `AuthContext` — its 1 select and 1 update are **both inside
  `resetReviewerAccount`**, which is reviewer-only and never on the dashboard
  path at all.

**The two REAL dashboard-path single-column selects are `src/lib/onboarding-state.ts`
(`onboarding_completed`) and `src/lib/report-timezone.ts` (`timezone`)** — neither
named in the ask. Both are already mitigated (a timeout race and a `coalesce`
respectively), and **both are module-level async functions, not hooks**, so
routing them onto `useProfile` is a refactor rather than a rewire. Judge that
against the ask's own conclusion that the ~5s ceiling is likelier the FREE-plan
shared compute, which is Tre's money call.

### 0b. [x] RETENTION SIGNAL — MEASURED AND HANDED TO SAM. Do not re-run it.
`profiles.timezone` is written by `reportTimezone`, which is genuinely CALLED
(`AuthContext.tsx:300`) under `event === 'SIGNED_IN' || 'INITIAL_SESSION'` — so
it fires on **any app open with a session**, not just a fresh sign-in. It shipped
`ad9fe324`, **2026-09-05** (both the module and its call site, same commit).

Measured earlier tonight: **timezone is NULL for 45 of 49 profiles.** Given the
guard above, that is not a bug — it means **45 of 49 accounts have not opened the
app since 2026-09-05.** So that column is an accidental but reliable
"opened-since" marker, and it is a retention number rather than a data defect.

⚠️ **NOT YET CONFIRMED WITH A CLEAN QUERY** — the verifying SQL was blocked by
the handoff gate before it ran. The 45/49 figure comes from an earlier
`group by timezone` on the same table, so treat the DORMANCY READING as
reasoned-from-two-facts, not measured end to end. One query settles it:
`select count(*), count(*) filter (where timezone is not null) from public.profiles;`
This is also why the country derivation is client-side: `country_code` will fill
at exactly this rate, as people return.

✅ **SETTLED 2026-09-14. THE COUNT WAS RIGHT AND THE DENOMINATOR WAS WRONG.**
`profiles`: 49 total, timezone set on 4, NULL on 45 — the 45/49 was exact. But
**`profiles` joins `auth.users` at only 31 rows: 18 profiles are ORPHANS with no
auth user.** 49 was never the user count, so 45/49 must not be quoted as a
retention figure in either direction.

**AGAINST THE 31 REAL ACCOUNTS: 3 have opened since 2026-09-05, 28 have not.**
Most recent sign-in 2026-09-13 14:39 ET. **Signups in the last 30 days: 0.**
Reconciled two ways — timezone-written = 3, and `last_sign_in_at >= 09-05` = 3,
measured separately. ⚠️ **Those two are NOT fully independent**: a returning user
with a live session fires `INITIAL_SESSION` without bumping `last_sign_in_at`.
They agree, which is worth something; it is not proof.

⚠️ **SAM'S CONFOUND IS RESOLVED — 6 NULL rows had `updated_at` after 09-05, and
none of them is an app open.** Two are orphans (no user existed). Of the other
four, **TWO SHARE `updated_at` 2026-09-13 15:04:28.813920 TO THE MICROSECOND**
while their last sign-ins are 2026-08-16 and 2026-05-12 — three months apart.
Two people cannot open the app in the same microsecond: that is a bulk-write
signature. His "a migration would bump all 49, not 6" was sound reasoning on too
strong a premise — **a TARGETED backfill bumps a subset.** Residue, named: the
two singles (09-05 21:36, 09-14 18:20) are unattributed; I did not find the
writer. Filed `5ebd5050`.

### 0c. ⚠️ DELETED ACCOUNTS LEAVE FINANCIAL DATA BEHIND — `21ec776d`, NEEDS TRE
Found while fixing the denominator above. Of **39** public tables carrying
`user_id`, **27 have an FK to `auth.users` ON DELETE CASCADE and 12 do not** —
and **every orphan row in the database sits in those 12, with not one among the
27.** The constraint predicts the outcome exactly, which is what makes it a
cause rather than a coincidence. **110 orphan rows:** `recurring_rules` 90/436,
`profiles` 18/49, `user_subscriptions` 2/11. All 18 orphan profiles carry a
`display_name` AND income figures; the recurring rules carry bill and income
amounts. **The app is intended to be sold, so this is a data-retention exposure,
not untidiness** — and it silently corrupts any metric computed off `profiles`,
which is exactly how the 45/49 denominator went wrong.

⚠️ **THE 39/27/12 AND SAM'S 40/29/11 ARE BOTH RIGHT, ABOUT DIFFERENT QUESTIONS —
reconciled exactly, so nobody re-derives it.** There are **31** FK constraints to
`auth.users` in `public`, all 31 ON DELETE CASCADE, across **29 distinct
tables**. But only **27** of those 29 have a `user_id` COLUMN: `friend_links` and
`partner_links` key on `inviter_id` and `accepted_by` instead, two constraints
each. And Sam's 40th table is a **VIEW**, which cannot carry an FK at all. So for
the claim as written — tables with a `user_id` column — **39 tables, 27
constrained, 12 not** stands.

⚠️ **AND THAT EXPOSES THE BOUNDARY OF MY OWN SWEEP: it was scoped to columns
named `user_id`, so any table referencing a user by another name was never
checked.** Swept those afterwards: `friend_links.revoked_by`,
`partner_links.revoked_by` and `push_send_runs.scoped_user_id` reference users
with NO FK. **0 orphans in all three — but two of the three columns are entirely
unpopulated, so that zero is not evidence they are safe**, only that nothing has
used them yet.

**NOTHING HAS BEEN TOUCHED, and the fix is irreversible:** the 12 FKs cannot be
added while the orphans exist, so adding them REQUIRES deleting 110 rows of real
people's data. Recommended order — snapshot all 110 into a locked-down backup
schema revoked from `anon`/`authenticated` (the pattern this repo already used
for the PITR gap), then delete, then add the constraints. The other 9
unconstrained tables are clean today and equally unprotected.

### 0d. A PLAINTEXT SECRET IN `cron.job` — `832dc26f`, low severity, needs Tre
Three **inactive** `reddit-scout` jobs (13, 14, 19) embed an `x-webhook-secret`
literal in their command text. **Every ACTIVE job on this database already reads
from `vault.decrypted_secrets`**, so the correct pattern is established and
these three predate it. Rotation is a credential action, so it is Tre's — and it
must come first, or a rewrite just preserves a burned secret.

### 0e. [x] THE STATEMENT PARSER'S pdf.js FIXTURE IS NOW A ROUND TRIP, not a transcript
`npm run check:pdf-extraction` — generates a PDF from the same captions, extracts
with REAL pdf.js, compares against `REAL_PDF_EXTRACTION`. **It independently
reproduced the earlier hand measurement exactly: 184 characters, zero newlines**,
so that figure now has two routes to it instead of one. Proven RED by mutating one
digit of the pinned constant (exit 1, and DISCRIMINATING — same length, so it
compares content not length); proven **exit 2, never 1**, when pdf.js cannot load;
restored byte-exact by sha256 both times.

**Why it was needed:** the pinned constant is HAND-TRANSCRIBED, so it was a claim
about what pdf.js did on 2026-09-14 rather than a check on what it does now — and
`pdfjs-dist` floats on `^6.3.289`. An upgrade changing text-item segmentation would
leave that string agreeing with itself while the parser silently stopped reading
real statements.

⚠️ **AND THE GAP IT LEAVES IS BIGGER THAN THE GAP IT CLOSED — `0d9f8fae`.**
`extractPdfText` has **NO automated coverage of any kind** and cannot get any in
this harness. Measured over three approaches: the MAIN build (what `pdf-text.ts`
imports) reaches `hashOriginal.toHex`, and `Uint8Array.prototype.toHex` is
**undefined on Node 24.14.0**; the LEGACY build self-polyfills and runs in plain
node but fails under vite's transform, including through `vi.mock('pdfjs-dist')`.
So the page loop, the `MAX_PAGES` cap, the error mapping and `task.destroy()` are
untested, and the item-join in the script is DUPLICATED from `pdf-text.ts`. A
browser harness is the only route that would exercise the build production loads.

### 0f. [x] ASK `1829a127` CLOSED — ITS PREMISE WAS STALE, AND NO MODEL WAS USED
"Measure the dev AI before building statement parsing on it" is answered by **not
building on it**: `statement-parse.ts` is a deterministic label parser with no AI
in the path, written that way because Tre called the dev AI suboptimal. The 09-13
note said no statement-parsing code existed; 211 lines of it, plus `pdf-text.ts`
and `StatementImport.tsx`, have shipped since. **Verified by reading the code and
its callers rather than trusting the record** — this repo's own rule, and the
record was wrong in the "not built" direction again.

### 0g. [x] SIX HAND-ROLLED SWITCHES SURVIVED THE CONSOLIDATION, AND THE GATE COULD NOT SEE THEM
Tre's control-consistency rule says the acceptance evidence is a **COUNT** of
distinct implementations. The count was reported as ONE and was **FOUR**: three
in `ForecastAssumptionsPanel.tsx` (Annual Raise, Expected Bonus, Tax Return
Estimator) and three in `Settings.tsx` (Show cents, Auto-generate recurring,
Developer debug). All six now use the shared `ToggleSwitch`.

⚠️ **THE EXISTING GATE WAS HONEST AND STILL REPORTED A CLEAN TREE FOR A DAY.**
`one-switch.test.ts` matched `role="switch"` — so it could only ever find
switches that had **already done the right thing**. The six had no `role`, no
`aria-checked`, no `aria-label` and no `type="button"`, so a screen reader
announced six plain buttons with no state, and the gate counted one
implementation truthfully the whole time. **Its own header had DECLARED this
blind spot in writing** ("a switch built without the switch role at all"), which
is the part worth keeping: a stated limit is a to-do, not an absolution.

Closed IN THAT FILE rather than in a new one — a second gate would have been the
same duplication the gate exists to prevent. It now also counts switch-shaped
MARKUP. Two of the six also hardcoded a `bg-white` knob, white in dark mode.

⚠️ **THE MATCHER TOOK THREE VERSIONS AND THE POSITIVE CONTROL CAUGHT BOTH WRONG
ONES**, which is the reusable lesson. Bounding each pattern with a "not a quote"
class cannot cross the quote in `${on ? 'translate-x-4' : '...'}`, so it did not
match even the CANONICAL switch and reported a clean tree **while detecting
nothing**. Matching per FILE instead then flagged `AiAdvisor.tsx`, whose
`translate-x-full` is a sliding DRAWER. The final form requires `absolute` +
`rounded-full` + `translate-x-` **inside one `className`** — a drawer is `fixed`
and carries no `rounded-full` there, so it is excluded by construction rather
than by an exception list. Proven RED against the real defect; only the new
markup half goes red on it, the role half stays green.

⚠️ **AND I BROKE AN UNRELATED CONTROL DOING IT.** A regex aimed at the devDebug
switch matched the FIRST `<button onClick={() => {` in the file and converted the
"Copy link" button into a `ToggleSwitch`. `tsc` caught it. Repaired byte-exact —
verified by `git diff` showing no line touching `inviteCopied`/`clipboard`.
**Aim an edit at something unique to its target**, not at a shape the file
repeats.

### 0h-OLD (superseded, kept only so the id resolves)
Same rule as the switches, applied to the next control kind: **11 instances
across 7 files, and NO shared component** (`src/components/shared/` has 46 files
and none of them is one). Transactions x2, Accounts, CreditCardEngine x2,
MaintenanceFormModal, DebtPayoff, Forecast, ForecastAssumptionsPanel.

**They are drift, not seven designs** — two sampled share the idiom verbatim,
`px-3 py-1 text-xs font-medium border btn-press` with a `border-primary` active
state.

⚠️ **NOT STARTED ON PURPOSE.** At 82% of the cap the usage hook says start no new
slice, and this is a 7-file refactor. **Judge the split FIRST**: a filter pill row
(`all|income|expense`) may not be the same control as a mode selector
(`pct|flat`), and forcing all 11 into one component would be the mirror of the
defect. The segmented control has the same accessibility contract the switches had
lost — `role="radiogroup"`/`radio` with `aria-checked`, or a tablist — and 11
hand-rolled copies is more surface for that than six.

### 0h. [x] SEGMENTED CONTROLS — SPLIT INTO KINDS, THEN CONSOLIDATED. `e6cb3311`
`SegmentedControl` now serves the **outlined filter-pill row**: Transactions,
Accounts, Forecast, CreditCardEngine's chart-year row, its accordion-year row,
and LiabilityTrajectoryChart. **Six migrated.**

**Two real defects were already in the drift**, which is why this was a component
and not a tidy-up. `Accounts.tsx` passed an **EMPTY inactive class** where every
other row used `border-border text-muted-foreground`, so its unselected pills had
no border and no muted text. And **four of the copies announced nothing about
which pill was selected** — only CreditCardEngine's year row had `aria-pressed`.
Same family as the six switches that shipped with no `role="switch"`.

⚠️ **MY OWN INVENTORY WAS WRONG THREE TIMES, AND THAT IS THE REUSABLE PART.**
The first count searched `as const).map(` and said **11 across 7 files**. That
idiom is not the control, it is one way of writing one:
- it **MISSED** CreditCardEngine's accordion year row (found only by grepping the
  CLASS), and then **missed three more** — LiabilityTrajectoryChart, Legal,
  ForecastAssumptionsPanel — which only the rendered-shape gate found;
- it **COUNTED** `DebtPayoff`, which maps a tuple to render `card-forged` CARDS
  and is not a pill row at all.

**A negative is bounded by what you searched, not by what exists** — and each
widening of the search found more. The gate matches the rendered SHAPE for that
reason.

**THE SPLIT WAS THE REAL WORK, and it is a refusal as much as a build.** Three
kinds exist, not one: outlined pills (consolidated); **joined FILLED groups**
(`pct|flat`, `upfront|monthly_charge`, MaintenanceFormModal's mode row) — a single
block with a filled active segment, a genuinely different control, **still
open**; and rows with per-option **icons + tooltips** (CreditCardEngine strategy
and payment-mode). Folding either into `SegmentedControl` would have produced a
component configured by flags rather than one that means something.

Gate `one-segmented-control.test.ts`, proven RED by restoring the actual
`Accounts.tsx` defect. Its allowance list carries **a written reason per entry**,
because an inventory defined by exclusion grows invisibly.

### 0i. THE FILLED GROUP IS THE NEXT SLICE — **9 instances, 6 files**, measured
**NOT 3. My "three instances" in item 0h was a FOURTH under-count**, corrected
here before anyone builds on it. The filled, joined group — active segment
`bg-primary text-primary-foreground`, inactive `bg-secondary` — is:

| File | Count |
| --- | --- |
| `BudgetControl.tsx` | **4** (two pairs: `flat\|pct`, `preTax true\|false`) |
| `Transactions.tsx` | 1 (`upfront\|monthly_charge`) |
| `SavingsGoals.tsx` | 1 |
| `ForecastAssumptionsPanel.tsx` | 1 (`pct\|flat`) |
| `CreditCardEngine.tsx` | 1 |
| `MaintenanceFormModal.tsx` | 1 (via a local `modeBtnCls` helper) |

⚠️ **WHY EVERY EARLIER SEARCH MISSED THEM, and it is a different reason each
time.** `BudgetControl`'s four are written as **explicit adjacent buttons, not a
`.map()`**, so no `as const).map(` search could ever reach them.
`MaintenanceFormModal`'s classes live **inside a helper function**, so no
className scan sees them either. **Four searches, four different blind spots** —
which is the argument for measuring the rendered shape rather than an idiom.

⚠️ **AND DO NOT GATE THIS ON `bg-primary text-primary-foreground` ALONE — I
nearly did.** That is the ordinary PRIMARY BUTTON style: **84 hits across 46
files**. A gate on it would have cried wolf on the entire app. The discriminator
is that class **paired with `bg-secondary` in the SAME className** (the ternary),
which is 8 inline hits in 5 files — the 9th being the helper.

**NOT BUILT: at 84% of the cap this is a 6-file refactor.** The count IS the
acceptance evidence per Tre's rule, so it is recorded rather than half-built.

⚠️ **AND "FILLED" IS ITSELF TWO SUB-SHAPES — read the markup before building one
component for all 9.** Measured on the two ends:
- **JOINED**: `ForecastAssumptionsPanel` wraps its segments in ONE bordered box
  with `overflow-hidden`; the segments carry no border of their own. That is a
  true segmented control.
- **SEPARATE**: `BudgetControl`'s four are individually bordered buttons in a
  `flex gap-1`, each rounded on its own. That is a filled PILL PAIR — closer to
  the outlined row already consolidated than to the joined block.

**So the next session decides between two components, not one.** Building a
single one with a `joined` flag is precisely the flag-configured component this
whole pass has been refusing, and it would be the fourth time the count said one
control where the markup said two.

**THE STANDING LESSON FROM ALL FOUR MISCOUNTS: a class search tells you where to
LOOK, never what the control IS. Open the markup before you commit to a shape.**

⚠️ **AND MY OWN FIRST DIFF SHIPPED A COIN TOSS DRESSED AS AN OVERRIDE — caught in
review, before the commit.** Three call sites passed `flex-nowrap` and `!gap-1.5`
through `className` to beat the component's own `flex-wrap gap-2`. **Tailwind
utilities in the same group have EQUAL specificity, so the winner is decided by
the order Tailwind emits them in its stylesheet — not by the order they appear in
the class string.** `!gap-1.5` only worked because `!important` forced it, and
**reaching for `!important` was the tell that the API was missing something**
rather than that the override was clever. Replaced with explicit `wrap` and `gap`
props. **A source gate cannot see this** — every class name is present and
correct — so it would have needed a rendered frame, or this read.

### 1. A RENDERED FRAME OF THE SPANISH WHAT'S-NEW DIALOG — NEEDS ONE SIGN-IN FROM TRE
Resolution and completeness are gated; **FIT is not**, and `WhatsNewDialog` is
`max-w-sm` while Spanish runs longer. Blocked on exactly one thing: the
Claude-controlled Chrome is **SIGNED OUT** on `http://localhost:8080` (probed —
no `sb-*-auth-token`, and the app redirects to `/auth`). `dev-signin` reserves
that step for him and forbids scripting it. Everything else is ready: dev server
runs detached on 8080, Spanish catalogue ships, language comes from
`localStorage` so no UI hunt is needed.

### 2. [x] CHASE PAY OVER TIME — CLOSED. THE WRITE WAS ALREADY DONE. Do not redo it.
Verified by SQL against the live row (Prime Visa `9111bd9f`, written 09:00 ET
2026-09-14, BEFORE the handoff said it had not been): three Pay Over Time
tranches, `sum_min` **198.83** (the round-trip check PASSES), fee 23.70, balance
2101.39, each `fixed_term: true`. Ask `573ecc2b` closed.

⚠️ **AND THE DEFERRED-INTEREST FINDING WAS FALSE ABOUT TRE'S HOLDINGS.** Chase
**Equal Pay is an equal-payment instalment, not deferred interest**, and the
arithmetic settles it across all FIVE of his plans: remaining balance ÷ monthly
instalment = months to `promo_end_date`, to three decimals — 5/5, 5.998/6,
10/10, 9.999/10, 11/11. Five plans each retiring exactly at expiry is the
product definition. `balance-tranches.ts` already recorded this on 2026-08-20
and the newer note contradicted it without testing it. **The general gap is
real and is now documented in `src/lib/balance-tranches.ts`; the exposure is
zero.** Ask `644c712e` closed; correction filed to Sam as `3a17ffab`, because
`8724d154` had already been escalated to Tre on the false premise.

### 3. [x] VERCEL PAGEVIEW — ANSWERED. IT IS ONE TOGGLE, AND IT IS TRE'S.
`/_vercel/insights/script.js` serves REAL JavaScript on the live origin — and
the negative control is what makes that meaningful: a made-up `/_vercel/` path
returns `text/html` index.html from the SPA fallback, so a bare 200 proved
nothing. A POSTed pageview is answered **200 OK**. The API still answers **404
"Web Analytics not found"**. Those do not conflict: **the ingest endpoint is
fire-and-forget and accepts-and-discards when the product is off, so a 200 there
is NOT evidence of arrival.** Web Analytics is simply not enabled in the
dashboard.

⚠️ **A DRIVEN BROWSER CANNOT MEASURE THIS AND REPORTS THE GATE AS BROKEN WHEN IT
IS CORRECT** — two independent reasons, either sufficient: the automated Chrome
sends `doNotTrack: '1'` AND `globalPrivacyControl: true`, and Vercel's own
script self-disables on `navigator.webdriver`. Recorded in
`VercelAnalytics.consent.test.tsx`. Do not chase it.

### 4. [x] COUNTRY LEADERBOARD — SHIPPED, both halves.
Derived from browser locale/time zone, no IP geolocation, correctable, and
leavable. `p_scope` now accepts `'country'`; anything else is still refused.

⚠️ **THE MEASUREMENT THAT CHANGED THE DESIGN:** the plan was to backfill from
`profiles.timezone`, already collected — it is **NULL for 45 of 49 profiles**, so
that would have covered FOUR PEOPLE while reporting success. Derivation is
client-side and coverage grows as people return.

⚠️ **THE FIRST DB RUN COULD NOT HAVE FAILED** — global and country both returned
cohort 0, so the scopes were indistinguishable. The real control seeded 31 real
users, 19 US / 12 CA, and got **global 31 vs country 19, a strict subset**, then
rolled itself back to the exact pre-state (1/0/0).

**Expect every country board to read "not enough people yet" for a long time** —
a country cohort is a subset, so it reaches the floor of 20 strictly later. That
is the floor working. **Do not lower it to make the screen look busier.**

### 5. Friends UI formatting — OPENED IT AND FOUND SOMETHING BIGGER FIRST (`12ebe70c`)
**Dark mode never declared `color-scheme`, so EVERY native popup in the app was
drawn in light chrome on a near-black panel** — select lists, date pickers,
number spinners, scrollbars, autofill. 147 form controls, every screen, every
user on the default theme.

Measured in Chrome on the LIVE site: with `.dark` applied, body computed
`rgb(5, 5, 5)` while `color-scheme` computed **light**. `.light` had always
declared it; `:root` and `.dark` never did.

⚠️ **CSS ON THE CONTROL CANNOT FIX THIS**, which is why it survived every visual
review. Those popups are drawn by the OS; `background-color` styles the CLOSED
control and does nothing to the list it drops open. It is the exact defect Tre
reported on treforged.com and asked to be prevented "anywhere".

Gate `src/__tests__/color-scheme.test.ts`, proven red twice against the REAL
defect. A source scan is the honest instrument — jsdom has no OS control layer,
so a computed-style check there would be green over nothing — and the test says
so. Verified in the built CSS, not just the source.

**THE FORMATTING PASS IS NOW DONE TOO** (`dedfa915`). The count was **2
implementations across 3 ADJACENT fields**, and the drift had already cost a real
accessibility defect: the username input carried `outline-none` with NOTHING
replacing it, so **the first field in "Add a friend" had no visible focus state**
— a keyboard or switch user landed on an invisible cursor, while the two fields
directly beneath it were fine. The screen looks consistent until somebody presses
Tab, and nobody presses Tab in a screenshot.

Consolidated into `src/components/shared/field-classes.ts`. Two constants, not
one, because the fix differs by shape: a ring on an input INSIDE a wrapper draws
inside the box, so the wrapper takes `focus-within` — and `focus-within` rather
than `focus`, since a wrapper never receives focus itself and `focus:` would
never match.

Gate proven red against the defect that ACTUALLY shipped (3 of 5 fail), plus two
adjacent ways back in. ⚠️ My own first version of that gate was aimed at the
source TEXT and failed on correct code, because the ring arrives by
interpolation; it asserts resolved values now.



### 6. [~] REVENUE WITHOUT TRE'S SCREEN — BUILT AND PROVEN, ONE INPUT SHORT
`bbef1fc4` adds `scripts/app-store-revenue.mjs` + a manual-only `revenue-report`
workflow. **Exercised against Apple's real API, run `34904953976`:**
`credential: OK (authenticated against /v1/apps)` — so the ES256 JWT minting
works end to end and the key is valid — then **exit 2, `FAILED (no vendor
number)`**, rather than printing a figure. The zero-vs-refusal rule held on its
first real run.

⚠️ **THE KEY'S SALES ROLE IS UNTESTED AND MUST NOT BE ASSUMED.** The run never
reached the sales endpoint. "credential OK" means the key AUTHENTICATES, not
that it may read sales — an upload-only key passes that same probe and fails at
the next call with exit 4. The probe and the sales call are deliberately
separate so those two causes can never be confused.

Blocked on `APP_STORE_VENDOR_NUMBER` (ask `24480c62`): Apple requires it on
every sales request and exposes **no API that returns it**. Not a credential.

⚠️ `dsaEncoding: 'ieee-p1363'` is load-bearing and measured — 64 bytes as JWS
requires, against Node's DER default of 72. A DER signature gets a flat 401 from
Apple with no hint, which reads as a bad key and gets a good one rotated.


### NOT OPEN — `798c0ed9` is deliberately deferred, not forgotten
Sam ranked it above the country work on 2026-09-14. **The correctness half is
already fixed**: the stale row now says "Not updated this week" instead of
"Private", so nothing asserts anything untrue about another person. What remains
is a product question — server-side snapshot publishing — refused because it
means a SECOND definition of money-adjacent bucket logic in Deno. Trigger to
revisit is written on the ask: real participation, or the bucket functions
extracted somewhere both runtimes can import.

---

## 2026-09-14 OVERDRIVE — what shipped, and the two instrument traps

`89f99dd9` switches · `81ff4885` the red main · `c0eda27e` what's-new i18n.
Gates each time: `npx tsc --noEmit` clean, `npm run lint` 0 errors,
`npm run test:tz` all three zones 4522 passed / 1 skipped (was 4513).

### ⚠️ MAIN WAS RED AND NO COMMIT CAUSED IT — read this before doubting a gate here
`useAppliedActions.undoneCharges.test.tsx` hardcoded `created_at:
'2026-09-13T15:48:59.000Z'` against `UNDO_OFFER_WINDOW_HOURS = 24`, so it aged out
at 11:48 ET on 09-14 and two tests went red on their own. **A clock-dependent test
fails when nobody touches anything**, which is the hardest failure to attribute —
it sends you into the hook, `offerableUndos` and the auto-apply guard, all correct.
Proven both ways with an injected `now` before anything was changed. Fixture is now
`at(1)`; bumping the date would only re-arm it. Swept the family: one bomb, one file.

### THE SWITCH COUNT WAS 3, NOT 1 — and the record said 1
The 09-13 note "the others now use it" was FALSE when written. `ConsentBanner.tsx`
and `Legal.tsx` still carried hand-rolled copies with a flat `bg-muted` OFF track
and no border, on COOKIE CONSENT controls — off read as un-highlighted, which is
exactly Tre's complaint — and the `Legal.tsx` copy had NO `aria-label` at all.
Both now use the shared `ToggleSwitch`. **`one-switch.test.ts` WALKS `src/` and
derives the file list**, so the next copy is caught; proven red with a planted
mutant. It flagged itself on first run and the pattern is built by concatenation,
because excluding `__tests__` would let a real switch hide in one.
Measured in Chrome on `/privacy`, both states in one paint: ON knob 18.0..31.5,
OFF 3.3..16.8, in a 36px track. No escape.

### ⚠️ THE DRIVEN CHROME TAB IS `visibilityState: "hidden"` AND THAT FREEZES STYLE SETTLE
A post-click read showed `aria-checked=true` with the track still dark and the knob
still left — and two identical-class siblings computing DIFFERENT colours, which is
impossible in a settled engine. That was the tell; the renderer then timed out
twice. **An earlier round was worse: the dev server had DIED mid-session**, so those
readings came through a dying instrument. Discarded, not reported as a defect.
**So: take the both-states frame from ONE paint before any click, and never trust a
post-transition computed style in a backgrounded tab.** Start the server detached
(`Start-Process cmd /c "npm run dev"`), not from a Bash tool call — it dies with it.

### CLOSED WITHOUT CODE
- Overdrive item 6 (`Scan the bundle that actually ships` RED) is a FALSE ALARM.
  Last red run finished 44 seconds BEFORE `9d628285` disabled its triggers. The two
  states were already distinguishable. Ask `9a8286c5` closed with evidence.
- Item 2's popup already shipped and is mounted; only the language half was missing.
- Item 7 `.nvmrc` already said 22. Added `engines` + `check:node`, which WARNS and
  exits 0 on purpose — a gate always red on this machine is one people stop reading.

### NEXT UP
1. **A RENDERED FRAME OF THE SPANISH DIALOG.** Spanish runs longer than English and
   `WhatsNewDialog` is `max-w-sm`. Resolution and completeness are gated; FIT is not.
2. Item 4, the Friends UI formatting half (add-by-username already ships, v9).
3. Item 5 Plaid settlement lag — he raised it TWICE, and the recorded answer is "it
   delays, it does not break". **Re-read what he actually asked before re-measuring**;
   twice usually means the answer never reached him, not that it was wrong.


## 2026-09-13 NIGHT — FOURTEEN SHIPPED. Read the two correction blocks below before anything else.

`origin/main` 0/0 by CONTENTS after every push. Gates each time: `npx tsc --noEmit` clean,
`npm run lint` 0 errors, `npm run test:tz` all three zones — **4496 passed, 1 skipped**, up from
4384 at the start of the evening. Every commit mutation-proved RED, every mutated file restored
byte-exactly by sha256 in a `finally`.

### ⇢ FIRST UP: NOTHING IS BUILDABLE WITHOUT TRE. Read this before looking for work.

Seventeen shipped. Every remaining ask is blocked on him, and each blocker is a real one rather than
a parking label:

- **`d0f54114` country leaderboard** — needs his call on collecting a new piece of personal data to
  fill a per-country cohort when the GLOBAL cohort is 1 of 49. Recommendation on file: wait, or
  derive coarsely from `profiles.timezone`, which is already collected. `p_scope` already exists so
  it slots in with no reshaping.
- **`5d6dbada` browser undo** — BankActivity's per-row `linkOneWithUndo` and the batch panel need a
  signed-in REVIEWER session. The seed exists (`scripts/seed-reviewer-deck.sql`); pressing undo in a
  Chrome signed into Tre's own account writes to his real ledger, which already happened once this
  week. ONE manual sign-in unblocks it. The query-shape half IS done and gated.
- **`d9ab0509` categories + dashboard IA** — he asked for ONE pass, not two. Measured and filed.
- **`0e289ce7` Vercel Analytics** — a second tracker changes what the privacy policy promises.
- **`73df5d2b` profiles p95** — the remaining half is the FREE-plan shared compute, a money call.
- **`1829a127` measure the dev AI** — blocked upstream.

**Statement reading is COMPLETE, both doors.** Parser, paste, and PDF upload all ship and are wired
beside each card's interest-saving balance. pdf.js is a dynamic import verified as its own build
chunk with a LOCAL worker asset — never a CDN, because a statement decoded by a third-party script
is what that dialog's copy promises does not happen.

⚠️ **THE FIRST REAL STATEMENT PUT THROUGH IT IS THE TEST THAT MATTERS, AND IT HAS NOT HAPPENED.**
jsdom cannot decode a PDF, so `extractPdfText` is mocked and only the wiring is proven; the parser's
fixture is reconstructed from the captions Sam named, not captured text. Replace it the first time a
real extraction is available.

### ⚠️ A FIXTURE BUILT FROM HOW A DOCUMENT *LOOKS*, TESTED AGAINST HOW IT *EXTRACTS*

The statement reader shipped with the limit stated: no real PDF had been through it. I put one
through, and it came back RED.

Every money figure was correct. **`promoRates` was EMPTY.** Real pdf.js returns the page as ONE
184-character line with no newlines; my reconstructed fixture used caption-per-line, because that is
how a statement reads on paper. The promo regex was anchored `^`/`m`, so it needed the label to open
a line — true of the reconstruction, never true of reality. **The money fields survived only because
they match on ADJACENCY, which holds in both shapes**, so the single property that differed between
the two worlds was the only thing that broke.

⚠️ **THE MUTATION ASYMMETRY IS THE INSTRUMENT WORTH REUSING.** Restoring the old regex kills exactly
ONE case — the real-PDF promo — and leaves the reconstruction's promo test PASSING. **A mutation that
kills one fixture and spares another measures which fixture is real.** Both are kept on purpose: a
pasted statement genuinely has line breaks, an extracted one genuinely does not.

⚠️ **STILL NOT CLOSED, and do not let the above be read as closing it:** `extractPdfText` is still
exercised only through a mock (jsdom has no worker, no canvas); the PDF was synthetic, without a real
statement's columns and page furniture; and the extraction ran through NODE's pdf.js — same library,
different entry path. **No real bank statement has been through the app.**

### ⚠️ THE FRIENDS BOARD EMPTIED EVERY SUNDAY NIGHT AND LIED WHILE IT DID (fixed 2026-09-14)

Measured at 01:10 UTC, which was **21:10 SUNDAY** for Tre: `date_trunc('week', now())` had rolled to
2026-09-14, the newest snapshot was week 2026-09-07, current-week rows in the whole table were ZERO.
The board went blank on a Sunday evening — and the RLS policy returned only current-week rows, so a
friend's older row never reached the client and the row fell through to **"Private"**, a false claim
about somebody else's privacy choice.

**`stale` ("Not updated this week") was UNREACHABLE IN PRODUCTION while its unit tests stayed green** —
the branch was always right; the DATABASE made it dead. Policy now admits the last four weeks, with
both consent gates unchanged and verified live plus three controls (stranger sees 0, the bound binds,
both predicates still present). **Do not delete `stale` as dead code.**

Also closed the residue I had named and not fixed: `is_metric_shared` answered about ANY user id.
Revoking EXECUTE would have broken the policy — an RLS expression runs as the querying user — so the
guard went in the body, and `leaderboard_global_stats` now reads `leaderboard_shares` directly
because a global cohort is legitimately made of strangers.

### ⛔ FIVE CLAIMS DISPROVED BY MEASUREMENT. Do not re-derive any of them.

1. **"Nothing merges his planned row with the real one" — FALSE.** SIX of 18 typed rows are already
   linked. The defect was that the offer EXPIRED: "Link and correct" renders only on an UNREVIEWED
   charge, so answering it — which he must do — destroyed the only route to the link. Closed by a
   ledger-side link (`b710ddf4`).
2. **The Plaid settlement lag is NOT breaking the match.** Payroll settles exactly 2 days late
   against a 5-day window. It delays; it does not break.
3. **"Category totals stay overstated by refunds" — FALSE.** NOTHING computes category spend from
   `synced_transactions`; every consumer was grepped. Ask dropped with the reasoning.
4. **"Debt payments double-count via the bank rows" — FALSE.** `transfer-pair-detection` paired all
   three of his real card payments, including the two Plaid labels `INCOME` on the card leg, and
   the queue collapses them. The REAL defect was in the ledger and is fixed — see below.
5. **The privacy policy's "We do not use third-party analytics trackers" — FALSE.** GA4 is loaded
   and called from three places. Disclosure corrected; practice unchanged.

### ⚠️ THREE DEFECT SHAPES THIS SESSION PRODUCED, ALL NOW GATED

- **A dedupe keyed on a free-text NOTE the app's own button fills with a bank descriptor**, so a
  card payment counted twice. A provider-written string is not an identity.
- **Twelve write paths could reach a real account from DEMO mode** — the whole car-builds family.
  `add` inserted REAL rows while a visitor browsed fixtures. 57/57 guarded, gate in
  `demoWriteGuard.test.ts`. When a read path gets a demo branch, the writes beside it need one in
  the same commit.
- **`revoke ... from public` does NOT remove Supabase's direct `anon` grant.** Every new function is
  born anonymously callable. Read the grant back after every function migration.

### The measured state of friends / leaderboard, so nobody re-measures it

- **49 accounts, exactly ONE sharing anything** (Tre's main, written 19:03 — i.e. AFTER the toggle
  fix, so that fix works). His SECOND account has no share rows at all: its toggles were pressed
  before the fix and have not been pressed since. **That is why one side shows nothing.**
- **Only 2 of the 4 metrics can ever publish**; `debt_payoff` cannot be rescued by a proxy because
  no balance history table exists and `total_liabilities` includes the car loan.
- **The global board's cohort is 1 against a floor of 20**, so it says "not enough people yet" for
  everybody. That is the guarantee working.
- Username claim ships; **invite by username ships and is DEPLOYED** (friend-link v9), bounded by
  sharing the 5/hour invite budget with the slot spent BEFORE the lookup.

### ⚠️ CATEGORIES: THE TRAP IS IN THE OBVIOUS FIX (`d9ab0509`)

26 offered, 19 ever used, 7 never. **Do not drop the unused ones.** Only THREE accounts have any
transactions, so zero usage is a fact about a 3-user sample — and Rent, Mortgage and Utilities are
among the most common categories in personal finance. I proposed dropping them and corrected myself
before anyone acted on it.

---

## 2026-09-13 EVENING — FOUR MORE SHIPPED, AND TWO RECORDED "FACTS" WERE FALSE

`origin/main` 0/0 by CONTENTS after each push. `b710ddf4` (ledger-side link) · the money-in/paycheck
fix · the unsourced-metrics fix · the global standing board. Gates each time: `npx tsc --noEmit`
clean, `npm run lint` 0 errors, `npm run test:tz` all three zones (**4421 passed, 1 skipped**, up
from 4384). Every commit mutation-proved RED, every mutated file restored byte-exactly by sha256 in
a `finally`.

### ⛔ TWO THINGS THIS FILE ASSERTED THAT MEASUREMENT DISPROVED. Do not re-derive them.

1. **"Nothing merges his planned row with the real one, so his typed figure stands forever" — FALSE.**
   SIX of his 18 hand-typed past-dated rows are already linked, every one through the Bank Activity
   queue. The mechanism works and he uses it. The real defect was that the offer EXPIRES: "Link and
   correct" renders only on an UNREVIEWED charge, so answering the charge destroys the only route to
   the link, permanently. Closed by a ledger-side link (`b710ddf4`).
2. **The Plaid settlement lag is NOT breaking the match.** Payroll settles exactly 2 days late
   against a 5-day window, and the 08-07/14/21/28 paychecks are all linked. The 90-day average in
   the old note is the 2026-08-08 backfill inflating it. It delays; it does not break.

**A third correction, mine, mid-slice:** I measured the estimate band (10%/$5) against his ledger,
saw it produce 5 candidates where the tight band produces 1, and concluded wiring it in would be a
regression. Wrong — `tight ?? wideMatch` short-circuits, so a tight match can never be displaced.
The measurement stood; the inference did not.

### ⇢ FIRST UP: `d1a8a06a` — refunds are money-in but NOT income.

Named residue of `81afa6d2`. A refund reverses an expense; treating it as income overstates earnings.
Self-contained, and the queue work this evening has just been through every surrounding file.

### The measured state of the friends/leaderboard feature, so nobody re-measures it

- **49 profiles. Exactly ONE user (Tre's main) has enabled any metric**, written 19:03 2026-09-13 —
  i.e. AFTER the toggle fix, so that fix works and saves. His SECOND account has no share rows at
  all: its toggles were pressed before the fix and have not been pressed since. **That is why he sees
  nothing on one side.** The friendship itself is real and accepted (18:40, `friend_links`).
- **Only 2 of the 4 metrics can ever publish.** `Dashboard.tsx` passes `revolvingPeak`,
  `revolvingCurrent` and `budgetCategories` as hardcoded `null`. Now declared in one place
  (`UNSOURCED_METRICS`) and shown as unavailable rather than as a dead switch.
- **`debt_payoff` cannot be rescued by a proxy.** No balance/statement/card-history table exists at
  all (checked `information_schema`). `net_worth_snapshots.total_liabilities` includes the car loan,
  so it would inflate a "debt paid off" score. Do not reach for it.
- **The global board's cohort is 1 against a floor of 20**, so it says "not enough people yet" for
  everybody. That is the privacy guarantee working, not a bug.

### ⚠️ `REVOKE ... FROM PUBLIC` DOES NOT REMOVE SUPABASE'S DIRECT GRANT TO `anon`

Supabase ships `alter default privileges in schema public grant all on functions to anon,
authenticated, service_role`, so **every new function is born anonymously callable** and a revoke
from PUBLIC does not touch it. `has_function_privilege('anon', ...)` read TRUE after the migration I
believed had closed it. **Read the grant back after every function migration**; add an explicit
`revoke execute ... from anon`.

---

## 2026-09-13 LATE — the previous session's four (kept; partly superseded above)

**⇢ FIRST UP: MAKE THE SIM CONVERGE WITH AN UNCONDITIONAL OVERDRAW.** Measured in Chrome on
2026-09-13, five reads over 25 seconds: with a card set to always-pay-full on a month that cannot
cover it, `debtCashConverged` never becomes true, so **/debt's "at plan" interest has no figure at
all**. The hero now NAMES that cause instead of saying "hasn't finished calculating" (`38b7d2b2`)
— **the copy is fixed and the convergence is not, and nothing in that commit claims otherwise.**
The fixed point assumes month-0 payments fit inside the pool; `m0FloorPins` now pins an
overdrawn payment. That is engine work in `useCardProjection`'s refinement loop.

### 🚨 A WALK ON `/demo` SILENTLY BECAME A WALK ON TRE'S REAL ACCOUNTS, AND MY WRITES WERE REAL

**Read this before any browser verification in this repo.** On 2026-09-13 I opened `/demo`,
confirmed the DEMO / "Jordan's finances" banner, and pressed the always-pay-full toggle to exercise
the new shortfall path. **Several reloads later the page had dropped out of demo into his real
account and I did not notice** — `isDemo` read false only when I happened to check it at the end.

**The toggle press wrote `payment_unconditional = true` to his REAL Prime Visa** (balance
$7,991.16). Confirmed in the database, **reverted to false, and verified: `select count(*) …
where payment_unconditional is true` now returns 0.** Nothing else was touched — `applied_actions`,
`synced_transaction_reviews` and `transactions` all show **0 rows** changed in the window; exactly
one `accounts` row, the one reverted.

⚠️ **SO THE FIGURES IN `38b7d2b2`'s COMMIT MESSAGE ARE WRONG ABOUT THEIR SOURCE.** It says "demo
persona" and "demo data"; **$2,526 liquid, $3,223 safe minimum and $7,991 are HIS OWN numbers.**
The DEFECTS it reports are real and the fix stands — but the provenance is misstated in the durable
record, which is why it is corrected here rather than left.

**The cause is a known live bug** — a peer session shipped `aaeee75b` *"a refresh dropped you out
of the demo and into your real accounts"* the same hour. **It did not save me**, so either the fix
does not cover this path or my tab predated it. **Do not treat the demo banner as a standing
guarantee: re-assert `isDemo` immediately before every write-shaped press**, not once at the start.

**The cheap habit that would have caught it:** read `isDemo` in the SAME evaluation as the press,
and refuse to click if it is false.

### ⚠️ THE BROWSER WALK EARNED ITS KEEP IMMEDIATELY — read this before trusting a green suite
Partial walk done (/demo → /dashboard → /debt, toggle pressed both ways). It found **two real
defects that every gate had passed**, on work written hours earlier the same night:

1. **"Safe to Pay $7,991" against $2,526 of liquid cash, with NO warning** (`38b7d2b2`). The old
   predicate is `availableCash − minimumsDue < 0`, and an unconditional card is settled in FULL so
   it is never a minimum left unmet — the subtraction came out large and POSITIVE. **The tile says
   *Safe*.** The number proving the month did not fit was on the row underneath, unread.
   **The tests written that night asserted the shortfall RENDERS. None asked what the tile beside
   it was claiming.**
2. **The convergence failure above**, visible only as a permanent "hasn't finished calculating".

⚠️ **AND MY OWN FIRST FIX HAD A HOLE THE MUTATION FOUND.** Disabling the CALL SITE — passing `[]`
where the rows' shortfalls belong — left **all 3,180 lib tests passing**, because the new test
covered the HELPER and the defect lived entirely in the FEEDING.
`month0-debt-breakdown.cashWarning.test.ts` is aimed at the wiring and fails on that mutation.
**A test of a helper is not a test of the caller that forgot to call it.**

**STILL OPEN on the walk (`d235eb39`):** the reviewer-account onboarding reset, every other route,
and the Dashboard widget's re-wired banner — **that banner was changed and NOT exercised in a
browser**, only /debt was.

1. ✅ **`db95d36a` CLOSED — and the ask's premise was too kind.** It said the SHORTFALL never
   reached a screen. Measured first: `paymentUnconditional` occurred **ZERO times** in
   `useCardProjection.ts`, `cardProjectionResim.ts` and `month0-debt-breakdown.ts`, so the
   PAYMENT itself was still being silently scaled down on the only path users see. All three
   shipped parts had landed on the one-shot `getPayoffRecommendations` path.
   New `src/lib/unconditional-payment.ts` is the one derivation, called by BOTH. The gap rides
   `perCardAdjusted` → `CardRecRow` → both renderers, wording from one shared constant.
   ⚠️ **Named limitation, in the code:** with 2+ unconditional cards overdrawing, the per-card
   split follows settlement order (`cards` order here, strategy order on the one-shot path). The
   TOTAL is identical; with one such card so is the attribution.
2. ✅ **`da5c564e` CLOSED — "Link and correct" has its undo.** New `restoreTransaction` step
   restores **amount, date AND origin together**; restoring only the amount would be the same
   partial-undo lie one field over, because `reconciledPatch` writes all three.
   `reconciliationUndoStep` lives beside `reconciledPatch` so the pair cannot drift, and the lib
   test compares KEY SETS so growing one without the other fails immediately.
   ⚠️ **A second defect found while wiring it:** the undo executor ended in a bare `else` that
   assumed `setCategory`. Any new step kind would have cleared a label instead of restoring an
   amount, counted it done, and reported a successful undo. Every kind is named now.
3. ✅ **Auto-apply prerequisite 1 — the deck recorded its undo ONLY on run completion.** Now
   recorded at the moment of each decision, one row per decision, claimed by charge id before the
   await. `markUndone` is a new optional prop and is what stops this being a regression: the
   in-session undos retire the stored row, or it would go on offering to reverse work already
   reversed.
4. ✅ **Auto-apply prerequisite 2 — the outlier gate was INERT BY CONSTRUCTION.**
   `MerchantLinkRule` carried no amounts, so `isOrdinaryForMerchant` abstained on every call and
   waved through the exact large-deviation case it exists to catch. `MerchantLinkRule.amounts`
   now carries the winning rule's own population (others excluded — a different obligation is a
   different population; a missing amount is dropped, never counted as 0, because a zero makes
   the gate MORE permissive). Use **`linkMemoryVerdict(rule, charge, target)`** — one
   construction, so the wiring cannot pass `[]` and silently disable the gate again.
   ⚠️ **`linkMemoryVerdict` has NO production caller yet. Wiring auto-apply is a separate
   decision and this is where to start.** The remaining judgement is the one in the section
   below: the panel SHRINKS, it does not vanish.

5. ✅ **`566472e8` CLOSED — auto-apply is WIRED (`45ea5098`).** The deck now accepts a remembered
   link without asking when every gate agrees. **A third hole surfaced while wiring it, and it is
   the lesson worth keeping: an ABSTAINING gate must not produce `auto`.**
   `isOrdinaryForMerchant` returns true below its history floor — right for a SUGGESTION, and a
   licence to write unwatched if you let it through. A merchant with no readable amounts was
   auto-applying with **no amount test of any kind**. `linkMemoryVerdict` now returns
   `ask`/`insufficient-amount-history`.
   ⚠️ **`acceptCard(auto: boolean)` is a SEPARATE function from `onAccept` on purpose.**
   `DecisionDeckCard` wires `onClick={onAccept}`, so a `(auto?: boolean)` parameter receives a
   **MouseEvent** — every manual tap would have been recorded as auto-applied, with the prop typed
   `() => void` so TypeScript says nothing. Do not "simplify" these back into one.
   ⚠️ `duplicateThisPeriod` is computed from THIS RUN's cards only — narrower than its name, so it
   can add a prompt but never skip one. Stated in the code.
6. ✅ **`a22f6bb5` CLOSED — and the ask's attribution was WRONG, which is the useful part.** The
   $15-against-$1,100 suggestion did NOT come from the matcher: its band is `max($0.05, 1% of
   rule)` = **$11** on an $1,100 rent, so a $15 charge was never a candidate. It came from
   merchant-link-memory, which offered on merchant history alone. Fixed in `857f8323`, pinned at
   `merchant-link-memory.test.ts:188`. **Chasing "the matcher" would have found nothing wrong
   there** — test the premise before the code.

⚠️ **NOTHING TONIGHT WAS VERIFIED IN A BROWSER. jsdom only, across all six commits** — including
the one that writes without asking. See FIRST UP.

## 🔚 CLOSE-OUT — Ada `bb1d77`, 2026-09-13. Four Ada sessions were live; `a75c84` keeps the desk.

Sam stood this session down: a dispatch loop of his had opened four Ada sessions on one tree and
one ask queue. Nothing here is half-finished — **`origin/main` 0/0, nine commits, all gated.**

**Closed with evidence:** `db95d36a`, `da5c564e`, `566472e8`, `a22f6bb5`, `60c2cec0`.
**Filed:** `1e8c6f87` (the `/demo` drop-out, below).
**Left OPEN deliberately — `d235eb39`, the full walk, is only PARTLY done.** Walked
`/demo → /dashboard → /debt` and pressed the always-pay-full toggle both ways. **Not walked:** the
reviewer-account onboarding reset, every other route, and the Dashboard widget's re-wired cash
banner — **that banner was changed and never opened in a browser.** Do not close it as done.

**The one thing a successor must not repeat:** see the `/demo` section below. Re-assert `isDemo`
in the SAME evaluation as any write-shaped press. Checking once at the start is what cost me a
write to real data.

## ⚠️ WHY THIS DESK KEEPS STALLING — MEASURED 2026-09-13, NOT A PROMISE

Tre, 2026-09-13: *"bro, it never resumed. Take a look and diagnose why this is going on for
too long. It is too many times."* He is right that it is repeated, and the cause is
mechanical rather than a lapse of discipline. **Two independent things must both hold for
this desk to keep working, and the second one is dead on this machine.**

**1. A turn ends the moment the session stops calling tools and writes prose.** There is no
autonomous loop inside a session. So any report written at a commit boundary IS the stop —
"continuing with the next item" is the last thing such a session ever does. This is the part
a desk can control, and the rule is: keep making tool calls across slices, and report only
when you need something or you have run out.

**2. THE BACKSTOP THAT WAS SUPPOSED TO RESTART A STOPPED DESK CANNOT RUN AT ALL.** Measured
live at 00:24 tonight, not read from the charter:

```
Claude Resume Loop         Ready  Interactive  9/13/2026 12:16:01 AM  0x800710E0
Claude Session Watchdog    Ready  Interactive  9/13/2026 12:16:45 AM  0x800710E0
Claude Usage Resume Watch  Ready  Interactive  9/13/2026 12:18:01 AM  0x800710E0
```

All three fired **tonight, in the exact minutes he was saying it never resumed**, and every
one was refused. `0x800710E0` is the scheduler refusing an Interactive-logon task; the
machine-wide charter records that **no Interactive task can run on this host, signed in or
not**, and that the cause is still unknown after the logon-rights candidate was disproved.

**So a stalled desk is not late — it is permanently stopped until Tre types.** The resume
machinery provides ZERO coverage, and has provided none for days. That is why it is "too
many times": the discipline failure and the missing safety net are two different faults, and
fixing only the first leaves every future stall permanent.

⚠️ **DO NOT "FIX" THIS BY CONVERTING THE THREE TASKS TO S4U.** They launch `wt.exe` tabs, and
an S4U task runs in session 0 where a tab cannot appear. It would run, log, revive nothing,
and **report success** — trading a visible failure for a silent one. This is owned by Sam
(machine-level), not by this desk.

## 2026-09-13 — TRANSACTION MATCHING + NAV. All pushed, `origin/main` 0/0.

**FIRST UP: the unconditional-payment SHORTFALL never reaches a screen.** The column, the
engine and the toggle are all DONE. See "THE TOGGLE" below.

### ✅ THE TOGGLE IS COMPLETE — column, engine and writer all shipped

> ⚠️ **THIS SECTION SAID "THE ENGINE WORK DOES NOT EXIST" UNTIL 2026-09-13, AFTER THE ENGINE
> WORK SHIPPED IN `fc38deef` THE SAME NIGHT.** The commit landed and the section above it was
> never updated, so the next session was told to build a thing that was already built and
> tested. This is the repo's own documented trap — a handoff section is a CLAIM — caught here
> by grepping for the symbol before starting, not by reading the file. **Grep before you build.**

- `accounts.payment_unconditional` boolean NOT NULL default false — live DB + generated types
  (`cb513215`).
- The engine reads it: `credit-card-engine.ts:2537`. Unconditional cards are settled FIRST, off
  the top, and are **not clamped to `remaining`** — so the payment never shrinks to fit the
  month, which is the whole point of the setting (`fc38deef`). Tests:
  `src/lib/__tests__/credit-card-engine.unconditionalPayment.test.ts`.
- **The WRITER shipped 2026-09-13.** `CreditCardEngine.tsx`, in the payment-preference block:
  "Always pay this, no matter what", offered only on `statement` and `full`.
  **Until then NOTHING WROTE THE FLAG** — every card read `false` forever, so the feature was
  unreachable for every user on every surface while three green gates said it worked. The
  column, the engine and its tests were all real and all dead. **A feature with no writer is
  the shape a green suite hides best.**

### ✅ CLOSED 2026-09-13 LATE (`a4cff977`) — the shortfall renders. Kept for the REASONING only.
> ⚠️ The diagnosis below is right that the sim path never computed it, and WRONG to imply the
> payment was correct there: the sim did not read `paymentUnconditional` at all. See the top.

The engine computes `unconditionalShortfall` and `buildMonthlyDebtBreakdown` carries it
through (`credit-card-engine.ts:2875`, with its own warning about the wholesale rebuild that
ate it once already).

**But BOTH renderers read a different path.** `CreditCardEngine.tsx:1777` and
`DebtRecommendationsWidget.tsx:130` both render rows from `buildCardRecRows`, which is fed by
`month0.perCardAdjusted` — shape `{id, name, payment, maxPayment}`, produced by the SIM
(`useCardProjection`), not by `getPayoffRecommendations`.

**So the shortfall is not being DROPPED there; it was never computed on that path.** Do not go
looking for a missing field to pass through — that reading costs an hour. Making it render is
engine work on the sim path, and re-deriving `desired − pool` at the display layer would put a
number on screen that can disagree with the engine's, which is the failure the surrounding
code comments already warn about.

**Sam's ruling, already given, so do not re-ask:** if an unmissable plan minimum and a full
balance payment cannot both be met, the plan minimum wins and the full payment is reported
short. Show both, show the gap, never resolve it silently. **The shortfall must be a NUMBER**,
and a test must assert the magnitude on a month where the cash genuinely does not fit.

**Historical, kept because it cost two wrong aims:** `credit-card-engine.ts` ~2435's
`Math.min(desired, preferencePool)` looks like the defect and is the WRONG target for his
case — `preferenceCards` filters on `autopayFullBalance`, which is `balance <= 0`, so that
branch governs cards with no carried balance. A card with a real balance is sized further
down. The shipped fix settles unconditional cards off the top instead, before either path.

### The statement-parsing measurement (`1829a127`, blocked) — what IS established

- **The AI is `gemini-2.5-flash`** — `supabase/functions/ai-advisor/index.ts:26`, temperature
  0.5, `maxOutputTokens` 8000, consent version `2026-04-30-gemini-2.5-flash`.
- ⚠️ **THERE IS NO STATEMENT-PARSING CODE.** `ai-advisor` gives advice from account data and
  parses no documents. So "measure what it actually does" against ISB / minimum / plans-due is
  **aiming the check at an object that does not exist** — the real question is whether
  `gemini-2.5-flash` can extract those fields at all.
- **The three ground-truth numbers live ONLY in the ask text** — grepping the repo for
  `1451.88`, `773.05`, `198.83` returns zero hits. They are not a fixture yet.
- **Blocked on two artefacts, neither of which a desk should take:** his actual statement
  (personal financial data) or `GEMINI_API_KEY` / spending his deployed quota.
- **The way in:** build the known-answer harness against **synthetic** statements first. It needs
  no personal data, it is the reusable instrument the feature must pass, and only the final
  confirmation run needs his real document.

### Then: the Settings IA principle amendment (Account now exists at two levels)
Everything below is DONE unless it says otherwise.

### The four things that live nowhere else — read these before touching matching

1. **`merchant-link-memory.ts` offers on MERCHANT HISTORY ALONE.** Its own header says
   "Nothing here touches amounts". That is why a $15 Zelle was suggested against an
   $1,100 rent rule — and it is the SAME signal that should let the 25-link payroll card
   stop asking. **Same evidence, wrong verb:** history decides the SUGGESTION, never the
   ACTION. `auto-apply.ts` adds the terms history lacks.
2. **AUTO-APPLY COULD ONLY SHIP BECAUSE THE UNDO BECAME DURABLE FIRST.** All three undos
   used to live in React state, so the batch panel's "undoes in one press" was true only
   while it was on screen. Auto-applying against that would have removed a prompt AND the
   reversibility its own copy promises, for a write he is not watching. Order was:
   durable undo → auto-apply. Do not reverse it for the remaining surfaces.
3. **THE PANEL SHRINKS, IT DOES NOT VANISH**, against the literal "this section shouldn't
   exist". Costco really is Groceries some weeks and Shopping others; picking silently
   there is worse than asking because he never sees it. Sam has backed this.
4. **The Settings grouping principle (`settings-ia.ts`, 5d84b09d) NEEDS AMENDING** — Account
   now exists at two levels, a nav tab and a Settings panel. Say which belongs where.

### Numbers — measured vs chosen, do not re-derive

- **MEASURED** (`docs/matching-thresholds-measured-2026-09-13.md`): 26 categories offered,
  **21 ever used, 11 cover 90.5%**, and the **9 visible chips already cover 83.9%** — so
  "17 more" is the problem, not the chip row. Per-merchant CV spans **0.0%** (Apple,
  Banner Life, CFX) to **111.5%** (Costco), which is why no fixed tolerance can work.
  75 accepted links: median ratio 1.000, **lowest legitimate 0.113**, the bad pairing 0.0136.
- **CHOSEN** and labelled as such: `LINK_MEMORY_MIN_AMOUNT_RATIO` 0.05,
  `MIN_LINKS_TO_AUTO_APPLY` 3, `UNUSUAL_SD` 2.5, `MIN_HISTORY_FOR_OUTLIER` 5.

### Done tonight
`857f8323` amount floor · `852be90a` applied_actions table · `bb77c592` batch panel undo
`04f44ad2` deck run undo · `49cbe51a` link batch undo · `7b779365`+`1e2744f9` the rule
`ba193ff3` batch auto-applies · `65d477dd` Forecast→Transactions · `f418400f` sidebar
Forecast + doubled ⚠ + per-decision undo · `46e1a786` Account tab · `5d84b09d` Settings IA
`650f0775` corner concentricity · `33ff1318` notched toggles · `2c377599` PIN feedback
Data fix: review `77b9d6dd` deleted, backed up in `backup.synced_transaction_reviews_20260913`.

### Open / not done
- ✅ **Sidebar hover-overlay** shipped `872385d9`. ✅ **always-pay-full toggle** shipped in
  three parts: column `cb513215`, engine `fc38deef`, writer 2026-09-13.
- ✅ **SHIPPED `a4cff977` — the shortfall renders, and the payment is no longer scaled down.**
  (Was: "STILL OPEN, the remaining half of the toggle" — ask `db95d36a`.) A quietly reduced payment is the app lying, and the engine already refuses to
  reduce it — but the gap it reports reaches no screen. See the top of this file for why this
  is sim-path engine work and not a missing passthrough.
- ⚠️ **The payroll + variable-utility single-card prompts still ask, and "only the deck
  wiring remains" WAS WRONG — measured 2026-09-13 (ask `566472e8`, now blocked).** The rule
  in `auto-apply.ts` is correct and tested, and `autoApplyDecision` has **zero callers**, so
  the wiring really is missing. But wiring it as-is ships a feature that looks right and is
  not. Two prerequisites, both measured:
  1. **`DecisionDeck` records its durable undo ONLY on run completion** —
     `DecisionDeck.tsx:449`, `if (!complete || …) return`. An auto-applied decision is a write
     the user is NOT watching; if they close the deck mid-run it becomes irreversible. That is
     "removing a prompt AND the reversibility its own copy promises", which is the ordering
     item 2 below forbids. **Record at the moment of auto-apply, not at completion.**
  2. **`MerchantLinkRule` carries no amount history** (`merchant-link-memory.ts:51`; its own
     header says "Nothing here touches amounts"). So `autoApplyDecision`'s
     `unusual-for-this-merchant` gate abstains through `isOrdinaryForMerchant`'s
     `history.length < MIN_HISTORY_FOR_OUTLIER` guard — **INERT BY CONSTRUCTION**, silently
     waving through the large-deviation case Tre named in the ask itself. A limit that cannot
     bind reads as a guarantee. Plumb per-merchant amounts in, or do not claim that gate.
- ✅ **Per-ROW link buttons now have the durable undo the batch had** (2026-09-13). All eight
  `save.mutate(accept…)` call sites in `BankActivity.tsx` wrote a link and recorded NOTHING;
  they now go through one `linkOneWithUndo` helper, so the two paths cannot drift again. The
  transfer-pair picker records the partner's reversal too, and only if the partner write
  actually landed. Test: `BankActivity.perRowLinkUndo.test.tsx`, **proven red by mutation**
  (both positive cases fail when the record call is disabled; the failure-case test correctly
  stays green), file restored byte-exactly by sha256.
  ⚠️ **The batch's own comment asserted "Every row it did write is individually undoable"** —
  true of the batch's record, false of the buttons. **A comment stating a safety property a
  sibling path does not have is how the gap survived review.** Corrected in the same commit.
- ✅ **`link_confirm` IS NOW OFFERED AND REPLAYED** (2026-09-13). BankActivity renders an undo
  banner above the tabs for the latest `link_confirm`, executing all three step kinds in the
  recorded order (`deleteTransaction` before its charge's `removeReviews`, per `planDeckUndo`),
  and marking the record undone ONLY after every step lands. Four more tests, the two replay
  ones **proven red by mutation**, file restored byte-exactly by sha256.
- ✅ **`deck_decision` IS OFFERED TOO** — the same banner, the same executor. Its steps are the
  same three kinds `planDeckUndo` builds in the same money-first order, so nothing in the
  executor changed. `merchant_retro_pass` is deliberately NOT claimed here: its own panel offers
  it, and two banners for one act would let a user press undo twice.

  **The finding, kept because it is the general lesson:** two of three durable undo kinds were
  recorded to `public.applied_actions` and **no UI ever offered them.** A green suite hides this
  perfectly — the record is written, the steps are valid, the parser accepts them. **Writing the
  record was never the promise; getting the numbers back was.** Grep for the CONSUMER, not only
  for the caller. `MerchantMemoryPanel.tsx:39` filters
  `latest.kind === 'merchant_retro_pass'`, and that panel is the only consumer of the durable
  record anywhere. The deck's and the batch's own undos are IN-SESSION only.
  **So the batch comment "recorded to `public.applied_actions` so it can still be taken back
  afterwards" is half true**: it is recorded, and it cannot be taken back, because nothing
  renders a button for it. **This is the same shape as the always-pay-full toggle that had no
  writer — a feature complete at every layer except the one the user touches — and it is the
  second instance found in a single session.** Grepping for the CONSUMER is now as load-bearing
  here as grepping for the caller.
  ⚠️ **I nearly reported a different, wrong bug here.** `MerchantMemoryPanel.undo` skips every
  step that is not `setCategory` (line 126), which looks exactly like a silent-failure defect —
  until line 39 shows the panel only ever receives `merchant_retro_pass`, whose steps are all
  `setCategory`. **The `continue` is correct.** Reading the executor without reading what feeds
  it produces a confident finding about a bug that is not there.
- ✅ **SHIPPED `800069e4` — "Link and correct" is covered.** (Was: "still uncovered, ON PURPOSE",
  ask `da5c564e`. The reasoning below is why it waited, and is still worth reading.)
  It also patches the ledger transaction's AMOUNT, and `applied-actions.ts` has exactly three
  step kinds — `setCategory`, `removeReviews`, `deleteTransaction` — **none of which can put an
  amount back**. Recording the link's undo there would hand the user a button that removes the
  link, leaves the corrected figure in place, and reports success: **a partial undo presented
  as a complete one, on a money page.** Needs a `setAmount` step first. The honest absence is
  better than the confident lie, and the code says so at the call site.
- **NEEDS TRE: "Personal" is 25.5%** of all his labels. Catch-all he wants, or was the
  right category too hard to find? Decides the category generalisation. Do not guess.
- **profiles p95 ~6.5s is INSTANCE-WIDE**, not a profiles problem — five tables share a p95
  within 284ms. Free-plan shared compute is a HYPOTHESIS THAT FITS, not a measurement.
  Do not pay before re-measuring.
- Nothing tonight was verified in a browser. jsdom only.

---


## ✅ SETTLED 2026-09-12 — THE LEAKED-KEY GATE. `f7a23f72` + `17e98a30`. Do not re-derive any of this.

**1. Until `17e98a30`, the hosted bundle had NEVER been scanned by anything.** Not a
workflow, not a script, not a git hook, not the Vercel build (`vercel.json` sets no
`buildCommand`, there is no `core.hooksPath` and no `.husky`). The two existing gates
read the local `dist/` — which `capacitor.config.ts:8` (`server.url`) means the native
app never executes. A gate over an artefact that never ships protects nothing.

**2. The live scan's 403 from CI is Cloudflare refusing datacenter IPs — measured, not
inferred.** Run `34671555484`: 403 from a GitHub runner; 200 from this machine with a
bare `node` fetch, a browser UA, and no UA at all. So it is the IP, not the client.
**Not a leak and not an outage.** Vercel's own `ssoProtection` is
`all_except_custom_domains` — that is NOT the cause of this 403; it is why the
per-deploy `*.vercel.app` URL 302s, which is a separate reason the scan targets the
canonical origin. **The WAF allowance is Tre's call (ask `dea20ff6`) — do not attempt it.**

**3. ⛔ DO NOT SOFTEN THE 403 TO A WARNING, SKIP OR PASS.** The instruction is written
into `live-bundle-scan.yml` itself, not just here, because a future session seeing a
permanently red check will reach for exactly that. A 403 that passes restores the false
coverage this work removed. The automatic triggers are OFF instead: the workflow is
dispatch-only, with the two commented-out triggers and the re-enable condition in its
header. That is not the gate weakened — it never reports green falsely.

**4. THE TWO MODES ARE NOT INTERCHANGEABLE.** `check:leaked-keys` reads local `dist/` —
a cheap pre-ship check on a bundle nobody runs. `check:leaked-keys:live` reads the
hosted deployment — the only mode with coverage meaning. Every run prints `TARGET:`.
Never report the first as production coverage.

**5. ⚠️ WHAT I DID NOT DO: the live scan has no scheduled home.** It runs on demand and
nowhere else. Two options, left deliberately unchosen rather than half-built at
midnight: (a) a scheduled run on this machine, which reaches the site fine — but it
**must be S4U logon, because every Interactive scheduled task here dies with
`0x800710E0`**, and a headless `node` script is S4U-compatible where anything opening a
terminal is not; (b) leave it manual until the Cloudflare allowance lands and then
re-enable the CI triggers. Nothing is lost by waiting; the scan exists and is proven.

## ✅ CLOSED — "the gate scans a bundle that never ships". Shipped in `17e98a30`; `2ce1c2f5` closed with evidence. Kept below for the reasoning only — DO NOT rebuild it.

`capacitor.config.ts:8` sets `server.url = https://getforgenta.com`, so the native app
loads the HOSTED site. The `dist/` that `check:leaked-keys` and `check:debug-console`
inspect in both mobile workflows is never executed on a device. **The bundle customers
actually run — the Vercel build — is scanned by nothing.** Verified live: its index
chunk inlines the publishable key, exactly as it should. Wire the gate where that
bundle is built, or accept the gap in writing.

Two related facts found the same way, neither breaking anything today:
- **The `VITE_SUPABASE_*` env block in both mobile workflows names secrets that do not
  exist** (`gh secret list` — 17 secrets, none of them these; the run log prints all
  three empty). Inert only because `server.url` bypasses the bundle. It becomes
  load-bearing the moment anyone removes that line — the CI bundle's client chunk is
  literally `throw Error("Missing environment variable: VITE_SUPABASE_URL")`.
- **Neither mobile workflow reruns on a `scripts/**` change** — the paths filter is
  `src/`, `android/`, `capacitor.config.ts`, `package.json`. So a change to a gate is
  never exercised by the workflow that runs it. This push needed two manual
  `gh workflow run` calls.

## ✅ 2026-09-12 — THE LEAKED-KEY GATE'S LIVENESS RULE. `f7a23f72`, both workflows green.

It blocked every mobile build with "COULD NOT LOOK" after reading 229 files. Liveness
was tied to FINDING a key; it is now tied to having SCANNED, with a `selfTest()` canary
that plants a key in a fixture we control. Not a detector hole — measured both ways.
Detail in the commit body.

## ✅ 2026-09-12 — ADA SESSION CLOSE-OUT. Everything below is pushed, origin/main 0/0 by contents.

**FIRST UP: nothing here is blocked on code.** The three open items all need Tre's own hands —
the bank-link end-to-end test (`98a24254`), the Chase Pay Over Time plans, and the SIGN-IN that
blocks both browser passes. No desk can do any of them.

**THE ONE SCOPED, DELIBERATELY UNBUILT SLICE** — `docs/load-times-measurement-2026-09-11.md`,
ADDENDUM 2. Do NOT build "let widgets resolve individually" as the original §8.1 says: `profile`
is both the 5-second path AND the input to `buildPayConfig`, `resolveCashFloor`,
`isManualCashFloor` and the funding account, so rendering Overview tiles early shows a confident
WRONG number. The safe slice is one condition — do not gate a panel on inputs it does not
consume — and it needs a signed-in browser to verify first paint. Assert BOTH halves or the fix
regresses the half that was right.

**Shipped today** (each with its evidence in its own commit body):
- **Reviewer reset** `scripts/reset-reviewer-account.mjs`, and the 136-day defect it exposed:
  a 2026-04-27 rebrand rewrote `REVIEWER_EMAIL` so the in-app reset matched **0 rows** since April.
- **App lock reachable**: mounted since 09-06 but only enableable via a one-shot `SIGNED_IN`
  prompt; now has a Settings entry. Carried by **iOS build 732**; session persistence by **730**.
- **Leaked-key build gate** `npm run check:leaked-keys`, wired into both native workflows, 9 tests.
  Matches key VALUES not prefixes — supabase-js's own literal makes a prefix match go red on
  every clean build.
- **Unused declarations 117 → 11.** ⚠️ **The 11 left are ONE DECISION, not a remainder** — each
  binding is its call's only consumer, so deleting it changes what a page FETCHES. Do not sweep
  them to reach zero. Zero is not the goal; a defensible list is.
- **`useForecastProjections` deleted** with before/after evidence in numbers, both directions
  mutation-proven.
- **Load-time p95 closed** the gap the doc itself named: `profiles` 347 ms median vs **5082 ms
  p95**, and the tail is **BIMODAL** — one request in the whole 2.5–4.5 s band. "Fast, or stuck
  until the gateway gives up" has a different fix from general slowness.
- **Otto's five security checks: all pass**, live evidence, `docs/security-checklist-2026-09-12.md`.

**Two near-misses worth more than the fixes, both recorded in commit bodies:**
- `grep -rIl "sb_secret_" dist/` returns **2 files** and they are supabase-js's own detection
  literal. **A prefix is not a key.** A false critical on the bundle would have cost more than
  the leak that was not there.
- I wired up a dead drag path in `SurplusRankingSection` and **the existing suite refused it** —
  `[draggable="true"]` is pinned at 0 because Tre retired drag on 2026-08-26. The comments said
  drag still worked; only the test knew the truth. **Do not "restore" it without asking him.**

**Landing-page hero at `opacity: 0` is RESOLVED as an instrument artifact, not a defect** —
`vendor-motion` loaded (46,006 bytes) and the inline `translateY(30px)` is framer's own `initial`
value, so the library ran and the tween simply never advanced in a hidden tab. Nothing to fix.


## ✅ 2026-09-11 — TRE'S TWO ASKS: ONE SHIPPED, ONE MEASURED

**ASK 1, MOBILE SESSION PERSISTENCE — SHIPPED, on `origin/main`, verified 0/0 by contents.**
Native idle leash is now **7 days** (`NATIVE_IDLE_TIMEOUT_MS`) and **outranks the trust grant**.
- **The server was never the problem, and this is the fact that stops the next session re-deriving
  it:** `auth.sessions.not_after` is **NULL on every row** (no time-box) and a refresh token issued
  2026-06-21 was **successfully exchanged 47 days later**. Supabase already allowed a week with
  weeks to spare. **Nothing in Supabase config needs changing.**
- **The cause was the app's own idle timeout** running the web leash on native — 10 minutes
  untrusted, 12 hours trusted. That matches the 09-06 diagnosis exactly (a revocation, one
  `sb-*-auth-token` gone, the other 50 localStorage keys present), because `signOut()` removes
  precisely that key.
- ⚠️ **His iPhone reads UNTRUSTED today.** `profiles.trusted_devices` has `last_seen`
  **2026-07-19**, so the grant lapsed 08-18 and the phone has been on the **ten-minute** leash
  since. The 09-06 sliding-window fix cannot rescue it — `isDeviceTrusted` only touches a record
  that is still fresh. **A week conditional on trust would have shipped and reached nobody**, which
  is why the leash is keyed on PLATFORM.
- **What it costs, and it is a real trade:** `AppLockScreen` is exported and **mounted by nothing**,
  so on native the device's own lock screen is now the only thing between a picked-up phone and a
  week of live access to his finances. **Mounting the in-app PIN/biometric lock is now worth more
  than it was** — that is the one judgement here worth putting to Tre.
- Evidence: 5 tests, **4 red under mutation** (mutation asserted landed by sha256, file restored to
  its exact pre-mutation hash). The 5th covers only the toast wording and is **marked in the file as
  not load-bearing**, because it stays green on that mutant. Four older native tests had their
  away-time moved past the new leash rather than the leash being weakened.
  `tsc` clean, `lint` 0 errors, `test:tz` **4056 passed / 1 skipped** in all three zones.

**ASK 2, LOAD TIMES — MEASURED, NOT FIXED.** Full write-up:
`docs/load-times-measurement-2026-09-11.md`. Read it before touching performance.
- **The control that settles it:** `reddit_scout_pending_runs` has **0 rows, 24 kB, served by an
  index** — and averages **1404 ms** over 72 calls with **six 504s** in 24 hours. An indexed lookup
  on an empty table is microseconds, so **the delay is the instance, not the query.**
- **THREE DEAD ENDS, each ruled out by measurement — do not spend a day on any of them:**
  **not the queries** (largest table 592 kB / 831 rows), **not the pool** (13 of 60, 1 active),
  **not the bundle** (301 kB gzipped over 15 initial files, and the two biggest chunks are not on
  the initial path). The bundle argument is also logical: **a fixed bundle cannot explain
  "sometimes"** — it downloads the same every time.
- **INFERRED, NOT MEASURED, and must not be repeated as established:** free plan +
  `max_connections 60` makes burst-credit throttling on shared compute the best-supported cause.
  No CPU-credit metric is exposed through the MCP tools here, so it is **unconfirmed**.
- ⚠️ **I corrected myself before committing:** the draft said the Dashboard "renders nothing" behind
  `essentialLoading`. **It does not** — `Dashboard.tsx:1554` returns a full skeleton with eight
  metric tiles and a chart. The conclusion survives, but "stop the page blanking" would have been a
  **rebuild of shipped code**. The remaining win is progressive per-widget rendering, and it is a
  real slice, not a constant change.
- **INSTRUMENT GAP, named rather than filled:** the 24h edge-log window holds almost no Forgenta
  traffic — it is the expense tracker and other desks' pollers — so **there is no real page-load p95
  for this app**, and no client-side trace was taken.

⛔ **THE ONE THING: ENTER TRE'S THREE CHASE PAY OVER TIME PLANS.** Still the largest number left on
the board — **$2,101.39 of 0% principal charged at 27.49%, about $577/yr of interest he will not
pay** — and every line of code it needs shipped 2026-09-06 (`72f82c28`). Blocked ONLY on his three
confirmation emails. Accounts → Prime Visa → Rate Tiers, one tier per plan: balance, **0** APR, the
plan end date, the monthly instalment, the monthly fee, and tick **Fixed term**. Do NOT invent the
figures from any summary in this file.

**SECOND, and it is the cheapest real win left:** `docs/signed-in-verification-pass.md`. Several
2026-09-07/08 fixes are shipped, gated and **never seen in a browser** — the console has been signed
out for days. Nothing in that list needs new code, only a signed-in session.

**THIRD, workable right now with no browser and no Tre: the unused-declaration backlog is at 75,
and the EASY HALF IS GONE — what is left is the half that needs reading.** See the section below.

⛔ **BLOCKED ON TRE, AND IT GATES A LIVE CLAIM: VERIFY THE FREE FIRST BANK LINK END TO END.**
`free_bank_link_grants` holds **ZERO rows** — the free path has **never run in production**, because
both existing linkers predate it and were premium. The Dashboard now shows **29 users** a notice
saying their first connection is free. The entitlement IS imported by all four link functions, so it
is **not unbuilt — it is untested against a real bank.** One real link on a non-premium account
writes the first row and settles it. Tracked as `98a24254` (`ask list --needs-tre`).
**Until that row exists, do not describe the free link as working anywhere a customer can read it.**

> **CLOSE-OUT NOTE from the `ada-35568` session, 2026-09-11.** Three Ada sessions ran concurrently;
> `d69f0c` survives and carries all three queues. **This session was NOT mid-slice when it stopped** —
> Phase 17 finished, everything pushed, `origin/main` 0/0, tree clean but for the machine-written
> snapshot. **Nothing it touched is half-built and nothing needs rebuilding.**
> The one item it announced but **never started** is `f79b9663`, the 129 unused declarations — it is
> untouched, so treat it as genuinely open. Everything else it did is closed in `ask` WITH evidence:
> `2dbb8e50`, `c9b35277`, `20b850cc`, `72c7d48e`, `dbe49430`.
> Still open and genuinely its own: **`98a24254`, the free-link verification**, at the top of this
> file. The walk, reviewer-reset and load-time items belong to the other two Ada sessions, not this
> one — it deliberately did not mark them.

**PHASE 17 FRIENDS/LEADERBOARD — ✅ COMPLETE 2026-09-11. All eight pieces shipped.**
Schema, invites, metrics, ranking, opt-in switches, publisher, display. Every piece
mutation-tested; `test:tz` green in all three zones (4055 passed).
⚠️ **It reaches nobody yet, and that is expected, not broken:** 0 friendships, 0 opt-ins, 0
snapshots. The empty state is the screen every user will see, and it is written for that.
**VERIFIED 2026-09-12 by caller-grep and by querying production, not by re-reading this
file.** Mount chain, with line numbers so nobody re-derives it: `Settings.tsx:634` renders
`FriendLink`, which renders `LeaderboardShareToggles` (`:144`) and `FriendsLeaderboard`
(`:146`), both gated on `friends.length > 0` — deliberate, and the comment says why: switches
that publish to nobody are a control that appears to do nothing. `useLeaderboardPublisher` is
mounted at `Dashboard.tsx:744` and its inputs map `undefined` to `null` with three metrics
passed an explicit `null`, so nothing fabricates a zero onto a friend's screen.

⚠️ **AND THE PUBLISHER'S HAPPY PATH HAS NEVER EXECUTED.** Production reads
**0 invites, 0 friendships, 0 share rows, 0 snapshots** — note *invites* is zero too, which
this file did not previously record, so not even the first step of the chain has run. With
zero shares enabled the publisher is CORRECT to write nothing, which means a working
publisher and a broken one produce exactly the same evidence today. That is the
"a branch that only runs in the healthy state is untested until something is healthy" shape,
and no green suite can close it. **One real invite accepted, with one share switched on,
settles it** — and writing that row is production data, so it is Tre's to trigger, not a
desk's to fake.

⚠️ **`debt_payoff` and `budget_adherence` are never published** — the Dashboard cannot source them
truthfully, so they pass `null` and publish nothing. To add them, source them at the mount point in
`Dashboard.tsx`; do **not** pass a zero.
**Tre's one open fork here:** a friend with no display name falls back to a **masked email local
part**, so `tre@…` renders as `tre`. Recommendation: show "A friend" and prompt for a display name
on accept. See `docs/friends-leaderboard-privacy-surface.md`.

<details><summary>Superseded: the publisher was the next slice (now shipped)</summary>

⚠️ **Do NOT re-scope any of this as unbuilt.** What exists, all mutation-tested and green in all
three zones:

| Piece | File | State |
|---|---|---|
| Schema + RLS | `supabase/migrations/20260826_friend_links.sql` | shipped 08-26 |
| Invites + Settings card | `useFriendLink.ts`, `FriendLink.tsx` | shipped 08-26, `friend-link` really deployed (`401` vs `404` for a nonexistent fn) |
| Metrics + bucketing | `src/lib/leaderboard-metrics.ts` | shipped 09-10 |
| Ranking + row states | `src/lib/leaderboard-ranking.ts` | shipped 09-10 |
| Opt-in switches | `useLeaderboardShares.ts`, `LeaderboardShareToggles.tsx` | shipped 09-10, mounted in `FriendLink.tsx` |
| **Publisher** | — | ❌ **NEXT** |
| **Leaderboard display** | — | ❌ waits on Tre's fork |

**NEXT: `useLeaderboardPublisher`.** Nothing writes `leaderboard_snapshots` yet, so the switches
turn on and still publish nothing. Take explicit inputs and mount it in **`Dashboard.tsx` beside
`useNetWorthSnapshotRecorder()` at ~line 791, ABOVE the panel switch** — that block's own comment
records why (a writer mounted inside a panel was orphaned once and recording silently died for
months). Follow `useNotificationCheck`'s discipline exactly: **pass only what the page can source
TRUTHFULLY and `null` for the rest.** Publishing a 0 for a metric whose input is missing is the
`?? 0` defect, aimed at somebody else's screen.
The `(user_id, metric, week)` unique key enforces the weekly cadence server-side, so the hook does
not need its own scheduling — upsert and let the key refuse.

**Read `docs/friends-leaderboard-privacy-surface.md` first.** It holds the two open forks and the
reason `null` must never become `0` anywhere in this feature.

⚠️ **0 friend_links, 0 shares, 0 snapshots** after two weeks live, so **the empty state is the
screen every user will actually see.** `isEmptyRoom` and `hasComparableField` already exist for it,
and `isEmptyRoom` is deliberately FALSE for zero friends — "your friends share nothing" and "you
have no friends" are different messages.
⚠️ **And a rank here is usually a TIE-BREAK, not a reading** — 5% buckets means 21 possible values,
so ties are the common case. `buildLeaderboardRows` already gives ties a shared rank and sets
`tied`; the display must say "tied", never number them 1, 2, 3.

</details>

---

## ❓ ONE QUESTION FOR TRE — LUMP-SUM TRANSFERS, and one line settles it

Asked 2026-09-05, never answered, and it decides whether a shipped feature is finished or half
finished.

> **When you move a lump sum by hand — say $500 into the Prime Visa or into a savings goal — what
> do you ACTUALLY do today?**
>
> **(a)** Move it in your bank, then add or edit a transaction in Forgenta so the app knows.
> **(b)** Move it in your bank and type nothing — you expect the sync to pick it up.
> **(c)** Type it into the lump-sum panel as a PLAN before you move it, then move it.
> **(d)** Something else — say what.

**Why it matters, and why nobody can answer it from the code.** The lump-sum panels are built and
mounted on three surfaces — vehicle loans, savings cards (`LumpSumPanel`) and Savings Goals
(`GoalLumpSumPanel`, `SavingsGoals.tsx:981`) — and the auto-extra double-count was settled on
09-06 (`lump-sum-guard.ts`, measured, not assumed).

**But every one of those panels records a PLANNED extra payment, not a real one.** Nothing
reconciles the plan against the transfer when it actually lands via bank sync. Which of (a)–(d)
he does is the difference between "the panel is finished" and "the panel needs a reconcile step",
and it is a fact about his habit that no amount of reading the repo can establish.

⚠️ `useLumpSumTransfers` has **zero callers** — verified by caller grep, not by the handoff. It is
not evidence that anything is missing; it is a leftover.

---

## ⚠️ UNUSED-VARS: 117 → 75 → 56, AND "THE REST IS THE HARD HALF" WAS NOT TRUE

`a9517c8a` (35 import specifiers), `7e43c38f` (four bindings) and `1a042484` (three dead symbols). Gates on both: `npx tsc --noEmit`
clean and run after EACH batch, `npm run lint` 0 errors, `npm run test:tz` **3957 passed / 1 skipped**
in all three zones. `origin/main` 0/0, verified by CONTENTS.

⚠️ **CORRECTED 2026-09-11 (`89c0088e`): the claim below that ALL 75 were the hard half was
WRONG, and it was costing the backlog.** Nineteen of them — every one in `Forecast.tsx` — were
INERT: an unused import, four `const { data: X, loading: XLoading }` where only the `loading`
half is read, five names destructured off a context READ, and nine off `useForecastProjections`,
which is a 41-line re-export that computes nothing. Removing them avoids no work and skips none.
**A session trusting the old sentence would have left the cheapest third untouched on a false
premise** — the same shape as a handoff calling shipped work pending, pointed the other way.
So: **the remaining 56 still need reading, one at a time. But READ them — do not assume the
label.** The rule is "no sweep", not "no progress".

**WHAT IS LEFT IS NOT ALL THE SAME.** The 42+19 cleared were each split out after reading — a
warning on an `import` line, a param, a symbol with a PROVEN zero caller (counted per pattern,
never truncated), or a binding proven inert. Many of the remaining **56 are hook results, lazy
route bindings, state setters and destructures, where the deletion the linter invites changes
what a page loads or renders.** Do not sweep those. `useTransactions()` in `BudgetControl.tsx`
is still the worked example of one left deliberately with a comment saying why.

**NEXT, and it is a real simplification rather than a lint item:** `useForecastProjections` now
has exactly ONE caller reading TWO of its thirteen returned fields. It is preserving a return
shape for nobody. Deleting it and reading `CardProjectionContext` directly is a bigger change
than a sweep, which is why it is named here rather than done quietly.

**THREE CASES WHERE DELETING WAS THE WRONG FIX, because they generalise past these files:**
- **A REST-OMIT.** `MonthlyBreakdownTable.tsx:147` was `.map(({ scaledAmt, ...c }) => c)`. Deleting
  the binding does not remove a variable, it **moves the KEY into `...c`** and puts a raw float into
  the receipts a person reads. Renamed `scaledAmt: _scaledAmt`. **Prefixing with `_` alone would
  ALSO have broken it** — it would omit a key that does not exist.
- **A POSITIONAL PARAM.** `credit-card-engine.ts:2318` `paymentMode` has four positional params
  after it; deleting it silently reassigns every caller's arguments. Renamed `_paymentMode`.
- **A DOCUMENTED BINDING IS NOT DEAD CODE.** `useSupabaseData.ts:824` `merchantKey` is unused in
  `mutationFn`, read as `vars.merchantKey` at `:868`, and the comment at `:819` says so. Left.

⚠️ **AND THE REST-OMIT IS UNGUARDED — MEASURED, NOT ASSUMED.** I mutated it back to the naive
`({ ...c }) => c` and ran the suite: **8 tests in `src/components/forecast` passed against the bug**,
because they cover `ForecastHero` and **`MonthlyBreakdownTable` has no test file at all.** So the
next cleanup pass will be invited to make this exact mistake by this exact linter and nothing will go
red. **Writing that test needs a first render harness for the table — a slice, not a lint fix.**

## ✅ ANSWERED FOR RUBY — au-062, au-070, au-071. Both written into `claudecontext/asks.md`.

Written there rather than here because that is where she raised them, and a desk does not edit
another desk's tree.

**au-062: the `debt-unpinned` frame is NEITHER reading and cannot settle the post.** Two findings.
(1) **"Statement Bal." is not a state** — `CreditCardEngine.tsx:1965-1967` renders it on
`paymentPreference !== null`, a static echo of the stored account column that never touches the
projection. It is a **green ✓ chip on what is only a setting**, which is why the frame was
unreadable; that is a real UX defect and is NOT fixed. (2) **$25 is a month-2 CYCLING minimum**, not
a month-0 reservation. Measured on the committed demo fixture: d7's `perCardMinPayments` is
`[88.14, 38.22, 25, …]` and `monthlyBalances` `[1872.19, 942.43, 0, …]`. Both reconcile to their
formulas exactly — `4318 × (1+24.74/1200) × 0.02 = 88.14` at `:214`, and
`min(max(25, 0.02 × 942.43), 942.43) = 25` at `:1687`. **Her `4318 + 39.19 − 25 = 4332` describes no
month the engine produces**: one crop, two rows.

**au-070/au-071 ship with NO PICTURE, and the reason is structural.** The fixture card that would
prove them is the one that breaks every pinned demo number; the one that breaks nothing proves
nothing (a $0 card owes no minimum because it owes nothing, not because `minSuppressed` fired). Six
test files import the demo fixture, two of them pinning the figures marketing itself quotes. **If
those posts must ever be illustrated the path is a second capture-only persona behind a flag — never
a third card in the live demo.** Not queued; nobody has asked for it.

---

## ⚠️ NINE ITEMS I TOOK ON 2026-09-07/08 WERE ALREADY BUILT. GREP BEFORE YOU BUILD — IT IS THE HIGHEST-YIELD HABIT HERE.

Each found by ONE grep for the caller before writing a line. Without it each would have been rebuilt
on top of itself, and **the rebuild would have passed its own tests**, which is what makes this
expensive rather than merely wasteful.

| The record said | What was actually there |
| --- | --- |
| Transfer rules must show in Transactions | Shipped — `pay-schedule.ts:1436`. Only the GOAL half was real |
| /debt student-loans chart breaks on mobile | Fixed in `1d4fd3bd` |
| Four charts lack an `ErrorBoundary` | All five wrapped — `DebtPayoff.tsx:480,499,539,651,724` |
| Plaid cost tracking, both halves | Rule live in his ledger + `docs/plaid-cost-2026-09-06.md` |
| `otherDebtPayment` never stops | Month-indexed and gated — `non-cc-liabilities.ts:398` |
| Debug-console security gate | Built AND wired into three CI workflows |
| Review prompt in onboarding | Already value-triggered, and stricter than the tactic suggested |
| Budget totals → dashboard widget | `BudgetTotalsCard`, registered and mounted |
| Remaining Cash tile deletion | Done in August — but its computation chain was left running |

**And one in the OTHER direction, which is the same failure inverted:** "`logIn()` is never called"
was recorded as a money-path defect and is **correct behaviour**. Building it would have changed a
working money path on a false premise. **Test the premise, not just the presence.**

**The habit:** `grep -rn "<symbol>" src/ | grep -v export` before the first edit, and search for the
name the CODE has, not the name the ask uses (`monthly_fee`, not `payOverTime`).

---

---

## ⚠️ THE ASKS LEDGER IS BADLY STALE, AND IT IS DANGEROUS IN THIS DIRECTION

Measured 2026-09-06. **SIX of the eight open getforgenta asks I opened today were already
SHIPPED**, several with a test file and a source comment quoting Tre's own words. Each was found
by one `grep -rli "<his words>" src/` before writing a line of code:

| Ask, as the ledger still had it | Where it actually lives |
| --- | --- |
| Repeat intervals for planned items | `20260905_recurring_rules_custom_interval.sql` + 2 test files |
| GENERAL OPERATIONS balance in forecast pop-ups | `forecast-engine.ts:327` + `forecast-engine.nonFundingLiquid.test.ts` |
| Hide "cash floor set" when AUTOMATIC | `Dashboard.tsx:1024`, `MonthlyBreakdownTable.tsx` |
| Transfers on the HOMEPAGE | `Dashboard.tsx:1336`, commit `0f92da5c` |
| SECURITY tab symmetry | `Settings.securityControls.test.tsx` |
| The rent grace period | `sync-cutoff.ts:123` + `pay-schedule.debitGracePeriod.test.ts` |

**This is the failure mode the repo already names, at scale.** A session that trusts an open `[ ]`
rebuilds a working feature on top of itself, and the rebuild passes its own tests. **The check is
one command and it costs nothing: grep for Tre's OWN WORDS**, which this codebase puts in the
comment above the code that answers them. That convention is what made all six findable in a
single pass, and it is worth keeping for exactly this reason.

✅ **ALL OF THEM ARE NOW CLOSED — 2026-09-06.** Eight of eight, plus the auto-extra ask below.
Seven needed no new feature code at all; the three real holes were all on the same surface, and all
the same shape: **money the engine already computed, that the LEDGER alone never showed.** Goal
contributions, then the ranked auto-extra. If another "should show in Transactions" ask arrives,
look there first — `Transactions.tsx` derives its stream from `recurring_rules` and nothing else
unless a caller explicitly adds to it.

---

## ✅ SHIPPED 2026-09-06 — a savings goal moved money monthly and the ledger never said so. `eef7dadd`.

`origin/main` 0/0, verified by CONTENTS. Gates: `npx tsc --noEmit` clean, `npm run lint` 0 errors,
`npm run test:tz` **3911 passed / 1 skipped** across all three zones.

**The ask split in half, and only one half was real.** Transfer RULES already showed —
`pay-schedule.ts:1436` marks a `transfer`/`investment` rule `isTransfer` and `Transactions.tsx:1241`
renders the destination. **A GOAL contribution is not a `recurring_rules` row at all**, so nothing
generated it there: `savings_goals.monthly_contribution` was synthesised inline inside
`useBudgetMonthTotals` and lived only there. Budget Control listed it, the forecast moved that cash
out of checking every month and priced the plan around it, and **Transactions had ZERO references to
savings goals.** A person reading their own ledger could not see $200/mo leaving.

Now shared through `src/lib/goal-transfer-rules.ts`, called by both surfaces. Three things not to
re-derive:
- **ONE precedence filter, not two.** A goal already funded by a real rule is skipped because it is
  on screen as that rule; a second copy of that filter is a double-count waiting to happen. A link
  to a DELETED rule still synthesises — the money still leaves.
- **`due_day` stays null in the base synthesis** (Budget Control shows no day on purpose), and
  `buildDatedGoalTransferRules` derives the ledger date from the goal's own
  `contribution_start_date`. It lives in the lib so the tests exercise what ships, not a copy.
- ⚠️ **A goal occurrence carries a synthetic `goal:<id>` ruleId**, so `rules.find` misses and the
  "edit the recurring rule" button would have silently done nothing. Guarded.

⚠️ **FOUR EXISTING TEST FILES BROKE — 25 failures — because they mock `useSupabaseData` and
`useSavingsGoals` was absent from every mock.** Caught by the gate, not by reading. Any new data
hook added to `Transactions.tsx` will do this again; patch the four `Transactions.*.test.tsx` mocks
in the same commit.

⚠️ **NOT VERIFIED IN A BROWSER.** Tre is signed out at the console, so nothing could render today.
jsdom is legitimate here (text and presence, no geometry) but a rendered frame is still owed.

## ✅ SHIPPED 2026-09-07/08 — two live defects on the PUBLIC demo, same root, opposite polarity.

Both found by Ruby capturing `getforgenta.com/demo`, both fixed, **both verified on production by
her afterwards** (she opened the frames rather than trusting the run).

**`$19,007,108` of "total interest" on a $4,318 card.** Arithmetically honest: `projectCardVariable`
walks `Math.max(months, 360)` months hunting a payoff, and a card whose purchases outrun its payment
never clears, so thirty years compound into the total. Now reads **"Never pays off"**.

**`PAYOFF ETA: Paid` for debt that never clears — the more serious one.** The aggregate was
`Math.max(0, ...map(p => p.payoffMonth ?? 0))`, and **`?? 0` turns "never" into "immediately"**.
Every card null gives 0, and 0 rendered as *Paid*. **The most alarming state the app can be in was
displayed as the most reassuring one, on a debt payoff screen.** `/dashboard` was right,
`/debt` was wrong. Now "Not within 5 years", via `aggregatePayoffEta` returning a tagged union so no
caller can compare it back into arithmetic.

Both rules live in `src/lib/card-interest-display.ts` so the tile, the premium bullet and the header
cannot drift. **Machine-wide rule now: a coalescing default on a DISPLAYED value is a defect until
proven otherwise** — with the qualifier this session earned, below.

### ⚠️ FOUR WAYS A GREEN TEST WAS ABOUT NOTHING, and one was mine
- **green-against-unreachable:** my card fixture set `paymentPreference: 'revolving'`, which is not
  in the union. **Vitest does not typecheck, so it passed while exercising a branch production
  cannot enter.** `tsc` caught it; no test could, because the test was the thing asserting it.
- The `?? 0` rule's OWN failure mode: **`UTILIZATION-ONLY (0%)` reading $0 is CORRECT.** It reads
  `installment_balance`, an account column no demo account sets — a different concept from a 0%
  promo TRANCHE. A correct zero was nearly "fixed" into a wrong one. **"Proven otherwise" must
  include *absent genuinely means zero here*.**

### ✅ THE REPRICING CLIFF RENDERS, and it is the strongest line the app produces
Looked for in the wrong element and reported missing. It is in `CardRateLine.tsx`, not a stats tile,
and `promoExpiryWarnings` has **no time window**. Verified on production:
> ⚠ $2,417 at 0% reprices to 24.74% on May 11, 2027 (+$50/mo) — clearing it first needs $302/mo for 8 months

It prices **both options** — doing nothing and acting — so it is a decision, not a warning.

## ⛔ FIVE OF THE ITEMS I TOOK THIS SESSION WERE ALREADY BUILT. GREP BEFORE YOU BUILD.

Counted 2026-09-07, and it is now the single highest-yield habit at this desk. Each was found by
ONE grep for the caller before writing a line, and each would otherwise have been rebuilt on top of
itself — with the rebuild passing its own tests, which is what makes this expensive rather than merely
wasteful.

| The record said | What was actually there |
| --- | --- |
| Transfer rules must show in Transactions | Already shipped — `pay-schedule.ts:1436`. Only the GOAL half was real |
| /debt student-loans chart breaks on mobile | Fixed in `1d4fd3bd` |
| Four charts lack an `ErrorBoundary` | All five are wrapped — `DebtPayoff.tsx:480,499,539,651,724` |
| Plaid cost tracking, both halves | Rule live in his ledger + `docs/plaid-cost-2026-09-06.md` |
| `otherDebtPayment` is a scalar that never stops | Month-indexed and gated — `non-cc-liabilities.ts:398`, `isOtherDebtPaymentOwed:348` |

And one in the OTHER direction, which is the same failure wearing a different coat: **"`logIn()` is
never called" was recorded as a money-path defect and is CORRECT behaviour** — building it would have
changed a working money path on a false premise. **Test the premise, not just the presence.**

**The habit, in one line:** before the first edit, `grep -rn "<symbol>" src/ | grep -v export`, and
search for the name the CODE has rather than the name the ask uses (`monthly_fee`, not `payOverTime`).

## ✅ SHIPPED 2026-09-07 — notifications: the deep link, and one event becoming several.

Two commits, `test:tz` 3938 then **3940 passed**, three zones, `origin/main` 0/0 verified by contents.

**THE DEEP LINK WAS NEVER WIRED, NOT BROKEN — and it is the aim-at-the-wrong-object shape again.**
`PushTapHandler` listened only to `pushNotificationActionPerformed` on the REMOTE plugin, which has
**never fired once** (`push_sends` zero rows, zero iOS tokens), while every notification this app
shows is LOCAL and raises `localNotificationActionPerformed` on a different plugin nobody watched.
Both halves were missing, which is why neither looked wrong alone: the schedule also carried no
`extra`, so a correct listener would have had no key to route on. Both fixed; routing lifted into
one `handleTap` so the two channels cannot disagree.
⚠️ **The component had NO test at all** — the routing lib under it was tested and passed throughout,
because the lib was never the broken part. That is the gap to look for elsewhere.

**SEVEN NOTIFICATIONS FOR ONE EVENT — every gate was reading a history written too late.**
`MIN_HOURS_BETWEEN` 16h, `MAX_PER_WEEK` 5 and the per-kind caps all compute FROM stored history, so
**all of them are defeated at once** by the check-then-act race: `runNotificationCheck` read history,
then awaited `ensurePermission()` — an OS dialog open for as long as the person takes — and only
recorded the send at the end. Checks are now serialised through one promise chain. **Not one gate
wrong; every gate asked too early.**

⚠️ **NEITHER IS DEVICE-VERIFIED, and both need it.** A mocked `addListener` proves wiring, not that
Capacitor delivers the event — the testing rules name that exact mock shape as a way a green lies.
The cold-start tap path and the real trigger for the seven are both inferred, not observed.

## ✅ SHIPPED 2026-09-06 — a tap selected nothing on FIVE charts, and the fix existed in a sixth.

`origin/main` 0/0, verified by CONTENTS across 9 files. `test:tz` **3932 passed / 1 skipped**.

`selectPointOnTouch` was written for `LiabilityTrajectoryChart` and lived there alone. The credit
card engine, net-worth trend, forecast chart, loan card and savings-goal projection each render a
recharts Tooltip and **none could be tapped.** Now `src/lib/chart-touch.ts`, applied to all six.

⚠️ **A SECOND COPY WOULD HAVE BEEN DANGEROUS, NOT UNTIDY.** Safari has the `TouchEvent` interface
but no constructor, so `new TouchEvent(...)` throws `Illegal constructor`, the ErrorBoundary catches
it, and **the chart vanishes** — on iOS a tap did not fail to select, it DELETED THE GRAPH. Five
copies would have been five chances to reintroduce that.

⚠️ **THE TEST THAT MATTERS IS THE SOURCE SWEEP, and it generalises past charts.** The helper was
correct for weeks while five surfaces lacked it — **a unit test on the helper stays green through
exactly that failure.** So the suite walks `src/components` and `src/pages`, selects every file
rendering a chart WITH a Tooltip, and asserts each passes `onTouchStart`; it also asserts it found
at least 5 files, so an empty sweep cannot pass silently. **Reach for this shape whenever a fix has
to be applied at N call sites** — the unit test proves the helper, the sweep proves the wiring.
`InstructionsModal`, `MetricCard` and `Onboarding` are deliberately out of scope: decorative charts,
no Tooltip, nothing to select — which is why the sweep keys on the Tooltip, not the chart.

⚠️ **NOT VERIFIED ON A PHONE.** jsdom cannot exercise recharts point selection at all, and the
Safari path is simulated by stubbing a throwing constructor because jsdom implements the real one.

## ✅ SHIPPED 2026-09-06 — the monthly surplus swept into goals and loans was invisible in the ledger.

`origin/main` 0/0, verified by CONTENTS. `npm run test:tz` **3922 passed / 1 skipped**, three zones.

The engine's ranked surplus moves real cash out of checking every month. The Forecast month drawer
itemised it, the CSV export listed it, and **`Transactions.tsx` had ZERO references to auto-extra
anything.** Now `src/lib/auto-extra-ledger-rows.ts`, reading the engine's OWN named list
(`ForecastMonthRow.autoExtraItems` — the `{id,name,kind,amount}` twin of `autoExtraByTarget` that
the drawer and export already read), so there is no second allocation and no second total.

⚠️ **THE DOUBLE-COUNT THAT WOULD HAVE BEEN EASY TO SHIP.** A credit card's ranked surplus is NOT in
that list — `AutoExtraReserveKind` is `car_fund | goal | loan | liability` with **no `card`** — and
card surplus rides inside `perCardAdjusted`, which this page ALREADY renders as a debt payment row.
Emitting it here too would have shown the same money leaving twice, silently, on a money surface.
**Anyone adding a `card` kind to the engine must exclude it here explicitly.**

Two smaller decisions worth not re-arguing: the date is the LAST DAY of its month (a ranked extra is
what is left after that month's obligations, not a payment on a chosen day), and `isTransfer` is
true for a goal or car fund and FALSE for a loan — one receives money, the other retires debt.

## ✅ CLOSED, ALREADY FIXED — the /debt STUDENT LOANS chart "breaking" on mobile. `1d4fd3bd`.

Found by reading rather than rebuilding. **"Breaks" was exact and worse than it sounded:** Safari
implements the `TouchEvent` INTERFACE but not its CONSTRUCTOR, so `new TouchEvent(...)` threw
`TypeError: Illegal constructor` out of a React touch handler, the chart's `ErrorBoundary` caught
it, and **the graph VANISHED.** A tap did not fail to select a point — it deleted the chart. The
replay can no longer throw and falls back to a synthetic `mousemove`, which reaches the same
recharts machinery. **jsdom implements the constructor, so no test in this repo could ever have
seen it.**

⚠️ **AND A STALE LINE CORRECTED WHILE HERE:** this file said only the Credit Card tab is inside an
`ErrorBoundary` and a throw in the other four `LiabilityTrajectoryChart` usages would blank `/debt`.
**All five are wrapped** — `DebtPayoff.tsx:480, 499, 539, 651, 724`. Do not rebuild that.

---

## ✅ SHIPPED 2026-09-06 - a card's FIRST payment due date. `26781c63`, on origin/main.

Tre's ask: "maybe make it a feature for cards to set there first due date." `payment_due_day` is
a day of month and describes a steady state; month one is not one. Now `accounts.first_payment_due_date`
(date, nullable, live - applied and read back from `information_schema`, and its CHECK was proven
to FIRE on a bad row before being believed), the pure `src/lib/first-payment-due.ts`, an Accounts
form field, and ONE engine site: the due-month decision at `credit-card-engine.ts:~1262`.
16 tests, all mutation-checked. `test:tz` green in three zones, 3887 passed.

✅ **AND THE SECOND HALF IS SHIPPED TOO - `9c40be0` region, same window.** A card now owes NO
minimum in the months before its first payment is due. `minSuppressed(card, m)` is the single
predicate, borrowed from the existing `m0MinSettled` and applied at exactly the FIVE sites that
one is applied at. **The handoff said fifteen sites; reading them showed twelve are about whether
the card EXISTS and five about whether it OWES** - a useful correction to make out loud, because
the fifteen was the reason the slice looked too big to do.

⚠️ **A TEST FOUND THE FIFTH SITE AND IT MATTERS BEYOND THIS FEATURE.** Suppressing the
RESERVATION was not enough: the minimum-enforcement guard at the end of Step 5 put the payment
straight back, so `perCardMinPayments` read $0 while `monthlyPayments` read $60. **Reserving
nothing and paying it anyway is the worst of both** - cash leaves that the floor was never told
about. Any future change that zeroes a minimum must check that guard too.

✅ **ALSO CLOSED, ALREADY BUILT:** the user-chosen repeat intervals ask (asks.md line 3) is DONE
end to end - `20260905_recurring_rules_custom_interval.sql`, `scheduling.ts`, `pay-schedule.ts`,
`BudgetControl.tsx`, plus `scheduling.customInterval.test.ts` and `BudgetControl.customInterval.test.tsx`.
Found by grepping for the caller before building, which is the rule that exists for exactly this.

---

## 🔐 RESTRICT the Firebase Android API key — DO NOT ROTATE IT

Found by Ruby's gitleaks scan of 4,731 commits, which was otherwise **CLEAR** — no live exposed
credential anywhere in getforgenta's GitHub history. Her evidence:
`tre-forged-marketing/docs/evidence/2026-09-06_secret-scan-getforgenta.md` (commit `01bf307`).

`android/app/google-services.json:18` carries the Firebase Android API key (`AIzaSy…`).
**It ships inside every published APK by design, so it is NOT a leak.** Rotating it as though it
were would break released builds and buy nothing. What it needs is an **Android app restriction in
the Google Cloud console: package name plus release SHA-1.** Unrestricted is the default, and that
default is the actual risk.

**This desk cannot do it** — there is no authenticated Google Cloud tool here. It is in the Asks
Ledger for Tre.

**Two things that are NOT findings — do not chase them:** every `price_1T…` literal in
`create-checkout` / `grant-promo-premium` is a Stripe PRICE id, public by design; and the
`-----BEGIN PRIVATE KEY` in `src/lib/__tests__/push-transport.routing.test.ts:55` is a `btoa()`
test fixture.

⚠️ **The warning that generalises, and it is this repo's own testing rule wearing different
clothes:** gitleaks with its DEFAULT rules **MISSED** a credential Ruby already knew was in that
history. It only surfaced under a rule keying on argument position, because
`page.fill('input[type="password"]', "<value>")` puts the keyword in the SELECTOR and the value
after a comma. **If you ever run a scanner, first point it at a secret you know is there and
confirm it finds it.** A clean report from an unproven scanner is the same false green as a test
that cannot fail.

## ⏰ SUNDAY 2026-09-13 — REMIND TRE, in his own words

He asked for this reminder himself, and it is the ONLY thing standing between the free
first bank link and being verified. Word it to him exactly like this:

> **Link a bank on an account that is NOT premium, then try a second one and confirm it is
> blocked.**

That is the unmet acceptance for `0eaedbef`. It cannot be done from this desk: Linked Banks
is `!isDemo` so `/demo` cannot show it, and a real link needs bank credentials no session may
handle. Sam has the same date in `Desktop\TASKS.md` and the Asks Ledger, so the nightly asks
push carries it if no session is open.

## 🔎 SEPARATE FINDING — `akoya-exchange-token` had NO entitlement gate at all

Not part of the paywall change, and deliberately written here rather than buried inside it.
Until 2026-09-06 that function checked only the `MAX_LINKED` ceiling: no premium check, no
subscription check, nothing. `akoya-auth-url` had the premium gate and the exchange did not,
so the ceiling was the only thing between a caller and an Akoya connection. It is gated now
via `decideBankLink`, but **the gap existed in production and is worth knowing about when
auditing the other providers** — the question to ask of any new provider is not "does the
start of the flow check entitlement" but "does the step that CREATES the connection check it".

## 💭 COSTED OPTION, NOT A PLAN — moving the engines server-side

Tre asked whether the debt calculation code can be hidden. Recorded as an option with its cost
named, so nobody reads it as scheduled work:
- **Making the repo private would hide nothing.** `forecast-engine.ts` (2,920 lines),
  `credit-card-engine.ts` (2,840) and `useCardProjection.ts` (2,521) are CLIENT-side and ship
  inside the browser bundle to every visitor of getforgenta.com.
- **Only moving the maths to the server actually hides it**, and that is a large build: it is
  the same engine `docs/push-runbook.md` already names as the blocker for server-computable
  notifications, so the two would share the work.
- **The licence is the cheap half and it is DONE** — the repo was public with `licenseInfo`
  null and no LICENSE file, which is the weakest position available. Now explicit and
  proprietary.

## 2026-09-06 — the paywall moved, and the app finally has a search box

Two commits, `ff49219d` and `0eaedbef`. `origin/main` 0/0, both verified by CONTENTS.
Gates each time: `npx tsc --noEmit` clean, `npm run lint` 0 errors, `npm run test:tz`
**3871 passed / 1 skipped** across all three zones.

**THE FIRST LINKED BANK IS NOW FREE, AND IT IS DEPLOYED.** `0eaedbef`. Four edge functions
deployed and verified live by contents — `plaid-exchange-token` now contains `decideBankLink`
and no longer contains `Premium subscription required`. Migration applied and locked down:
`free_bank_link_grants`, RLS on, **0 grants to anon/authenticated, 0 policies**.
- **Why it could not be a column on `profiles`:** `profiles_update_own` lets any signed-in user
  UPDATE their own row, so a marker there is clearable by the account it constrains — with the
  anon key that ships in the bundle — and every clear mints another Plaid item Tre pays for.
- **Why it is not a `count(financial_connections)`:** unlinking HARD-deletes that row, so a
  count-based gate is a retry loop. The grant is durable and unlinking does not return it.
- **Consumed at EXCHANGE, after the insert.** Plaid bills on the item; an abandoned Link flow
  costs nothing and must not spend somebody's one free bank.
- ⚠️ **ACCEPTANCE UNMET, DO NOT RECORD IT AS DONE:** a rendered frame of a NON-PREMIUM account
  completing a real link, and proof the second is gated. Linked Banks is `!isDemo`, so `/demo`
  cannot show it, and a real link needs bank credentials this desk must not handle.

**NEXT UP, and it is queued to ship WITH the above (Tre, via Sam):** track Plaid's cost as a
business expense. Two halves, not to be merged — (1) a real recurring row in his own ledger
beside `Claude` and `Google Workspace`, **amount left blank rather than invented** if the Plaid
dashboard is unreachable from this desk; (2) what one free link actually costs and what 100
signups would cost, since the free-first-link decision makes spend grow with signups rather than
with paying customers. Apple revenue is confirmed **zero**, so Plaid is the largest real running
cost against no income.

**The app had no text search anywhere.** `ff49219d`. Measured: `type="search"` appeared **0**
times in `src/`. The ledger has one now — verified in a real 390px iframe, 31 rows → 5 on "gas",
18 on "northvale", AND semantics, clear restores 31; 12 tests, three mutation-verified.
⚠️ **It covers the LEDGER half only** — `BankActivity` takes no props and owns its own queries,
so the bank rows are NOT searched. Found by the acceptance test itself: "Ridgeline", a merchant
visible on screen, matched 0.

**`docs/screens-jakobs-law.md`** extends the Jakob's Law method to the screens, ranked by
encounters per session, and says plainly that **no screen change fixes the measured 9-of-31
day-one retention** — every notification the app ships is LOCAL, so nothing reaches a dormant
person. The server-side sender is the item above all of these.

**Also open, from Sam, unstarted:** mobile logs the user out (a PIN is the direction Tre wants;
the dev sign-in died with exactly ONE key removed of fifty, which is token revocation and may be
the same root cause); the lesson deep link still does not open and delivery has stopped
altogether; seven notifications for one event; the toggle knob sits outside its container; which
onboarding step to cut (unblocked, but no signups since, so the columns are empty for want of
traffic); OG seats never reused and `seats_left` computed from the wrong thing; 44px tap targets
on BankActivity and BudgetControl, folded into the screen-level plan.

---

# Handoff — Forgenta

> **This file is a SNAPSHOT, not a log.** It was 1,075,335 bytes on 2026-09-01,
> read into context at every SessionStart in this folder, and it had swallowed
> every previous session end to end. The history is in `handoff-archive.md`;
> search that when you need something this file no longer carries. Keep this one
> under ~15 KB: rewrite the state, do not append to it. Everything below the
> AUTO-SNAPSHOT marker is machine-written and is replaced on every run — write
> above it.
>
> ✅ **PRUNED 2026-09-05: 101 KB -> 54 KB.** Sixteen closed sections moved to
> `handoff-archive.md` with a one-line pointer each, carrying the load-bearing fact
> (a reversal state, a lesson, a do-not-rebuild) so nothing has to be re-derived to
> act. Still above the ~15 KB rule; the remaining weight is the Resume queue and the
> genuinely open sections, which is what this file is for. When you close something,
> move it — do not append.

---

## ✅ SHIPPED 2026-09-05 — the i18n scaffold plus Spanish on Landing. `c9643e6c`, on origin/main.

Was FIRST UP. Scoped exactly as asked: `i18next` + `react-i18next`, catalogues at
`src/locales/<lang>/<namespace>.json`, `src/lib/i18n.ts`, a `LanguageSwitcher` on BOTH the
signed-out Landing page and Settings, and ONE complete namespace (`landing`, 47 keys) in
Spanish. Detail is in the commit body; three things worth not re-deriving:

- **A surface is all-or-nothing.** A half-translated screen is worse than an English one, so
  the next surface is a new namespace file per locale — nothing in `i18n.ts` changes.
- **The language is NOT the money knob.** `formatCurrency`/`setMoneyDisplay` still own how an
  amount is written. Somebody reading in Spanish may hold a USD account.
- **The currency picker is RE-ENABLED** (`Settings.tsx`), on the condition its own 2026-09-03
  disable note set. `f21d4d00` had already connected `MoneyDisplaySync`; the control was still
  off two commits later. Found by grepping for the CALLER, which is now a repo gate.

⚠️ **Arabic/RTL is still a separate slice, and is now the natural next i18n item.** `dir` is set
on `<html>` and `SUPPORTED_LANGUAGES` carries a `dir` field, so the plumbing exists — the work is
mirroring the layout, not the strings.
⚠️ The 32 `toLocaleDateString` sites remain NOT a blocker (textual options, `Sep 2026`).
`docs/international-release-plan.md` carries that correction; do not re-derive it a fourth time.

**The gate added this morning caught something on its first day.** jsdom reported the switcher's
box as 0 and stayed green while Chrome showed "Español" clipped under the chevron in an 80px
select — the browser sizes a select to its longest OPTION and ignores the 2rem author padding.
Also learned, and worth keeping: `index.css:845` forces `font-size: 16px !important` on every
input, textarea and select (iOS zooms below that), so a font-size class on any select in this
app is inert.

## ⛔ PUSH: EVERYTHING IN OUR CONTROL IS VERIFIED CORRECT, AND APPLE DOES NOT ANSWER.

**Read this before touching push. The point of it is to stop you re-running an eleven-hour
evening.** As of 2026-09-06 00:45Z: `push_sends` holds **ZERO rows across ALL users**, there are
**ZERO iOS tokens on the entire system**, and Tre's row reads
`outcome timeout | attempts 57 | app_build 686 | detail permission=granted`.

**The device asks Apple for a token. Apple says nothing — no token, and no error.** That is the
whole remaining fact.

### ⛔ ELEVEN HYPOTHESES, ALL DEAD BY EVIDENCE. DO NOT REOPEN ONE WITHOUT NEW INFORMATION.

| # | Hypothesis | How it was killed |
|---|---|---|
| 1 | He is on an old build | `app_build` recorded from `App.getInfo()` — reads **686**, the fixed one |
| 2 | `aps-environment` missing | Added `c1cff973`; symptom unchanged |
| 3 | It is `development`, not `production` | Fixed `8561f0d0`; symptom unchanged |
| 4 | The profile lacks the capability | CI step decodes the profile and asserts it — **present** |
| 5 | Xcode dropped it at export | CI step runs `codesign -d --entitlements` on the exported IPA — **`production`**, and `get-task-allow => false`, so properly distribution-signed |
| 6 | `register()` races its own listeners | Real bug, fixed `ec67489f`; symptom unchanged |
| 7 | A late token was discarded | Real bug, fixed `8975c23f`; symptom unchanged |
| 8 | Permission is not granted | **MEASURED** from `checkPermissions()` — `permission=granted`, not inferred |
| 9 | `INITIAL_SESSION` is not handled | `AuthContext.tsx:248` handles both events, with a comment recording `7108311a` |
| 10 | The app resumed, so sign-in never re-ran | Tre swipes it out of the switcher — real cold starts |
| 11 | The network blocks APNs (port 5223) | Tested on **cellular with wifi off**, app foregrounded 60s — `pending` at 00:26 → `timeout` at 00:44 |

### ⚠️ THE `.p8` CANNOT BE THE CAUSE, SO DO NOT "FIX" IT AND BELIEVE THE RESULT.
`APNS_AUTH_KEY_P8`, `APNS_KEY_ID` and `APNS_TEAM_ID` are how **our server authenticates to APNs
when SENDING**. Minting a device token is purely the OS talking to Apple, using the entitlement
and the app identity — **our server key is not involved at all**. If somebody later changes those
and a token appears, treat it as a coincidence and find the real reason.

### ⇢ THE NEXT STEP IS APPLE'S DIAGNOSTICS, AND IT IS OUTSIDE THIS DESK
The device console during a registration attempt shows the actual APNs subsystem error — the thing
we spent an evening inferring from silence. That needs a Mac with the iPhone attached, or
Console.app over the network. **This desk cannot do it from Windows, and saying so is the honest
end of the thread rather than a twelfth theory.**

Two free checks for his list, neither yet done, neither worth waking him for: **Low Power Mode**,
and any restriction under **Settings → Forgenta**. Both can interfere with background networking.

### What IS built and working, so it is not rebuilt
The sender (`push-send`, 291 lines, `x-cron-secret` only, dry-run default true), the APNs/FCM
transport with dead-token retirement, the `push-send-daily` cron (DRY RUN — appending
`?dry_run=0` is what turns delivery on), per-user/per-platform dedupe, and **FCM proven end to end
without delivering anything**: `?check=1` uses `validate_only` and returned `android_checked: 7,
android_ok: 7, delivered: 0`. **Android is proven; only APNs is not.**

### ⚠️ TWO THINGS ABOUT MY OWN REASONING, recorded so they are not repeated
1. I claimed the 30s wait window "recorded nothing" and had sent us down a wrong branch. **Rows
   WERE being written** — attempts went 41 → 46 at 22:47:35Z; the read that looked like silence
   was taken between attempts. I built a theory on a stale timestamp and stated it as cause.
2. **The registration JS ships in the WEB bundle, not the binary.** The app is a WebView on
   getforgenta.com, so a JS fix reaches a phone on the next app open with **no TestFlight
   install**. Six installs were requested tonight and most were unnecessary. Check the served
   chunk before asking for one.

`pending` is what made the last test readable: **no row** = the handler never ran; **`pending`** =
it ran and the app closed before the provider answered; **anything else** = it resolved.

### Also unbuilt: there is no Trophy Case
All five `Trophy` references are a lucide ICON inside `LearnCard`. Tre earned
`lesson:what-a-cash-floor-is` and asked where achievements live. There is no page and no route —
an unbuilt slice, not an unwired one.

## ⇢ FIRST UP — RECONCILE A PLANNED TRANSACTION WITH ITS REAL PLAID TWIN.

**Tre, 2026-09-05, verbatim, and it is the actual ask behind two mis-scoped slices:**
> *"the transaction should auto pull from plaid so I wait for it to ask to categorize it. sometimes
> i will add a transaction that day if its unrelated to a auto move, that way i can already plan
> ahead. then it should merge when the real transaction shows."*

**⚠️ HE IS NOT DOUBLE-COUNTING. Checked, and the number that said he was is a FALSE ALARM.**
A ±1-cent, ±5-day join over his 641 synced rows produced **96 pairs, 63 of his 83 manual rows,
$7,282.14** — and 63 of 83 was the tell. `synced_transactions` **never enters the cash math**:
`useForecastEngineInputs.ts:90` feeds them only to `buildAutoMatchedOccurrences`, and
`matched-occurrence-display.ts:166` says so outright. A manual row separately retires the rule
projection it answers (`overridesGeneratedOccurrence`, `mergeWithGeneratedTransactions` PASS 2).
Do not re-derive this and do not re-report the $7,282.

**THE REAL GAP, and it is an accuracy one:** nothing merges his planned row with the real one, so
**his typed figure stands forever and the bank's never replaces it.** He types $50, the charge is
$52.30, the ledger keeps $50 and nothing tells him. That is the silently-wrong number this repo
refuses everywhere else — the merge exists to CORRECT THE AMOUNT AND DATE, not to tidy a list.

**BUILD IT AS A SECOND CALLER, NOT A SECOND MATCHER.** `transaction-matching.ts` already has the
hard half — `amountConfidence` (exact/strong tolerances), `DATE_WINDOW_DAYS = 5`,
`normalizePaymentSource`, `ruleChargeAccountId`. Its `MatchableRule` aims it at RECURRING RULES.
**Widen the target to manual `transactions`; cloning the logic guarantees drift.**

**Design, decided (Sam, 2026-09-05) — do not re-argue:**
- **Propose, never merge silently.** A wrong auto-merge HIDES a real transaction, which is worse
  than two rows a person can reconcile themselves.
- **Show BOTH figures and say which wins** — his, the bank's, and that the bank's is about to.
- **In the categorize prompt he already waits for**, not a new reconciliation inbox.
- An unmatched manual row stays visible and stays his.
- ⚠️ **The FALSE-merge test matters more than the true one:** two genuinely different transactions
  of the same amount on the same day must NOT merge. That failure loses money from view.

## ✅ CLOSED — lump-sum transfers. Already built, and his constraint settled with a number.
`9f72c935` (test only; committed LOCALLY, unpushed — see the `src` hold below).
- **`lump_sum_transfers` is an ABANDONED DUPLICATE** with 0 rows. The live mechanism is
  `savings_goals.lump_sum_payments`, wired end to end: written `SavingsGoals.tsx:733`, read
  `forecast-engine.ts:797`, mirrored `useCardProjection.ts:920`, rendered
  `MonthlyBreakdownTable.tsx:183-185`, exported `forecast-export.ts:249-251`. **Two of us reasoned
  from a row count on the wrong table and nearly rebuilt a working feature on top of itself.**
- **Measured:** auto-extra OFF, a lump moves cash by exactly 500. Auto-extra ON, it moves cash by
  **ZERO** and auto-extra to that goal drops 1065.16 → 565.16. **A substitution, not a
  double-count.** His constraint is unnecessary for correctness.
- **KEEP IT ANYWAY, for a different reason:** with auto-extra on the control changes nothing
  visible, which is the lying-control shape. Disable it with auto-extra ON, visible and saying why.
  **He was right, for a reason he did not have — tell him, or he keeps a wrong model of his own
  forecast.** NOT BUILT YET; only the test is.

## ✅ THE `src/**` HOLD IS OVER - do not reinstate it from this file's history.
Written 2026-09-06 by Ada. The section below is kept for its REASON, which still stands, but the
hold itself is dead: five `src/**` pushes between 02:08 and 04:19 on 2026-09-06 each ran
`android-build.yml` to `success` (runs 34005691437, 34006159803, 34006829317, 34010612324,
34011182423). Verified with `gh run list`, not assumed. Push on green, as everywhere else.

<details><summary>The hold as written, and why it existed</summary>

### ⚠️ `src/**` COMMITS WERE ON HOLD (Sam, 2026-09-05) until Tre's APNs test lands.
Non-`src` work (migrations, docs, handoff) ships normally. **`9f72c935` is committed and NOT
pushed.** The hold exists because VERSION is now 6.6.0 and `android-build.yml` deploys to **Google
Play production at a 10% staged rollout auto-promoting after 24 hours** on any `src/**` push —
shipping the build that changes the permission flow before the first real-device evidence exists.

</details>

## 📱 TESTFLIGHT 6.6, BUILD 676 — uploaded, waiting on Tre's iOS test.
Install, Settings → Notifications → "Alerts about your money" ON, accept the iOS prompt.
**If it works he sees NOTHING; if it fails he now gets a line under the switch saying why.**
Then fire ONE real delivery and WATCH it — the first test APNs has ever had.
⚠️ **Uploaded ≠ processed.** `altool` succeeded; Apple's processing is async and there are no App
Store Connect credentials locally, only in GitHub. Do not claim it is installable unseen.

### ⚠️ THREE THINGS THAT COST A RELEASE TODAY — read before shipping a build
1. **A green `ios-build` run does NOT mean a build shipped.** `Upload to App Store Connect` is
   gated `if: workflow_dispatch || refs/tags/v`. Eleven green push builds today uploaded NOTHING.
2. **The version train closes.** `CFBundleShortVersionString 6.5` was rejected — *"train version
   '6.5' is closed for new build submissions"*. This is documented in `version-bump.yml`'s own
   header because it happened at 6.3 on 2026-08-21. **Run Bump VERSION; never hand-edit.**
3. **`aps-environment` was missing from `App.entitlements` entirely**, so iOS push could never have
   worked whatever the `.p8` said. Added `c1cff973`. It did NOT break signing — the profile already
   carried the capability. **I predicted it would and never ran `gh run list`; Sam caught it.
   Verify by evidence, not by mechanism, even when the mechanism is right.**

### ⚠️ TWO THINGS THAT OUTLIVE ANY SINGLE TASK, now also in `CLAUDE.md`'s gates
1. **A jsdom green on anything geometric is not evidence.** jsdom reports `scrollHeight` and
   `clientHeight` as 0 and does not clamp `scrollTop`. Eight tests passed for a feature that
   failed three times in Chrome. Model the geometry, or verify in a browser.
2. **Grep for the CALLER, not the definition**, before scoping anything as "not built". Four
   features on 2026-09-05 were already written, exported and never called — and three of them
   had comments describing the behaviour as if it were happening.

## ⚠️ CORRECTIONS TO TODAY'S OWN RECORD — 2026-09-05, made the same day

**A finding I published was scoped to the wrong data, and I am striking it rather than letting
it stand.** I reported that "$1,195.88 of Tre's most expensive debt is treated as free money"
because two cards had a null APR. Those cards — "Capital one SAVOR" and "Fairwinds Preffered
Cash Back" — **belong to a different user.** The query behind it was not scoped to his
`user_id`.

**Tre's actual cards, five active, scoped by joining `auth.users` on his email:**

    Robinhood Credit Card   $46.38      29.99%   rank 0   plaid-linked
    Prime Visa              $8,711.21   27.49%   rank 1   plaid-linked
    Discover it Card       $10,290.04   16.60%   rank 2   plaid-linked
    Venture X                   $0.00   22.99%   rank 3   manual
    Apple Card                  $0.00   22.99%   rank 4   manual
    ------------------------------------------------------
    total                  $19,047.63

That total matches the outside analysis exactly. **There is no missing $6,480, no unranked-card
problem in his data, and every one of his cards carries a real APR and a real rank.**

**THE CODE DEFECT SURVIVES, and is worth fixing on its own merits.**
`credit-card-engine.ts:471` does `const apr = Number(acct.apr) || 0`, so an UNKNOWN rate becomes
ZERO — and under avalanche a 0% card sorts LAST. Any real user who leaves an APR blank has their
most expensive debt paid last, silently, and is told nothing. That is the confident-zero this
codebase refuses everywhere else. Not Tre's problem today; still a defect.

**✅ CLOSED SAME DAY — the `de1000xx` accounts are the APP STORE REVIEWER LOGIN, not a leak.**
I escalated nine accounts inserted at one identical microsecond as demo seed reaching a real
user. Sam searched the whole tree for `de1000xx-0000` and there is **not one match** — not in
`src`, not in `supabase`, not in the migrations. Nothing in the app can produce those ids. The
account is `reviewer@treforged.com`, and the rows are a hand-run seed so a store reviewer signing
in sees a working finance app rather than an empty shell. **Nobody is budgeting on fake balances;
the "user" is Apple.** Right escalation on the evidence I had, wrong conclusion once scoped. Do
not re-raise it.

**✅ CLOSED 2026-09-05 — an unknown card APR was silently treated as 0%.** `credit-card-engine.ts` used to do
`Number(acct.apr) || 0`, and a 0% card sorted LAST under avalanche. **DECIDED (Sam,
2026-09-05): the app ASKS, it does not assume.** Both defaults are the confident-zero mistake —
sorting an unknown rate first invents a pessimistic number just as surely. So: a null-APR card is
NOT ranked and NOT assigned a rate; its MINIMUM is still paid, because it is real debt; it renders
in the ranking list in a "needs your rate" state with an inline input, so the fix is one tap where
the problem is visible; and it never silently sorts last.

✅ **IT IS BUILT, and this section said otherwise for a whole session.** `0d91028b` ("a card with
no APR is asked for its rate, not ranked as if it were 0%") shipped every part of the decision
above: `credit-card-engine.ts:505` carries `aprIsUnknown` as a real distinction instead of
collapsing an unknown rate to 0, `rankableForStrategy` (line 104) keeps such a card out of the
ranking, `debt-payoff-order.ts` threads the flag through both list builders, and
`AvalancheOrderList` renders the "needs your rate" row with its inline input — mounted for real at
`CreditCardEngine.tsx:1608`, not merely exported.

⚠️ **This is the CALLER gate firing in the direction nobody watches.** It was written for features
described as built that were never called. The opposite costs just as much: a record saying NOT
BUILT about something shipped, called and tested, which the next session rebuilds on top of itself.
`grep -rn aprIsUnknown src/` was the whole check. **Grep before you BUILD, not only before you scope.**

**Also settled today, from Tre:** the Robinhood card is **NOT** to be demoted — *"it needs to be
paid first, and on time in full"* — so `surplus_sort_order: 0` stays, and its due day is now the
10th. And "is EU/Japan closed for Apple and Google too?" — **both, and it is one disclosure
question wearing two store-specific forms**: Japan is a GOOGLE requirement (business operator's
name, phone and physical address under the Specified Commercial Transactions Act) and the EU is
an APPLE one (the DSA trader declaration, published on the product page in all 27 territories).
Neither region can be served without the disclosure he has refused, on either store.

## 2026-09-05 — OVERDRIVE. Twelve things shipped, and three of them were live defects nobody knew about.

Every item below is on `origin/main`, verified by CONTENTS, with its gate run. Detail is in the
commit bodies; this is the pointer list.

**⚠️ THE THREE LIVE DEFECTS, in the order they cost money:**

1. **RevenueCat was never configured for a returning user.** `Purchases.configure` was called
   only on `SIGNED_IN`. Supabase fires `INITIAL_SESSION` when it rehydrates a stored session,
   which is nearly every launch of the mobile app — a person who stays signed in never sees
   `SIGNED_IN` again. So `getOfferings`, `purchasePackage` and `restorePurchases` all returned
   null on the `!configured` guard: **the paywall had nothing to show and Restore Purchases
   silently did nothing.** Same event that caused the Google OAuth popup hang (`7108311a`); it
   survives because it never fires in a fresh-login test. Also fixed: the guard was a bare
   boolean, so a second user on a live SDK would have had their entitlements attached to the
   FIRST user's customer.
2. **The hosted Plaid sheet could hang on a blank white page forever.** It waited for ONE
   signal, an `appUrlOpen` on our custom scheme. When Plaid renders a completion page instead
   of redirecting, that never fires. The redirect is a hint; the SERVER is the truth, so the
   result endpoint is now polled WHILE the sheet is open and a completed session closes it.
   Tre hit this on his own phone at 06:54Z — the link had SUCCEEDED underneath.
3. **An anonymous stranger could read the subscriber counts.** `revenue_summary_lines()` is
   SECURITY DEFINER and carried `EXECUTE` to PUBLIC, which includes `anon`, whose key ships in
   the app bundle. Revoked, and proven closed with a real anonymous request (401 / 42501).

**⛔ STANDING RULE, LEARNED THE HARD WAY TODAY — put this anywhere you touch a definer function:
`CREATE` RE-GRANTS `EXECUTE` TO `PUBLIC`.** Adding an OUT column to `revenue_summary_lines`
needed a `DROP` and `CREATE`, and that would have silently reopened the leak closed an hour
earlier. **Every `DROP`/`CREATE` on a SECURITY DEFINER function must carry its REVOKEs with it,
in the same migration.** The absence of a grant is not a state you can rely on surviving a
redefinition, and nothing in the schema warns you.

**MONEY, RECONCILED FROM STRIPE ITSELF — the answer is exact.** `revenue_summary_lines` reported
five ACTIVE STRIPE PREMIUM subscriptions. Stripe live mode: 8 subscriptions, 6 active, **every
one carrying a discount**, five of six with no payment method, and **exactly ONE charge in the
account's entire history — $4.99 on 2026-03-26, billed to tre@treforged.com testing his own
checkout.** No customer money has ever moved. Fixed with an `is_comp` column, defaulting TRUE so
a forgotten write UNDER-reports rather than invents revenue; only `invoice.paid` with
`amount_paid > 0` clears it. Comps are reported separately and labelled, never dropped.
⚠️ **"No `stripe_subscription_id`" could never have worked as the rule** — one comp holds a real
subscription id, and its comp lives in a Stripe discount that is not in this database and cannot
be. Inference here is impossible, not merely fragile.

**A PAYMENT PIN IS A REPLACEMENT.** See the RESOLVED section at the top of this file. The
promo-card explanation for the payoff date is struck.

**Also shipped:** three one-day-early date defects plus an eslint rule so the class cannot return
(`net-worth-snapshot.ts:46` was the one nobody had counted — it compares a DATE against a live
instant, so unlike its neighbours the offset does not cancel); the Student Loans chart responds
to a tap on mobile (recharts selects on `touchmove` only, and a stationary tap never sends one);
duplicate bank rows in Linked Banks (the dedupe was never broken — the hook returned revoked
connections); the supersede path now hangs up at Plaid's end too; the btn vocabulary across four
surfaces with 73 labels lifted to the `text-xs` floor; the Security tab's three different
"remove" treatments unified; `docs/dynamic-cash-floor.md`, `docs/distribution-expansion.md`,
`docs/ux-rules-audit.md`; `src/lib/variable-bill-buffer.ts`; handoff.md pruned 101 KB to 54 KB.

**BASELINES TO MEASURE AGAINST — write nothing over these, they are the before picture:**
- **RevenueCat, 2026-09-05: 172 customers, 0 trialing, 0 paid, $0 revenue**, against 31 Supabase
  accounts and only 2 rows carrying a `revenuecat_app_user_id`. The identifier column is
  overwhelmingly `$RCAnonymousID:`. After the INITIAL_SESSION fix reaches a device, NEW customers
  should stop being anonymous. That ratio is now the regression signal.
- **Users: 31 total, 2 active in 7 days, 4 in 30 days, 23 dormant, 4 never signed in. Latest
  signup 2026-08-07.**
- **getforgenta.com: 0 CACHED REQUESTS in 30 days against 88.99k total.** Zero, not low. Every
  request on a static Vite build is reaching origin. Worth a look at the Vercel cache headers or
  a zone bypass rule — a free performance and cost win, not urgent.

**OPEN, AND HONEST ABOUT IT:**
- The RevenueCat fix is **not proven on a device.** It has unit and behavioural cover; it has not
  been pressed on a phone. Do that before drawing conclusions from the customer ratio.
- ✅ **CLOSED 2026-09-06 — `logIn()` is never called, and that is CORRECT. The premise was false.**
  Checked against the code rather than re-derived: `configure` is only ever reached with a real
  `userId` (from `AuthContext` on `SIGNED_IN || INITIAL_SESSION`), and `getOfferings`,
  `purchasePackage` and `restorePurchases` all return null while `configuredUserId === null` — so a
  purchase CANNOT be made before identification and there is no anonymous customer to alias.
  `logIn` is for apps that configure anonymously and identify later; this one identifies first.
  **Recorded as a comment in `purchases.ts` so nobody "fixes" it.**
  ⚠️ **What IS still unexplained is a DATA question:** the 172 customers keyed `$RCAnonymousID:`.
  Nothing in that file can produce one. Likely pre-dating the `INITIAL_SESSION` fix, or the native
  SDK self-initialising outside the JS path — **a guess, to be MEASURED before anyone acts on it.**
- The chart touch fix is **not verified by a real finger on a real phone.** jsdom cannot exercise
  recharts point selection at all — not even a mouse — so no test in this repo can close that.
- `CreditCardEngine.tsx`'s chart has the **identical** recharts touch gap, untouched.
- Only the Credit Card tab is inside an `ErrorBoundary`; a throw in any of the other four
  `LiabilityTrajectoryChart` usages in `DebtPayoff.tsx` (`:480, :537, :647, :718`) blanks the
  whole `/debt` page.
- **Bank linking is hardcoded to the US** — `country_codes: ["US"]` at
  `plaid-create-link-token/index.ts:118` and `plaid-exchange-token/index.ts:170`. First thing
  that must move for ANY market. Nobody had counted it.
- Distribution: **EU and Japan are refused and final** (Tre, on the DSA trader declaration).
  Target is everything except those. Tranche A is UK, Canada, Australia, New Zealand.
- The account-wide Cloudflare 5xx belongs to **another zone**, not getforgenta — its own zone
  shows ~1,081 requests in 24 h and no French traffic at all. Vercel reports ZERO runtime errors
  for getforgenta, and it is a static site with no `api/` directory, so there is no route to
  throw. Not this desk's.

## ⛔ TWO STANDING PATTERNS, each of which has now cost more than one bug

**1. ANYTHING THAT MUST RUN FOR A *RETURNING* USER RIDES ON `INITIAL_SESSION`, NOT JUST
`SIGNED_IN`.** Supabase fires `INITIAL_SESSION` when it rehydrates a session from storage, which
is nearly every launch of the mobile app — a person who stays signed in **never sees `SIGNED_IN`
again**. It has now cost three separate things:
- the Google OAuth popup hang (`7108311a`),
- the RevenueCat SDK never being configured, so the paywall and Restore Purchases silently did
  nothing for every returning user,
- push registration, which would have collected tokens from first-time sign-ins and nobody else.
It survives because **it never fires in a fresh-login test.** Any new branch in
`AuthContext.tsx`'s `onAuthStateChange` gets asked this question before it is written.

**2. AN AGENT CANNOT REPORT THAT IT IS SPINNING, so watch the FILE, not the agent.** A
`sonnet-executor` sat listed as "reviewing the final diff in LiabilityTrajectoryChart.tsx" for
over an hour after that file's last write — the work was long since committed. **Nothing flagged
it and nothing would have**: this desk was productive throughout, so it looked healthy from the
inside, and it took Tre reading the terminal footer to spot it. Same confident-blank shape as a
desk that is simply absent from a stuck-check.
**The check: when you spawn an agent, note the file it should be touching. "Still listed AND its
target file has not moved in 30 minutes" is the signal.** Compare mtime against now; that is the
whole test. And prefer an `llm` shim call, which returns and ends — an agent can sit.

## ✅ CHASE PAY OVER TIME — THE CODE HALF IS DONE. The DATA half is Tre's.

⚠️ **"Not started" was wrong, and so was the sweep that said so.** The 2026-09-05 caller gate
grepped for `payOverTime` / `pay_over_time`, found nothing, and recorded the item as unbuilt. **The
feature is called `monthly_fee`.** A caller-grep is only as good as the symbol you grep for.

What was actually true, in three layers:
1. `monthly_fee` and `fixed_term` existed on `BalanceTranche`, were parsed, normalised and had
   their own test file. Correct.
2. **`credit-card-engine.ts` threw the fee away at the boundary** — it read `monthlyInterest` and
   `totalMonthlyInterest` while `trancheInterestBreakdown` was already computing `monthlyCost` and
   `totalMonthlyCost`. Computed, tested, discarded. Fixed; mutation-verified.
3. **`tranche-form.ts` dropped both fields**, so a fee could not be ENTERED and would have been
   **erased by any save**. That is the SECOND time this file has done exactly that — `min_payment`
   from `ef75f6d5` to 2026-08-22 — and a warning comment did not prevent the repeat, so there is
   now `tranche-form.roundTrip.test.ts` which fails on the next field somebody forgets.
4. `BalanceTrancheEditor` had no inputs. Now has a Monthly Plan Fee box and a Fixed term checkbox,
   both pressed in tests.

⚠️ **NO NUMBER MOVES TODAY.** Measured: 3 accounts, 6 tranche rows, **zero carry a fee**. The
change only takes effect once a plan is entered, and parity holds to the cent for anything without
one.

### ⬜ STILL OPEN AND IT IS TRE'S — the three plans are MISSING from `balance_tranches`
$2,101.39 of 0% instalment principal sits in the untranched remainder at 27.49% — **~$577/yr of
interest he will not pay** — and $284.40 of fees have nowhere to live until the rows exist.
**I did not enter them:** that is his data off three confirmation emails I do not have, and
inventing tranche rows on a live financial account from a summary is not something to do
unattended. He can now type them in: balance, 0% APR, the plan end date, the monthly instalment,
the monthly fee, and tick Fixed term.

<details><summary>The original finding, 2026-09-05</summary>


Reconciled 2026-09-05 against three plan-confirmation emails. **Two errors pointing in OPPOSITE
directions, which is why nothing looked wrong.**

- **The three plans are MISSING from `balance_tranches`.** No balance match, no monthly match, and
  the timing proves it: a 12-month plan opened Sep 2026 ends **Sep 2027**, and his stored expiries
  are Feb 2027, Jul 2027 (×2), Aug 2027. So **$2,101.39 of 0% instalment principal sits in the
  $3,123.46 untranched remainder and is charged at 27.49%** — roughly **$577/yr of interest he
  will not pay**.
- **The FEES are real and have no field.** Every plan's monthly × 12 equals principal + fees to
  within two cents (PayPal Zettle 12 × $124.06 = $1,488.72 vs $1,322.50 + $166.20 = $1,488.70).
  **$284.40 across three, 13.5% of principal, invisible to the forecast.**

Net: the forecast **overstates** these three by about **$290/yr**, with both components wrong.

**⚠️ POSSIBLY BIGGER, AND UNVERIFIED — needs his statements, do not guess.** All four stored
tranches divide to exactly whole payment counts (6.000, 11.000, 10.999, 12.000). They were
DERIVED as balance ÷ months, not read off a statement, so their `min_payment` is principal-only
and excludes whatever fee each carries. At a comparable load that is another **~$754** hidden
across the $5,587.75.

**THE MODELLING QUESTION UNDERNEATH THE FEE, and it moves the payoff DATE rather than the cost.**
Chase allocates minimums to the LOWEST APR and surplus to the HIGHEST, so he **cannot selectively
prepay a 0% plan while carrying a 27.49% balance.** These are FIXED 12-month obligations. The
engine has no way to express "this tranche's schedule cannot be shortened" — `min_payment` on the
tranche is close but is a floor, not a ceiling.

**The fix:** a FEE concept on the tranche — a flat monthly amount, not a rate, because that is how
Pay Over Time charges — plus the payoff math including it. A 0% tranche is not a free tranche.
Same confident-zero as the null APR, on the same card.

</details>

## HIS LIVE NUMBERS, 2026-09-05 — useful, and they go stale fast

Answering "can I pay $753.75 and still clear my floor?" — **no, short by $386.95.**
- Cash **$1,002.58**: Chase Checking $728.28, General Operations $162.59, Savings $106.71,
  Alliant $5.00.
- Paid **WEEKLY on Fridays** (`paycheck_day: 5` = day-of-week). Gross $1,093, tax 22%, net
  **~$852.54/wk**. 2026-09-05 is a **Saturday**, so the balance already includes Friday's pay and
  the next is **Fri 2026-09-11**.
- Due before then: **Prime Visa min $559.40 (due 09-07)** + Phone Bill to Mom $30 (09-10) +
  Robinhood $46.38 (09-10, pays in full) = **$635.78**. Discover's due day is the 1st — outside.
- He could pay **$366.80** today, or the lot after Friday.

⚠️ **His `cash_floor` reads 2500 but `cash_floor_is_manual` is FALSE**, so 2500 is a saved
preference and is **NOT the floor in force** — the measured bills figure is. Anyone quoting 2500
is quoting a number the engine is not using. Confirmed live, exactly as `docs/dynamic-cash-floor.md`
describes.

## ✅ PUSH NOTIFICATIONS — storage, sender AND transport are ALL built. `664bdb10` + `efa5d1ee`.

Full detail, Tre's seven console steps and the device-proof runbook: **`docs/push-runbook.md`**.

**Built, applied and verified:** `device_tokens`, `push_sends`, `push_send_runs` (anon `GET` on
all three returns **401/42501**, checked with a real request); `src/lib/push-registration.ts` with
11 cases; `src/lib/push-store.ts`; wiring in `AuthContext` beside the RevenueCat calls, on
`SIGNED_IN || INITIAL_SESSION`.

**⚠️ THE FORK THAT DECIDES WHAT THE SENDER IS.** `notification-policy.ts` is transport-agnostic
and the sender can call it as-is — but its SIGNALS are not equally available to a server.
`upcomingBills`, `projectedCashAtNextBill`, `cashFloor` and `newMilestones` all come from the
forecast engine, which is **client TypeScript that has never run on a server.** So:
- **Server-computable today: `learn_lesson` and `streak_risk` only.** Both derive from the
  `achievements` table (`lesson:<slug>` rows with `earned_at`) plus the bundled lesson list. The
  maths is `learn-streak.ts`, pure, and needs porting to `supabase/functions/_shared/` — Deno
  cannot import from `src/`.
- **NOT server-computable without porting the engine: everything money-shaped.**
Those two ARE what Tre asked for, so the first sender ships them — **and it must say in its own
code that it covers two of seven kinds**, or the next person reads a working sender and assumes
bill alerts reach dormant users when they do not. Porting the engine's signals is its own project.

**⚠️ THE TRAP:** `capacitor.config.ts:8` points the shipped app at `https://getforgenta.com` as a
WebView, so **the registration JS must be in the DEPLOYED WEB BUILD.** A native rebuild without a
matching web deploy registers nothing and reports no error. The same fact is the upside: a web
deploy reaches mobile users with no app store review.

**Blocked on Tre only:** the APNs `.p8`, Key ID, Team ID, `google-services.json` and the FCM
service-account JSON. Nothing else in the build waits on him.

✅ **THE SENDER EXISTS — this heading said "the sender is not" built until 2026-09-05.**
`supabase/functions/push-send/index.ts`, 291 lines (`664bdb10`), with the APNs HTTP/2 and FCM v1
transport in `efa5d1ee`. It ships exactly the shape this section specified: `x-cron-secret` only,
dry-run defaulting to TRUE, and a header block naming the two kinds it sends (`learn_lesson`,
`streak_risk`) and the five it does not, so nobody reads a working sender and assumes bill alerts
reach dormant users. The fork above is now DESIGN DOCUMENTATION for that code, not pending work.
**What genuinely remains is the credentials above, which are Tre's hands.**

### Caller-gate sweep of the rest of this queue, 2026-09-05
Applied `grep -rn <symbol> src/ supabase/` to each remaining item before starting any of them.
**Genuinely open, nothing written:** Chase Pay Over Time (no `payOverTime` / `pay_over_time`
anywhere in `src/`) and the OG billing-consent SURFACES (no `og_consent` in any `.tsx`; the gate
itself is in). `useLumpSumTransfers` still has no `.tsx` caller, unchanged from the earlier find.
Those three are the real remaining work in this file.

## OG billing consent — the GATE is in, the SURFACES are not (2026-09-03)

`decideAnniversary` now refuses to grant without a confirmed `og_billing_consent`
row (`needs_consent`), Stripe-native members included — `docs/og-cohort.md` states
that rule with no exception. Gate proven by deletion: remove it and three tests
fail, including "NEVER GRANTS WITHOUT A CONFIRMED ROW".

Two deliberate choices, both toward not lying in the record:
- `needs_consent` is REPORT-ONLY. Writing `reward_action_required_at` would record
  that we asked somebody we have not — the same class of lie as a
  `reward_granted_at` written by code that granted nothing.
- A failed consent READ is a failure, not an absent consent. A database blip that
  read as "never asked" would re-email someone who already confirmed.

The WEB CONFIRMATION PAGE is built too: `functions/og-consent`, server-rendered
so it stays out of the Capacitor bundle (a React route would ship inside the
mobile app whether or not anything links to it). The link is a credential —
256-bit CSPRNG, SHA-256 at rest, expiring, single-use, own table so
`og_billing_consent` never gains an UPDATE path. A GET records nothing; both
buttons are POST. Tests parse real DOM and PRESS the buttons; switch either form
to GET and three fail.

The EMAIL is built too: `functions/og-consent-ask` + pure `_shared/og-consent-email.ts`.
It reuses `decideAnniversary` rather than re-deriving who is owed, retires any
outstanding link before issuing a new one, and writes the `asked` row AFTER the
send — recording first would claim we asked someone we did not, and the unique
index would then block the retry that fixes it. Dry run is the default and is
checked at every branch; `?limit=N` caps the blast radius and a malformed limit
is a 400, never "no limit".

**`needs_consent` stays report-only in `og-anniversary` ON PURPOSE — that is not
an unfinished flip.** The notify job is its own function so the emails can be
stopped without stopping the accounting. Turning the ask on is a SCHEDULING
decision (a cron entry calling `og-consent-ask?dry_run=0`), not a code change.

**Next up here:**
1. Nothing in code. The flow is notify -> confirm -> act end to end; what remains
   is applying migrations, setting env, deploying, and scheduling — all Tre's.
2. A consent copy **v2** when convenient: v1's body says "Decline below", but the
   buttons are on the linked page, not below in the email. NEVER edit v1 in place
   (rule 1 of `og-consent-text.ts` — it would rewrite what everyone already
   consented to); add a version.
3. The Stripe grant itself stays unwired pending Tre's explicit yes; it is a real
   action on his live Stripe account.

**Migrations WRITTEN, NOT APPLIED** — `20260903_og_billing_consent.sql`,
`20260903_og_anniversary_consent_required.sql`, `20260903_og_consent_tokens.sql`.
**`og-consent` must deploy with `verify_jwt = false`** — declared in
`config.toml`, but the MCP/dashboard deploy path ignores that file and defaults
to true, which would break the page for anyone not signed in.

## DEMO FIXTURE REBUILT 2026-09-03 — a persona the app is FOR, and 12 filmable lines

The fixture is the ONLY thing that can ever be filmed (Tre): his real accounts are
not marketing material. It was measured weak on 2026-09-03 — zero balance tranches,
so the strongest line the app produces could not fire — and real card brands in the
names. Both are fixed; what follows is what it IS now.

**The persona changed, and that was the real defect.** The demo ran on the app's
`DEFAULT_PROFILE`: $1,875/wk gross, a roommate, ~$2,800/mo of surplus, and a forecast
climbing past $91,000 in eighteen months while the same fixture carried $6,482 of card
debt at 24.74%. Nobody saving $2,800 a month carries that balance. `demoProfile` in
`src/lib/demo-data.ts` is now its own object — $968/wk gross, thin surplus, a
semiannual $1,014 insurance premium — and `useSupabaseData`'s demo branch reads it.
A signed-out non-demo user still gets `DEFAULT_PROFILE`.

**What the engine now says about it** (`npx vitest run src/lib/__tests__/demo-marketing-lines.engine.test.ts`):
cards clear Dec 2027 ("CC Debt Free"), no month breaches its floor, tightest month is
$2 above it, $2,417 reprices 0% -> 24.74% on May 11 2027, minimums alone would cost
$8,924 on $6,482.

- **The harness is the reusable part:** `src/lib/__tests__/fixtures/demo-forecast-harness.ts`
  runs the app's own card sim (`useCardProjection`, so callers need jsdom) and feeds it
  to `calculateForecast`. `runDemoForecast` WITHOUT cards reads several hundred a month
  too rich — the file says why. Use `runDemoForecastWithCards` for anything about cash.
- **Twelve lines, four types** (repricing / leakage / acceleration / cash-floor), every
  figure read out of the engine run, guarded against Ruby's F1/F2/F5/F6 in
  `demo-marketing-lines.engine.test.ts`. Spec: `tre-forged-marketing/docs/DEMO-FIXTURE-SPEC.md`.
- **A cash-floor BREACH line is not producible and should not be chased.** The converged
  engine protects the floor by holding back debt payments, so a breach only happens for a
  persona the app cannot help. The honest cash-floor lines are the tightest-month headroom
  and the lumpy premium, and that is what shipped.

## RULE: verify against the DEMO FIXTURE, not Tre's live account

Set 2026-09-03 after I toggled two of his card payment preferences to answer a
marketing question, then restored both and verified. Sam's reasoning, and it is
right: **a restore that verifies is still one step short of never having changed
it.** If a sync, webhook or scheduled job had fired between the change and the
restore, the restore would have been correct and the intervening state would
still have been wrong. Low probability, real, avoidable at no cost.

**Mutate his account only when ONLY his data can answer the question.** That was
not true here — the fixture would have answered it AND given a second dataset.

⚠️ `/demo` does NOT switch while signed in — it stays on the real account, checked.
So the fixture route for a question like this is a **headless comparison**
(compute with `paymentPreference: 'statement'` vs `'min'` over `demo-data.ts` and
diff the payoff months), not the browser.

## Two open items from the "one input, one number" question

1. **Run the payment-mode toggle against the demo fixture.** On Tre's data the
   payoff MONTH did not move on either card tested — only the label changed,
   "Interest-free: 16 mo (Dec 2027)" → "Payoff: 16 months (Dec 2027)". His card
   set is promo-heavy, so his payoff months are pinned by 0% expiry schedules
   rather than payment size. **n=1: "does not move ON THIS DATA", not "cannot
   move".** Ordinary revolving debt would likely move. If it does, Ruby gets a
   second marketing asset; if it does not, that is a real product finding about
   what the control does.
2. **The recompute takes 2,499 ms** (measured, card toggle → label change). Worth
   fixing on its own merits, not just for filming: two and a half seconds of
   nothing after a tap reads as a broken control.

**The stronger finding, already routed to Ruby:** the app ALREADY renders
zero-input lines that name a number, a date and a consequence — e.g. *"$3,562 at
0% reprices to 27.49% on Jul 7, 2027 (+$82/mo) — clearing it first needs $356/mo
for 10 months"*, and the cash-floor warning naming the exact card and statement.
No tap, no wait, nothing built for a camera.

## `reach` — EXPOSED and GRANTED 2026-09-04. Containment is proven for the first time.

Supersedes the 2026-09-03 section below, whose evidence proved routing rather than
containment. Sequence, all of it verified against the live project rather than reported:

1. **Tre toggled `reach` into the exposed schemas** (via Sam). I approved it: reachable
   is not permitted, the revokes are the control, and hiding the schema was the thing
   PREVENTING the control from ever being tested.
2. **Exposure immediately revealed a bug that had been invisible since 0001.** Every
   migration ended `revoke all on schema reach from anon, authenticated, public` — and
   **PUBLIC is every role, `service_role` included**, with no explicit grant anywhere. So
   the APP had no USAGE either, and `/r/<code>` returned `permission denied for schema
   reach`: the exact words of correct containment, produced by a completely different
   fact. Third time on this schema that two failures produced one observation.
3. **`0005_service_role_grants.sql` applied by me** (migration
   `reach_service_role_grants_and_rate_limit_rls`), read in full first. Revoke FIRST then
   grant — the reverse order strips `service_role` again, which is how four consecutive
   migrations looked right and were wrong.

Verified AFTER the apply, from `has_*_privilege` and `pg_class`, not from the success flag:

    role            schema_usage  select tracked_link  insert click  execute limiter
    anon            false         false                false         false
    authenticated   false         false                false         false
    service_role    TRUE          TRUE                 TRUE          TRUE
    RLS enabled on campaign, click, rate_limit, tracked_link — all four

Piper's `verify_reach_grants.sql` also caught a real omission the first time it ran
against something live: `reach.rate_limit` had RLS off (her 0004). Closed by 0005.

**CLOSED 2026-09-04 — the app read a row, and the privacy claim is now about a real
request.** Piper's smoke test: `/r/<code>` → 302 to the real destination, `/api/briefs/…`
→ 200. The click row the APP wrote, every column: `id, link_id, at,
referrer_host='l.instagram.com', device='mobile'` — **no IP, no user agent**, against a
request that carried a real iPhone UA and a real `Referer`. The limiter row held a salted
hash (`brief-read:57a8f312…`), which also proves `rate_limit_hit` executed as
`service_role`. Anon probes after the grants: 401/42501 on both a read AND a write, with a
live-key control. Full verify 7/7 PASS.

**Cleanup verified by ME, not by her report:** `count(*)` on all four `reach` tables reads
0/0/0/0. She nearly missed the `rate_limit` row because she wrote two rows and the APP
wrote the other two — a cleanup list built from "what I inserted" misses what the system
inserted in response, and the system's rows are the ones carrying request-derived data.

**Two open notes, neither urgent:** `relforcerowsecurity` is false on all four tables, so
the table OWNER bypasses RLS (Postgres default, consistent) — only matters if anything
connects as the owner rather than `service_role`. And `alter default privileges` binds to
the role that RAN it, so a future migration applied as a different role lands ungranted —
`for role postgres` would pin it.

## ⛔ DO NOT LET ANYONE "TIDY" THE `send.treforged.com` DNS RECORDS

Forgenta's auth mail AND the OG consent email both send from
`noreply@treforged.com` through Resend (`og-consent-ask/index.ts:38`,
`CONSENT_FROM`). Ellis established 2026-09-03 that `send.treforged.com` is **not a
stray second setup**: it is the MAIL FROM / bounce subdomain Resend requires to
verify `treforged.com`, and its SPF TXT and `feedback-smtp` MX come from Resend's
own record set.

Mail from `noreply@treforged.com` aligns on DKIM strictly (`d=treforged.com`) AND
on SPF under relaxed alignment via that subdomain. **Sam moved the root domain to
`p=quarantine` today**, so removing those `send.` records would break bounce
handling and leave DMARC resting on DKIM alone — with quarantine live, that is
consent emails and password resets landing in spam or vanishing.

It looks like clutter. It is not. This is second-hand from Ellis and I have not
read the DNS zone myself, but the consequence lands on my flow, so it is recorded
here rather than only in his repo.

## MULTI-CURRENCY: Tre said PER-CURRENCY SUBTOTALS (2026-09-04). The blocker is now DATA, not the decision.

**Measured before designing anything, and it decides the whole feature: this app stores
NO currency on any money-carrying row.**

    grep currency src/integrations/supabase/types.ts  -> profiles, expenses, capital_contributions
    accounts                                          -> NO currency column
    transactions / recurring_rules                    -> NO currency column
    grep -rl currency supabase/migrations             -> ZERO files
    grep -rl "capital_contributions" src              -> types.ts only
    grep -rl "from('expenses')" src                   -> nothing

So the two tables that DO carry a currency are **not used by the app at all**, and the
one live column — `profiles.currency` — is a display preference, not a per-amount fact.
Every balance, rule and transaction in Forgenta is a bare number.

**Consequence: "per-currency subtotals" has nothing to group by yet.** The decision Tre
made is the right one and it is not the next step. The next step is attaching a currency
to money-carrying rows, and that is a migration + a write path + a backfill of every
existing row to `USD`, which is a slice in its own right and was NOT started at 84% of a
91% weekly cap.

**Design constraints, settled now so the slice does not re-litigate them:**
- Subtotal PER CURRENCY. Never a single converted total, and never a rate this app invents.
- A missing rate renders as a missing subtotal with a reason, not a converted figure. An
  empty subtotal beats a confident wrong one — Tre's own recorded preference, and currency
  is where a plausible-looking number hides a wrong one most easily.
- `formatCurrency` already takes a per-call currency override and `setMoneyDisplay` exists
  (`src/lib/calculations.ts`). The display layer is ready; the data layer is not.
- Settings' currency selector stays DISABLED with its note until rows carry a currency.
  A selector that changes the symbol on unconverted USD numbers is a lie with a dropdown.

## INTERNATIONAL RELEASE — planned, NOT started. Plan: `docs/international-release-plan.md`

Tre wants Forgenta in more countries. **No store setting has been changed, and the
app must be fixed first** — the store change is a checkbox, the app change is the
work, and adding a country before the app is right ships wrong numbers on day one.
Sam agreed the reordering.

**THE LIVE BUG THIS FOUND, fixed:** the Settings currency picker offered USD, EUR
and GBP and **did nothing**. `formatCurrency` takes a currency argument that ZERO
call sites pass, and the only reader of `profile.currency` outside Settings is the
home-screen widget. Now DISABLED with an honest note, **verified on screen**
(`disabled: true`, value `USD`, note rendering).

**Counted, not estimated:** 44 hardcoded `en-US`, 91 `toLocale` sites, 32 pinned
to `en-US`, 19 hardcoded `$`, 0 `formatCurrency` calls passing a currency.

⚠️ **I OVERSTATED THE DATE PROBLEM AND CORRECTED IT.** I first said those 32 sites
render MM/DD/YYYY. They do not: every one passes `{ month: 'short', ... }`, and
there are ZERO bare `toLocaleDateString('en-US')` calls and ZERO numeric month
options. The app renders `Sep 2026`, unambiguous in any locale. The real gap is
**hardcoded English month names** — a translation issue, not a wrong date. This
removes the argument that dates block an English-speaking first tranche. `exportPdf.ts:168` and `notification-policy.ts:307` hardcode
locale AND USD together.

**Decisions Tre has made:** real multi-currency, NOT display-only relabelling.
**Japan is EXCLUDED and decided** — Google requires publishing the business
operator's name, phone and physical address, and he declined. Do not re-ask.

**Still his to decide:** per-currency subtotals or one converted total, and which
rate applies to HISTORY (a payoff projection converted at today's rate differs
from one converted per-transaction, and it compounds over the horizon).

**Next, in order:** thread currency AND locale through `formatCurrency` → the 32
date sites → then countries. Rate-source criteria are in the plan; nothing has
been priced or read, so do not treat any provider as chosen.

## DEV SIGN-IN: Google SSO carries, and the session DOES drop

Tre is signed into Google in the Claude-controlled Chrome, so `/auth` → "Continue
with Google" signs in with **no credential typed**. Worth knowing because the
Supabase session dropped mid-verification today — a probe that read SIGNED IN at
3560s was signed out twenty minutes later. If a page bounces to `/auth`, re-run
that click rather than assuming the dev server broke.

⚠️ `Object.keys(localStorage)` can show `[BLOCKED: JWT token]` instead of the
`sb-*` key. That is the harness redacting, NOT proof of being signed out. Check
where the app actually routes.

## ✅ SHIPPED — the cash-floor warning Tre asked for. `d97f00d4` + `6c3e94fb`.

His ask (2026-08-27, approved, unstarted): *"a mandatory marker on each card is
fine. it just lets the user know a not meeting the cash floor is inevitable and
to check cash floor."*

**Do not build the marker. It already exists.** `accounts.payment_preference`
('statement' | 'full') and `autopayFullBalance` are both live and read all over
`credit-card-engine.ts`. The engine also already computes WHY a month is tight:
`ccMandatoryReasonByMonth` (useCardProjection.ts:1293) names the card whose pinned
statement sized the reserve, and `floor-protection.ts:210` prefers it over its
own heuristics — with a comment recording that the heuristic once reported a
$2,443 Prime Visa reserve as "$200 Pay sibling to watch dogs".

**THE ACTUAL GAP: that reason never reaches the user.** `CreditCardEngine.tsx:763`
builds its OWN local `saveUpMonths` set and the sim's `saveUpReason` map is
rendered nowhere — `grep saveUpReason src/components src/pages` returns nothing.
So the app computes a known-cause explanation specifically to avoid mislabelling,
then throws it away and recomputes a worse one.

So the slice is: surface `cardProjection.saveUpReason` / `saveUpMonths` on the
debt page instead of the local recomputation, and say plainly when the floor
cannot be met because a full-balance card must be paid. Warning first, engine
input second — his own ordering.

⚠️ It is a UI slice on a money page, so it needs a real press, not a green build:
`dev-signin` skill, then look at the page. Do not ship it on tests alone.

✅ **DONE, INCLUDING THE EXACT GAP NAMED ABOVE — and this heading said "NEXT SLICE" until
2026-09-05.** `d97f00d4` built `src/lib/cash-floor-warning.ts`; `6c3e94fb` pinned what a
month-0 shortfall shows, found by pressing the page rather than by a green build.
`CreditCardEngine.tsx:1087` now passes `convergedCardProjection.saveUpReason` into
`buildCashFloorWarning` instead of recomputing a worse reason locally, and the warning renders
at line 1560 behind `data-testid="cash-floor-warning"`. The local `saveUpMonths` recomputation
this section was written to remove is gone.

## iOS CI secrets are being rotated this week (2026-09-03) — what will break

Tre's Apple distribution certificate is being rotated, which invalidates every
provisioning profile built on it. `.github/workflows/ios-build.yml` consumes
`BUILD_CERTIFICATE_BASE64` and `BUILD_PROVISION_PROFILE_BASE64`; **they must be
replaced in the SAME pass.** Update one and not the other and iOS CI goes red on
a signing error that never mentions certificates — expect an hour lost to it
otherwise. Runbook lives at
`claudecontext/security-reviews/2026-09-03_credential-rotation-runbook.md` (Sam's).

App Store Connect keys, read off the live key list 2026-09-03 so nobody re-checks:
- **`VP34CQ3J84`** ("Forged CI") is the LIVE API key — the only active one, last
  used today. It is what `APP_STORE_CONNECT_API_KEY_ID` resolves to. Nothing in
  this tree names it: the workflow builds `AuthKey_${...}.p8` at runtime, so
  rotating is a secrets update, not a code change.
- **`AH86Q9RAQW`** is NOT active. Nothing to revoke; any file of that name is a
  stale artefact.
- **`G77784XFWZ`** ("Forged Subscription") is an ACTIVE in-app purchase key with
  no consumer in this repo. ⚠️ Apple shows DOWNLOADED, not LAST USED, for these,
  so **Apple cannot tell you whether anything uses it** — the only place that
  answers it is RevenueCat's app settings. Revoking it fails SILENTLY
  (subscription status going stale), never as a red build.

When the profile is regenerated, **include the App Group entitlement** — the iOS
widget slice (`docs/ios-widgets-scope.md`, scoped not started) needs it, and it
is free to fold into a regeneration that is happening anyway.

---

## LESSON — what live-pressing found that 3,272 green tests did not

A green suite is not a pressed button. Live UI verification needs the `dev-signin` skill.
The specific findings: `handoff-archive.md`.

## DECISIONS THAT ARE SETTLED — DO NOT RE-OPEN

- **The DATABASE is the truth about "premium".** The webhooks write it; Conductor
  and this cohort READ it. Never a provider API directly.
- **An OG who joined on mobile is MOVED TO A STRIPE-BILLED PLAN** at the
  anniversary; that is how the free year is granted (Tre, 2026-09-02).
- **Churn:** keeps the year if premium within 30 days of the anniversary, or if
  the lapse was a billing failure rather than a choice. `unknown` QUALIFIES —
  ambiguity goes to the customer. Only deliberate-and-stayed-gone forfeits.
- **The follow badges are claim-based ON PURPOSE.** Neither platform will tell a
  consumer app whether someone followed. They gate NOTHING, and the wording says
  "Tapped through to Instagram" because that is the event actually observed.
  Do not "fix" this by wiring it to something real.
- **Both social handles are `@treforged`,** confirmed against sources (see
  `docs/og-cohort.md`), not inferred from the brand name.

## STILL UNBUILT — recorded so a year does not pass with these in a doc only

- **The anniversary job EXISTS and is deployed, but nothing fires it.** No cron
  schedule, and the Stripe grant is unwired — both are live changes waiting on
  Tre. `docs/og-cohort.md`.
- **A mobile OG CANNOT be migrated by us** — a fact about the stores, not a gap.
  Only the user can cancel a store subscription. The ask must go BY EMAIL, never
  in-app (anti-steering). Awaiting Tre. `docs/og-cohort.md`.
- **iOS widgets are unstarted**, scoped in `docs/ios-widgets-scope.md`. Do the
  entitlements/provisioning step FIRST and separately.
- **The Android widget change is unpressed.** Strictly safer than what it
  replaced, so shipping it that way was the right risk — but a device build
  should confirm it when convenient.
- **No user-facing promise copy.** It may now say the year is free. It must never
  name the billing rail — the user is promised a year, not a rail.
- **`ForgentaRedditScout` still points at the dead pre-move path.** Sam hit
  Access denied on it (registered elevated) and it is DISABLED, so it is
  harmless where it sits. The fixed `scripts/setup-scheduler.ps1` repairs it
  whenever it is next wanted.

---

## NEW 2026-09-02 — two product asks routed in by Mona (from Tre's Instagram DMs)

Neither was recorded anywhere until Mona pulled them off Instagram. Both are his
words, verbatim, and both are DESIGN-FIRST — nothing should be built until the
forks below are answered.

**A. REVIEWS, tied to the value moment.** *"research my market and create a plan to
get more reviews. part of that was the app updates which will prompt it after the
ah ha moment(value moment)."*
**IT IS ALREADY BUILT — READ THIS BEFORE PLANNING ANYTHING.** `useInAppReview.ts`
fires the native prompt on the **3rd** qualifying action, once ever, gated on
`localStorage`. The two call sites are `BudgetControl.tsx:731` (a rule saved) and
`SavingsGoals.tsx:724` (a goal created). So this is a TRIGGER-PLACEMENT job, not a
build, and Tre's ask is precisely the criticism of what is there.

✅ **ANSWERED BY TRE 2026-09-02: "first plaid link completing."** So the trigger
moves to the moment a Plaid link succeeds and real balances land — the first time
the app shows him something he did not type in himself. Do NOT ask him again.
⚠️ Note the ordering dependency this creates: native Plaid linking is CURRENTLY
BROKEN (see the Plaid section above), so on iOS this trigger cannot fire until
that is fixed. Wire it anyway — the web/Android path still reaches it — but do not
read "no review prompts on iOS" as this feature failing.

⚠️ **THE CURRENT TRIGGER IS AIMED AT A MOMENT OF WORK, NOT A MOMENT OF VALUE.**
Saving a third budget rule is data entry — the app is asking to be rated right
after making the user do chores. The aha moments in this product are where the
user first SEES something they did not already know: a payoff DATE appearing, the
CC Debt Free milestone firing, a Plaid link completing and real balances landing,
a goal completing. Any of those is defensible; the third row typed into a form is
not. Pick with evidence, not by taste, and note that both stores RATE-LIMIT the
prompt (Apple ~3/year), so a mistimed trigger is SPENT, not retried.

⚠️ **AND THERE IS A REAL DEFECT IN IT, of the silently-wasted kind.** `KEY_DONE` is
written BEFORE `InAppReview.requestReview()` is awaited, and the catch swallows
everything. So if the call throws — or the OS declines to show anything, which it
does routinely and without telling you — the user's ONE shot is already burned and
can never fire again. Some of his existing installs may have spent their prompt on
nothing. Moving the flag after a resolved call is not a complete fix either (Apple
never confirms display), but burning it before the attempt is strictly worse than
after, and the current order cannot be defended.
Also minor: keys are `tre:review:*` where the rest of the app uses the `forged:`
prefix.

**B. FIRST 100 ORGANIC PREMIUM USERS + OG PROGRAMME.** *"we need to push for our
first 100 organic premium users. they should recieve an OGs achievement as well.
after a year, they get a year free just for being an OG. this needs to be
trackable. we also need to make revenue trackable on conductor. i use revenue cat
for mobile and stripe for desktop. note stripe is the only one where i can award
free forever plans. make an acheivement for following the socials, instagram and
tiktok."*

⚠️ **THE LOAD-BEARING CONSTRAINT IS HIS OWN: Stripe is the ONLY side that can award
free-forever plans.** So "a year free after a year as an OG" CANNOT be implemented
symmetrically — a mobile OG on RevenueCat has no equivalent lever. **This is a
MONEY PATH and an entitlement that must still be honourable in twelve months**, so
the answer has to be settled BEFORE any schema lands. Do not pick it by default.
The options, none obviously right: grant the mobile OG a Stripe-side comp that
requires them to move to web billing; issue RevenueCat promotional entitlements
(time-limited, need renewing, so someone must own that in a year); or restrict the
OG offer to Stripe signups and say so up front, which is honest but caps the
programme at desktop users.

SPLIT INTO FOUR, because they estimate very differently and only one is blocked:
 B1. OG achievement + the first-100 counter (needs "organic" DEFINED — it is doing
     real work in that sentence and currently means nothing queryable).
 B2. The year-free entitlement — BLOCKED on the fork above. Money path.
 B3. Revenue tracking surfaced on Conductor — cross-desk, RevenueCat + Stripe.
 B4. Social-follow achievement (Instagram, TikTok) — ⚠️ NOT VERIFIABLE. Neither
     platform exposes "does user X follow account Y" to a third party. So this can
     only ever be self-attested or link-click-attested; say which, visibly, rather
     than shipping an achievement that silently trusts a tap.

Relates to the existing streak/achievements items already in the queue below —
these should be ONE achievements system, not two.

## Resume queue

> **A RESUME ITEM IS A POINTER, NOT A REPORT.** One or two lines and a path to where
> the detail lives. This file is injected into every session that starts at this desk,
> so every character here is a tax paid on every cold start, forever. Closed items move
> to `handoff-archive.md`. If an item needs three paragraphs, those belong in `docs/` or
> in the commit body, and the item points at them.

**STATE, 2026-09-05 ~07:30 ET.** `origin/main` 0/0, verified by CONTENTS after every push.
Eleven commits this window, `0d91028b` through the handoff. Gates green each time:
`npx tsc --noEmit`, `npm run lint` 0 errors, `npm run test:tz` all three zones
(3671 passed, 1 skipped). Brief: `TRE-Forged/OVERDRIVE-getforgenta-2026-09-05.md`.

### 1. ✅ DONE — the `btn` rollout on the dense surfaces, verified in a browser
`b269b6aa` Settings, `51ccaa1d` BankActivity, `30297595` Budget Control.
- **BankActivity:** 17 inline row actions had NO padding and NO target and measured
  **18px** — they are the Confirm / Not this / Ignore controls on bank charges, which are
  money decisions. Now 32px. 283 controls carry `btn` on that surface.
- **Budget Control:** only SEVEN of its 22 were migrated on purpose. `icon-btn`, the
  segmented toggles, the catalog chips and the accordion headers are their own
  vocabularies, and `btn` would repaint them. The six "Add …" actions took `btn` WITHOUT
  `btn-ghost`, so they keep their gold `text-primary` and hover underline.
- **Verified in Chrome on demo data:** no sideways scroll (0px), no clipped labels,
  nothing off the right edge, layout intact in a screenshot.
- ⚠️ **TWO THINGS UNVERIFIED, do not claim them.** This Chrome reports `pointer: fine`,
  so it takes `btn`'s **32px desktop branch** — it says NOTHING about the 44px touch
  value. And the CSS viewport would not go below **657px** (`resize_window` moves the OS
  window, not `innerWidth`), so a true phone width is untested. Both need a real device,
  which is coupled to item 12 and is Tre's.

**THE MEASURING PROBE, so the next session does not re-derive it.** In demo mode
(`/demo`, no credentials) run in the console: collect
`button, a[href], [role="button"], [role="tab"]`, drop zero-sized and hidden ones, and
**keep only elements that are the topmost thing at their own centre**
(`document.elementFromPoint`). That last filter is not optional — without it the count
includes everything behind a `fixed inset-0` overlay, which is how I produced "98% under
44px" before correcting it to "10 of 18 reachable, smallest 30-36px".

### 2. ✅ DONE — item 17, text wrapping. MEASURED CLEAN, nothing to fix.
Swept `/transactions`, `/debt`, `/forecast`, `/vehicles`, `/settings`, `/dashboard` for
leaf elements whose `scrollWidth > clientWidth`. **Zero genuinely clipped strings.**
- ⚠️ The two apparent hits were `sr-only` spans — 1px wide with `overflow: hidden` BY
  DESIGN. A raw `scrollWidth > clientWidth` check flags accessibility markup as a bug, so
  **check `overflow-x` before calling anything clipped**; with `overflow: visible` the
  text spills and is perfectly readable.
- Same 657px caveat as item 1. If a real device ever shows wrapping trouble, re-run the
  sweep there rather than re-reading the CSS.

### 3. ✅ MOSTLY DONE — ONBOARDING and the review prompt. READ THIS BEFORE REBUILDING.
Two of the three halves were ALREADY SHIPPED before this session, and a cold session that
skips this paragraph will rebuild them:
- **The review prompt already fires on the VALUE MOMENT, not on activity.**
  `src/lib/review-moment.ts` replaced a "third positive action" counter (whose two call
  sites were the user doing WORK FOR the app) with real value events, including
  `first_positive_projection` — the "oh, I am actually fine" moment. Wired through
  `useValueMoments` on the Dashboard. **That IS the ah-ha trigger Tre asked for.**
- **Onboarding already ends on a real outcome**, not a tour: take-home, expenses, debt,
  goals and available-after-expenses, computed from what the user just entered.
- **The measurement gap is now CLOSED** (`821dc985`): `profiles.onboarding_furthest_step`
  + `onboarding_started_at`, monotonic, compared inside the user's own flow. The funnel is
  `select onboarding_furthest_step, count(*) from profiles where onboarding_started_at is
  not null and not onboarding_completed group by 1;`
- **What is genuinely left** is a PRODUCT judgement, not code: read that funnel once real
  users are in it and decide which step to cut. Do not guess before the data exists.
- Still open from the same ask and NOT started: "research my market and create a plan to
  get more reviews" — that is marketing research, likely Ruby's, not this repo's.

### (superseded) Item 7 — ONBOARDING, and the review prompt WITH it (Sam, 2026-09-05)
"Onboarding = value, not explain every feature." The **ah-ha moment is the trigger for
both** the first real outcome and the in-app review prompt, so build them together
rather than twice. A review prompt fired before the value moment burns the one chance
at a rating, so **the prompt's timing is the deliverable, not the dialog**. Conversion
is the metric, so whatever ships must be measurable against it.
`src/lib/review-moment.ts` and `useInAppReview` already exist — READ THEM FIRST.

### 4. ✅ MOSTLY DONE — the OG cohort. ⚠️ ONE DECISION IS TRE'S AND IT REFRAMES HIS ASK.
`e9c4bd8c`. Read this before touching anything OG-shaped.

**THE STREAK GRANT DOES NOT REUSE HERE, and it looked like it would.** The streak comp
goes to somebody who is NOT paying. The OG free year goes to somebody who IS. Writing a
comped `user_subscriptions` row over an active paid subscription would erase their real
subscription state AND not stop Stripe charging them — recording as free a person still
being billed. The free year genuinely needs a Stripe-side 100% discount so the CHARGE
stops, which is a real action on Tre's live account and **his to authorise**.

**⚠️ FOR TRE, AND IT CHANGES HIS OWN ASK: the "first 100 organic premium users" push
starts from ZERO, not five.** `claim_og_place()` tested organic as "has a
stripe_subscription_id or a revenuecat_app_user_id" — the exact heuristic
`20260905_subscriptions_is_comp.sql` disproved hours earlier, since a 100%-discount
subscription carries a real id. So the seat test admitted precisely the accounts the
cohort excludes, and **all 5 current `og_members` carry `is_comp = true`**. Fixed for
FUTURE seats; the 5 existing rows are deliberately untouched, because they were
backfilled on his direct instruction and removing somebody from a cohort is his call.
`select * from public.og_cohort_integrity();` reports it: members / comped_members /
seats_left / earliest_reward_due / rewards_due_now.

**NOTHING IS DUE UNTIL 2027-03-26**, so wiring the Stripe grant is not urgent and should
not be done speculatively against a live payment provider.

**The social-follow badge is COSMETIC and it is PROVEN, not chosen.** A user holding
`follow_instagram` + `follow_tiktok` and no lessons has `streak_days_for() = 0` and
`claim_streak_reward()` refuses. Keep it that way: those ids are client-mintable.

**Still genuinely unbuilt:** moving a live RevenueCat subscriber to Stripe without losing
access mid-switch. `docs/og-cohort.md` says so and it is still true.

### 5. ✅ DONE 2026-09-05 — the i18n scaffold plus Spanish on Landing. `c9643e6c`.
`f21d4d00` did the international plan's own STEP 1 first: **the currency picker now changes
the numbers.** `setMoneyDisplay()` had existed in `calculations.ts` — exported, documented,
with `getMoneyDisplay`/`resetMoneyDisplay` beside it — and NOTHING outside the tests had
ever called it, so all 446 `formatCurrency` sites printed USD whatever the profile said.
Shipping Spanish on top of that would have added a second language to the same wrong number.
- **Shipped:** `i18next` + `react-i18next`, `src/lib/i18n.ts`, catalogues at
  `src/locales/<lang>/<namespace>.json`, a `LanguageSwitcher` on the SIGNED-OUT Landing page
  and in Settings, and the `landing` namespace complete in Spanish (47 keys, including the
  store-badge `aria-label`s and `alt` texts a JSX-only pass misses).
  Gates: `test:tz` 3709 passed in all three zones, `tsc` clean, lint 0 errors. Nine new tests
  PRESS the switcher and were mutation-checked (3 go red when `changeLanguage` is neutered).
  Verified in Chrome, not only jsdom: `<html lang>` flips, the choice survives a reload, the
  footer year interpolates, horizontal overflow 0px.
- **Also in that commit: the currency picker is RE-ENABLED**, on the condition its own
  2026-09-03 disable note set — `f21d4d00` had already connected `MoneyDisplaySync` and the
  control was still off two commits later.
- ⚠️ **Arabic/RTL is the NEXT i18n slice and is still separate.** `dir` is set on `<html>` and
  `SUPPORTED_LANGUAGES` carries a `dir` field, so the plumbing exists — the work is mirroring
  the layout. Do not start it at the tail of a window.
- ⚠️ **A surface is all-or-nothing.** A half-translated screen is worse than an English one, so
  the next surface is a new namespace file per locale; nothing in `i18n.ts` changes.
- ⚠️ **A font-size class on ANY select in this app is inert.** `index.css:845` forces
  `font-size: 16px !important` on every input, textarea and select, because anything smaller
  makes iOS Safari zoom the page on focus.
- The 32 `toLocaleDateString` sites are NOT a blocker: they pass textual options, so they
  render `Sep 2026` — unambiguous everywhere, just English month names. The plan's own
  correction says so; do not re-derive it.

### 6. ✅ DONE — item 18, the reel. Audit in `docs/mobile-ux-rules-audit.md`.
`b8628837`. Read with `yt-dlp --skip-download --dump-json` — metadata only, nothing
downloaded, installed or run.
- **Built:** rule 9, tapping the active tab returns to top. ⚠️ The scroller is `#scroll-main`,
  NOT the window — a fix aimed at `window` looks right and is inert.
- **⚠️ The real finding, PROPOSED NOT BUILT — rule 13.** `registerForPush()` fires from
  `AuthContext` ON SIGN-IN, so the OS notification prompt appears before the user has seen
  anything worth being notified about. On iOS that prompt is a ONE-SHOT resource, exactly as
  `review-moment.ts` documents for reviews. Move it behind the first notification-shaped
  intent; keep the sign-in path only where `checkPermissions` already returns granted. Its
  own slice, because it changes a permission flow.
- **REJECTED on purpose:** rule 11, "update immediately then sync". Right for a like, wrong
  for money — an optimistic balance that fails to write shows a false number. Do not "fix"
  the current behaviour.
- Still open: rule 14 (sheets do not dismiss on swipe-down; they DO on backdrop and X).

### ✅ RULE 8, SCROLL RESTORATION — SHIPPED 2026-09-05, `0982aa18`. Verified in a browser.
The four measured constraints below were all correct and all insufficient. **The fifth was one grep
away: `App.tsx` mounted a `ScrollToTop` that ran `scrollTo(0,0)` on EVERY pathname change, POP
included**, so the restore was racing an explicit scroll-to-top on the same element in the same
commit. Nothing in the original hook was wrong. `ScrollToTop` now skips POP.
Two more found only by measuring: **the live `scrollTop` read inside the cleanup is ALREADY STALE**
(the person was at 800, the cleanup read 10, because the outgoing content shrinks and the browser
clamps first — 10 is non-zero, plausible and wrong, so the save takes `max(live, lastGesture)`);
and **`requestAnimationFrame` does not fire in a hidden tab**, so an rAF-only retry schedules itself
and does nothing, indistinguishable from working.
⚠️ **A THIRD TARGET FOR THE CALLER GREP: a SECOND WRITER to the same object.** Not code with no
caller, not a document with no code — two things writing the same DOM property.
The historical detail below is kept because its four facts are still true.

<details><summary>The original attempt, reverted — its four facts still hold</summary>

Written, 8 tests green, **and it did not work in the browser three times running.** Reverted
rather than pushed, because a feature nobody has seen work is the thing this desk keeps
finding in other people's code. The WIP is at
`…/scratchpad/scroll-restoration-wip/` (session 94435eb0); it is a starting point, NOT a
working thing.

**What is already established, so nobody re-derives it:**
- ✅ The scroller is `#scroll-main` (`DashboardLayout`), NOT the window. `main` carries
  `overflow-y-auto`, so `window.scrollY` is permanently 0.
- ✅ Navigation type detection WORKS. Verified in the console: REPLACE on landing, PUSH on a
  tap through, **POP on `history.back()`** — restore only on POP is correct and it fires.
- ✅ **`scrollTop` CLAMPS SILENTLY.** Assign 400 to a container still 600px tall because its
  data has not arrived and you get 0, no error. The Dashboard only reaches `scrollHeight`
  2517 once its queries resolve, so restoring after N frames is wrong — wait for the
  CONDITION (`scrollHeight - clientHeight >= saved`) with a deadline.
- ✅ **A PROGRAMMATIC `scrollTop` ASSIGNMENT FIRES NO `scroll` EVENT.** Measured: 0 events for
  an assignment the element accepted and read back as 400. So a saved offset tracked from a
  scroll listener misses every non-gesture move. Read `el.scrollTop` in the effect CLEANUP
  instead — no listener, nothing to miss.
- ❌ **STILL UNEXPLAINED:** with all of the above fixed, the offset still comes back 0 after a
  POP. Next step is to log inside the cleanup and confirm whether `el` there is still the
  mounted scroller, and whether `DashboardLayout` remounts across the navigation.
- ⚠️ **The jsdom harness cannot see any of this** — `scrollHeight`/`clientHeight` are 0 and
  `scrollTop` does not clamp, so tests pass against all four failures above. The WIP test file
  models height and clamping deliberately; keep that.

</details>

### 7. Housekeeping that is now DONE — do not redo
- ✅ The `handoff_hook` auto-snapshot bug is FIXED. It was appending a block per run:
  SEVEN had accumulated, 6 BEGIN markers against 7 ENDs, because the oldest had lost its
  BEGIN and `split(END, 1)[1]` then carried every later block back in. Proved on a copy
  of the real 82 KB file: 7 blocks to 1, idempotent over three runs, prose byte-identical.
- ✅ 14 CLOSED sections moved to `handoff-archive.md`.
- ✅ The `toISOString()` sweep is COMPLETE. Every client date-write already uses
  `toLocalDateStr`; the two remaining sites (`reddit-scout`'s cron run date,
  `_shared/learn-streak.ts`'s `addDaysKey`) are correct BY DESIGN and documented as such.
  **Do not "fix" them.**
- ⚠️ `.vercelignore` is still UNTRACKED ON PURPOSE. Committing it changes what
  git-integrated PRODUCTION builds see and no gate has been run on that. It is not junk.
  `.claude/settings.json.bak-deadpath-20260903`, `deno.lock` and
  `.github/workflows/handoff.md` are also untracked and each needs a deliberate decision.

### 7b. ⚠️ TWO STANDING HAZARDS on this database — check these every time
- **`user_subscriptions` has NO FOREIGN KEY to `auth.users`.** Deleting a user leaves the
  subscription row behind, and an orphan reads as REVENUE in
  `revenue_summary_lines()`. I stranded one this morning with a probe. So: after ANY
  probe that writes a subscription, re-run `select * from public.revenue_summary_lines();`
  and confirm it is byte-identical to before. This is a standing hazard, not a one-off.
- **A trigger's `UPDATE OF <columns>` list is a separate object from its function.** The
  OG seat fix was a silent no-op until `is_comp` was added to
  `user_subscriptions_claim_og`'s column list — the function body was right and the thing
  deciding WHEN it runs was elsewhere. When a trigger function starts reading a new
  column, change the trigger too, and prove it by writing that column alone.

### ⬜ THE SIGNED-IN VERIFICATION PASS — `docs/signed-in-verification-pass.md`
Four checks, in press order, that CANNOT be done from demo or signed out: BankActivity's
"Link and correct $X → $Y" (money — do it first), `GoalLumpSumPanel`'s auto-extra guard, the
identity badge in partner view, and back-from-a-deep-link. Written 2026-09-06 because three slices
shipped that day unverified for the same reason. ⚠️ Record results BY NAME, and write "not
reachable" rather than "passed" for anything that could not be run.

### ⛔ THE FOUNDER BADGE CLAIMED A PAYMENT NOBODY MADE. Wording fixed; THE DATA IS TRE'S CALL.
Measured 2026-09-06: **3 live accounts hold `og_founder`, all minted in the SAME INSTANT on
2026-09-03 20:24:25** — a backfill, not three organic events — and **none has a non-comp
subscription**. **`og_members` holds 0 rows**: the 2026-09-05 "OG place requires real money"
tightening emptied it correctly (a 100%-off subscription is not a purchase) and the badges were
left behind. The Trophy Case shipped that day was therefore telling three real people *"One of the
first hundred people to PAY for Forgenta"*, which its own database contradicts.
Wording now claims nothing about payment. ✅ **SETTLED BY TRE, 2026-09-06 (via Sam): KEEP THE BADGE, DO NOT
BACKFILL `og_members`.** Do not re-open it — `og_members` reading 0 is correct and is not evidence
against the badge now that the description claims nothing about payment.
⚠️ **AND THE WHOLE OG MACHINERY HAS NOTHING TO ACT ON.** `og_members` 0, `og_billing_consent` 0,
`og_consent_tokens` 0, `og_anniversary_runs` **0 — it has never run**. Turning the consent cron on
today would email nobody. The queue item "OG surfaces not built" is stale: the gate, the web
confirmation page and the email are all built; what is missing is members.

### ✅ STALE QUEUE LINE CORRECTED: `useLumpSumTransfers` was ALREADY REMOVED on 2026-09-05,
with a tombstone at `useSupabaseData.ts:510` explaining why (0 rows, 0 users, no writer, no
reader). The table is kept deliberately — empty makes keeping it free and dropping it permanent.
Nothing to do here.

### ✅ RECONCILIATION IS WIRED — and the MATCHING half was already built. NOT browser-verified.
⚠️ `transaction-reconciliation.ts` had **zero callers** — my own work failing this repo's own
caller-grep gate. Wiring it found the more important thing: **`bank-activity-queue.ts` has paired
bank charges to hand-typed ledger rows for ages** (the `ledgerTxn` suggestion). What was missing was
never the match. Accepting one writes only a POINTER (`status: 'linked_txn'`), so **the typed figure
survives untouched — $50 typed, $52.30 charged, rows linked, ledger keeps $50 for ever.**
Now: `describeReconciliation` (extracted so the screen and the matcher cannot disagree about the
same two numbers) surfaces the gap, the row's button reads **"Link and correct $50.00 → $52.30"**
showing BOTH figures before the press, and accepting also patches the ledger row.
⚠️ **"Accept all suggested" now EXCLUDES discrepant rows** — `isBulkAcceptable`. Its stated
invariant is that it *cannot create money*, and linking in bulk without correcting would leave the
wrong figure under a button the person believes settled it. Tested and mutation-checked.
⚠️ **NOT VERIFIED IN A BROWSER, AND THIS IS A MONEY SURFACE.** `BankActivity` does not mount in
demo (no synced charges), and the sign-in is gone. The page was confirmed to render with **no
runtime errors and no error boundary**, but the new control was never seen. **First thing to check
when the sign-in is back.**

### ✅ LUMP-SUM AUTO-EXTRA GUARD — THE TEST WAS ALREADY GREEN AND HONEST; THE GAP WAS A SURFACE.
⚠️ **The handoff said "test written, guard not built". Both halves were wrong.**
`forecast-engine.lumpSumDoubleCount.test.ts` passes 5/5 and is mutation-checked, and it MEASURED
that Tre's stated reason does not hold: with auto-extra on, a lump sum drops auto-extra by exactly
its own amount and **ending cash is unchanged to the cent**. There is no double-count. The rule is
kept for the reason he did not give — with the sweep on, the control is **inert**, which is the
"control that lies" shape from the other direction.
**The real gap was that only ONE of the two lump-sum panels had the guard.** `LumpSumPanel`
(vehicles) had it and both callers passed it; `GoalLumpSumPanel` on the Savings Goals page did not,
and that page did not mention `auto_extra` anywhere. Now shared through `src/lib/lump-sum-guard.ts`
so the two surfaces cannot describe the same rule differently.
⚠️ **NOT verified in a live browser**: `GoalLumpSumPanel` renders only when `!isDemo`, and this
desk's sign-in is gone. jsdom is legitimate here (a `disabled` attribute, no geometry) but it is
not the app. ⚠️ **And the test renders the component directly, so it CANNOT catch the call site
dropping the prop** — that wiring is verified by a deliberate-typo tsc probe and by reading only.

### ✅ NAV ITEM 3 — BACK ON PUSHED SCREENS, SHIPPED `b43e1bb1`. One case NOT browser-verified.
`BackButton.tsx`, `src/lib/nav-back.ts`, `src/lib/nav-routes.ts`. Pressed at 390px:
`/dashboard` IDENTITY (idx 0) → Settings BACK 44×44 at left=9 (idx 1) → press → `/dashboard`
IDENTITY (idx 0). **Back REPLACES the identity badge because the gap between the badge (ends x=90)
and the centred wordmark (starts x=110) is 19px** — measured, not chosen. ⚠️ **The fresh-entry
fallback is NOT browser-verified**: loading `/settings` directly while signed out redirects to
`/auth`. Mutation-verified unit tests only.

### ⚠️ THE DEV SIGN-IN WENT AWAY AT ~21:42 ON 2026-09-05, MID-SESSION.
`localStorage` lost its `sb-*-auth-token` between a successful measurement at 21:29 and the next at
21:42; the tab is now on `/auth`. Cause unknown — do NOT blame the measuring iframe without
evidence. **`/demo` needs no credentials and renders the same chrome**, which is how nav item 3 was
verified, so this only blocks checks that need Tre's REAL data. `dev-signin` skill: sign-in is
manual once, in the Claude-controlled Chrome, at `http://localhost:8080` and no other origin.

### ⛔ THE FUNNEL: THE PAYMENT STEP IS NOT WHERE IT FAILS. READ BEFORE ANY PRICING WORK.
`docs/checkout-funnel-2026-09-06.md` (`ad408802`). 31 signed up → 12 set an income → 4 recorded a
transaction → **2 linked a bank** → 5 external people ever opened a checkout → 3 ever saw $89.99
→ **0 ever paid it**. 39 sessions in all history, **31 of them Tre's own two emails**; last one
**2026-05-18**, and 11 people have signed up since without opening one. **Bank linking is
premium-gated (`plaid-create-link-token/index.ts:83`), so 29 of 31 have been asked to pay $89.99
for a feature they have never seen work, with no trial to see it with.** Checkout itself is NOT
broken — 8 sessions completed through the same code. ⚠️ Do not quote
`onboarding_completed` (a FLOOR, two completion stores). ⚠️ **CORRECTION:** I first wrote that
`onboarding_started_at` / `onboarding_furthest_step` are "written by nothing" — FALSE.
`recordFurthestStep` (`Onboarding.tsx:98`) writes both and shipped 2026-09-05 in `821dc985`; the
columns are empty because there have been NO SIGNUPS since. I made that error by piping a
multi-pattern grep through `head -20`, where `onboarding_completed`'s 30 hits hid the other two. ⚠️ `profiles` has 49 rows for 31 users — 18 are
orphans with no `auth.users` row, so it is never a headcount. **Commission programme SHELVED by
Sam on this evidence.**

### ✅ `profiles.is_premium` — A DEAD COLUMN, NOT A COMPETING TRUTH. FIXED, `d785fbfe`.
`user_subscriptions` is authoritative (`SubscriptionContext.tsx:56`). **Nothing reads or writes
`profiles.is_premium`** — checked across `src/`, `supabase/`, `pg_policies`, `pg_proc`, `pg_views`.
Backfilled (2 rows), commented as derived/deprecated, and the migration asserts itself. NOT
dropped: irreversible, and a person's call. Undo is in the migration header.

### ✅ IDENTITY AFFORDANCE — nav item 1, SHIPPED `dfb058ce`, one half of acceptance UNMET
`IdentityBadge.tsx` + `src/lib/identity-badge.ts`. Measured 70×44 at left=9, 390px, real account.
⚠️ **The partner-view frame was never obtained** — no partner is linked to Tre's account, so that
state is unreachable on real data. Unit tests cover it (the unnamed-partner case is
mutation-verified); a unit test is not a rendered frame. Do not record it as visually verified.

### ⛔ COMMISSION PROGRAMME — STAGE 1 DONE, AND IT STOPS STAGE 2's PREMISE
`docs/commission-stage-1-numbers.md` (2026-09-06). **Lifetime gross revenue is $4.99 and it is
Tre's own card** — one charge ever, 0 refunds, 0 disputes. All 8 live subscriptions redeem the
100%-off-forever coupon `8G9evoSQ` (`times_redeemed: 8`). Prices are $9.99/mo and $89.99/yr;
**`subscription_tiers` says $9/$90 and is stale — do not quote it.** There is no web trial, so
"trial-to-paid" has no funnel. ⚠️ `is_comp` and `purchase_provider` are COLUMN DEFAULTS on all
11 rows — never read them as facts. Stage 2 was not started: a percentage payout is currently a
percentage of zero, and that is Sam's call to make before design work continues.

### 8. Still open from earlier, unchanged
- Chase Pay Over Time modelled as free (section above) — money surface, not started.
- Push notification SENDER (section above) — storage half built.
- Multi-currency — PARKED deliberately, decision made, do not re-argue.
- The cash-floor warning slice (section above) — scoped and ready.

### BLOCKED ON TRE'S OWN HANDS — do not burn time rediscovering
Plaid iOS TestFlight tap + 24h log read; the auto-dedupe re-link proof; item 11
distribution (staging is NOT blocked, only the submit click); item 12 iPhone testing;
item 4 fixture recapture (needs a mid-month day, the 10th-20th); item 23(a) iOS
WidgetKit (coupled to item 12; Android widgets already exist).

### LESSON FROM THIS WINDOW, and it generalises
**A hole is worth what the NEXT feature makes it worth.** `achievements.earned_at` was
client-supplied and worth nothing until the streak started paying Premium — then it was
a free month. Written up in `docs/og-cohort.md`. Two companions: a correct error handler
is not evidence the constraint exists (the 23505 branch had never fired because no unique
index existed), and a policy must be tested AS THE ROLE THAT WOULD ATTACK IT — the first
probe ran as `postgres` and proved nothing, because a SECURITY DEFINER trigger had made
`current_user` the function owner.



## 2026-09-13 — THE BROWSER WALK RAN. Appended by Ada [63da04]; nothing above was edited.

Three Ada sessions were live on this tree when this was written, so this is an APPEND. Sam
stood this session down mid-walk; everything below is committed and pushed.

**The Chrome extension is connected again**, so `d235eb39`'s old blocker is gone. Dev server
up on 8080, reviewer verified in first-run state by query (`profiles.user_id =
d3550fa8…`, `onboarding_completed=false`, `founder_note_seen=false`).

⚠️ **THE CLAUDE CHROME IS SIGNED IN AS `tre@treforged.com` — HIS REAL FINANCIAL DATA.** Not
the reviewer. No write control was pressed anywhere in this session for that reason. The walk
ran on `/demo`, which is credential-free.

### ✅ `aaeee75b` — a refresh dropped you out of the demo and into your real accounts
`isDemo` was a plain `useState`. A reload ended the demo silently, and because `/demo`
redirects to `/dashboard` the URL could not get back to it. For a signed-in visitor the same
layout and headings came back carrying **real balances**, with the DEMO banner and its "Back
to my account" exit both gone. Nothing threw.
Now sessionStorage — which is exactly the lifetime the banner already promises ("resets when
you close the tab"), so it makes existing copy true rather than changing it. Proven red by
mutation, restored byte-exactly (sha256). `test:tz` green all three zones, **4299 passed, 1
skipped**. Verified live in Chrome after the fix, at +4.4s, not only at +0.4s.

⚠️ **NAMED RESIDUE, do not report the demo as fully sealed.** `AuthContext.tsx:311` calls
`setIsDemo(false)` on the `SIGNED_IN` event. That is CORRECT on a real sign-in. I observed the
demo clear once mid-session with no user action — consistent with Supabase re-emitting
`SIGNED_IN` — and **could not reproduce it on demand** across repeated reloads and
navigations afterwards. Recorded as unknown rather than explained away.

### What the walk PROVED, and what it did not
| Checked | Result |
|---|---|
| Dashboard Overview / Goals / Accounts | **Pass.** Panel body changes, not just the pill — hashes `953198664` / `-911732157` / `2067698804`, distinct headings each. |
| Four legal routes share one component | **Pass.** 10481 / 7117 / 1407 / 6263 chars, four distinct hashes. |
| Payoff figure on two surfaces | **Pass.** `/dashboard` and `/debt` both read "Not within 5 years" on the same data. The 2026-09-08 defect does not recur. |
| **NOT walked** | first-run/onboarding (needs the reviewer signed in), every Settings toggle + reload survival, filter/range controls on `/transactions` `/forecast` `/goals` `/vehicles`. |

⚠️ **A near-miss worth keeping.** The first press at the Overview/Goals pills landed at the
wrong `y` — the page had scrolled since the screenshot — and Overview stayed active. The
fingerprint was correctly unchanged, and reporting it then would have been a **false finding
of the exact forged-glass shape**. Assert the control actually took the press before believing
an unchanged panel. Coordinates from a screenshot go stale; read the box.

### NEW, filed as `52634982` — the demo shop window contradicts itself
`Dashboard.tsx:1710` tells the reader "26 y/o with $12,700 in CC debt … a plan that clears the
cards in a little over a year. **Every number here is live-calculated from the data below.**"
On that same screen the live tiles read **CC DEBT $6,482** and the payoff headline reads **Not
within 5 years**. `$12,700` is the RETIREMENT tile's value.
**The sentence inviting trust in the numbers is the one carrying two stale hardcoded ones.**
Fix by DERIVING both from demo data at render — `accountSummary.ccDebt` and `heroState` are
already in scope — because correcting the strings re-breaks the next time demo data changes.



</details>

<!-- AUTO-SNAPSHOT:BEGIN - machine-written, replaced each compaction -->
## Auto-snapshot

_Written 2026-09-16 17:55 by handoff_hook. Everything below this heading is
machine-generated and replaced each time; put durable notes above it._

- **Branch:** `main`
- **vs upstream:** 0 ahead, 0 behind

- **Uncommitted (1 file(s)):**

```
?? scripts/handoff.md
```

- **Recent commits:**

```
5a81805b [design]: check:topright measures twice and requires agreement - the red control could not catch flakiness
dcb9caa7 [design]: check:topright - an inventory of every tab's empty top-right, and it is proven red
c677524c [handoff]: two more probe faults fixed; the last one is in the metric, and I had asserted it was not
abca93c0 [handoff]: probe faults 6 and 7 fixed; the last one is in the PLANT, not the metric
cbd650fb [handoff]: probe faults 4 and 5 fixed, 18/18 headers found - and headerPx is now saturated
bcf33fbf [handoff]: probe fault 3 fixed, and fixing it exposed two more
92634296 [handoff]: the blank-space probe is parked, not shipped - it is still lying
219e6faa [handoff]: item 0 shipped; the iOS push diagnosis on file is refuted by the build running the fix
```

<!-- AUTO-SNAPSHOT:END -->
