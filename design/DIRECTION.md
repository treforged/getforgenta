# Forgenta Design Direction — "The Build Thread"

> Tre, 2026-08-14: "clean up the design to make it more user friendly. simpler —
> slide by slide ui per item. overall design needs to be a lot cleaner and look a
> lot more innovative. the main target is 18-26 car enthusiasts who want to grow
> their wealth and manage debt."
>
> This file is the contract. Build sessions implement it; they do not re-decide it.

## Who this is for, in their own words

The marketing research (`marketing/research/FINDINGS.md`, 271 unique posts) says the
audience already thinks in **build threads**: mods documented one part at a time,
receipts attached, before/after shots, a number on everything. 43% raise insurance
costs unprompted; they are anxious about recurring costs, not spreadsheet-averse.
They live on phones, they trust receipts over claims, and they respect anything
that shows real numbers without flinching.

So the design metaphor is not "a bank app with dark mode." It is **a build thread
for your money**: one item at a time, a number on everything, progress you can
scroll back through and show someone.

## The three rules

1. **One decision per screen.** Anywhere the app asks the user to decide N things,
   the default surface is a full-screen card deck — one item, one question, big
   targets, next card slides in. Lists remain as the "browse" fallback, never the
   default for deciding. (This is the slide-by-slide ask, and it is a PATTERN, not
   one feature.)
2. **A number is the hero or it isn't shown.** Every screen leads with the one
   figure that matters (payoff date, interest this month, cash above floor) in
   `font-display` at hero scale. Supporting numbers demote to a single row of
   stat chips. Tables live behind a tap ("show the receipts").
3. **Never a confident zero** (house rule, restated for design): an empty state
   says what's missing and offers the one action that fills it. A gauge that
   failed to read renders as absent, not as 0.

## Visual language (sharpen, don't replace)

The palette and type are already right — obsidian/graphite ground, gold accent,
Outfit display. What changes is discipline:

- **Gold is for money-in-motion and primary actions only.** No decorative gold.
  If everything glows, nothing does.
- **One card style.** `card-forged` everywhere; kill ad-hoc borders/shadows.
  Radius from `--radius`, no per-component overrides.
- **Type scale**: hero number (`text-5xl font-display`), section label
  (`text-xs uppercase tracking-wider text-muted-foreground` — already the house
  style), body. Nothing between.
- **Motion**: slide + spring on deck transitions (framer-motion is already a
  dependency); 150–250ms; respects `prefers-reduced-motion`. Motion communicates
  "next item," never decoration.
- **Density**: mobile-first at 390px. A screen holds ONE primary thing. The
  Forecast/Debt data tables stay, but behind "receipts" disclosure, not as the
  landing view.

## The flagship: Decision Deck (build first)

Replaces the review queue's default surface. Feeds from the existing
`buildReviewQueue` — no new data logic.

- Full-screen overlay, one charge per card: merchant (large), amount, date,
  account chip, and ONE question. Suggestion-carrying charges lead the deck
  (same ordering the queue already computes).
- Actions, in thumb reach: **Accept suggestion** (gold, when one exists) ·
  category chip row (his taught categories first, from merchant memory) ·
  **Skip** · **Ignore**. Swipe right = accept/confirm, left = skip. Keyboard:
  ←/→/1-9 for chips.
- Progress: "12 of 50" + a thin gold bar. Ending screen: what was decided,
  one-press Undo-all (reuses the merchant-memory pass idiom).
- Every write goes through the exact handlers Bank Activity already uses —
  the deck is a VIEW over the queue, never a second decision engine.

## Cleanup order after the deck (one slice each)

1. **Dashboard** → hero: months-to-debt-free + cash above floor; everything else
   demotes to chips/cards.
2. **Debt** → hero: total interest/mo now vs. at plan; per-card cards with the
   marginal rate badge (the engine already computes it); avalanche order shown
   as a numbered build list.
3. **Onboarding** (pairs with the handoff's rules-from-history slice) → the
   "we found these patterns" screen IS a deck: one proposed rule per card,
   accept/skip, done in under a minute.
4. **Forecast** → hero: next milestone month; monthly table becomes "receipts".

## What does NOT change

- The engines, the queue logic, the copy's honesty (confirm-never-silent,
  undo-everything). Design wraps them; it does not touch them.
- Demo mode stays `is_premium: true` and must look outstanding in the deck —
  it is the sales surface.
