# Release 10-09: quick add + dialog reach

Branch `claude/release-10-09`, cut from `origin/main` at `1672be3f`. It holds:

- **claude/dialog-reach-e1b0fffc** (head `df631b75`): dialog fixes, and "I bought it" starts the loan today. See handoff R-NOW41.
- **claude/quick-add-661548f5**, merged only through `311cb580`, plus `fbef371d`. Quick add is free on web, and the native app keeps the Premium gate. See handoff R-NOW42.
  - ⚠️ Do not merge `claude/quick-add-661548f5` itself. Its head `8bc548e6` has the same code but carries a `Release-Note:` that names web pricing. That note would be published to the App Store listing.

## Green in the cloud (2026-10-09)

- `npm run test:tz`: UTC, New York and Tokyo, 6,387 passed in each.
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors.
- `npm run check:quick-add`: 5 presses at 320x568, 375x667, 390x844 and 1440x900.
- `npm run check:dialog-reach`: 7 dialogs x 3 viewports.
- `npm run check:narrow-overflow`: 0 cut at 320, at 320 with 150% text, and at 390. With `DIALOGS=1` at 320, it pressed 323 buttons and opened 149 dialogs (36 distinct), with 0 cut. The quick-add sheet was measured on all 9 routes.

## Left for the PC

The cloud has no walk-account credentials, so three checks need Tre's machine. Run them in Tre's local session (bash) from the repo root. The machine needs the usual `.env.local` and `.env.deck-walk.local`. The checks sign in as the `@forgenta.test` walk account (`REACH_TEST_EMAIL` / `REACH_TEST_PASSWORD`), and none of them writes to the database.

```bash
git fetch origin
git checkout claude/release-10-09
git pull --ff-only
npm ci

# terminal 1: the dev server (port 8080), left running
npm run dev

# terminal 2: the three PC-only checks, ONE AT A TIME (two browsers at once has been killed for memory)
npm run walk:press
npm run check:nav
SIGNED_IN=1 npm run check:quick-add
```

### What passing looks like

| Check | Pass condition |
| --- | --- |
| `walk:press` | PASS with **0 no-change** and **0 not-found**. |
| `check:nav` | Exit 0. |
| `SIGNED_IN=1 check:quick-add` | `PASS (signed in, insert answered in-browser)` with ≤ 5 presses, and an `insert:` line showing `"type":"expense"`, `"amount":36`, `"category":"Groceries"`. |

Notes on each:

- **`walk:press`**: `enumerated` and `pressed` should each be **higher** than the last run (401 / 164 / 164). The new `+` is one more top-layer control on every phone route. A drop is a finding.
- **`check:nav`**: the bar now has a sixth cell (the `+` button, not a link). This is the first signed-in run of the bar with it.
- **`SIGNED_IN=1 check:quick-add`**: the insert is answered inside the browser (status 201) and never reaches Supabase. The walk account is a free web account, so this pass also proves quick add is free on web.

If any check exits 1, stop and do not merge. Exit 2 means the check could not run (missing env, or a page that never settled). Fix the setup and re-run it.

## Then ship

This deploys the web app through Vercel:

```bash
git checkout main && git merge --ff-only claude/release-10-09 && git push
```

`git merge --ff-only` refuses if `origin/main` has moved since `1672be3f`. In that case, re-run the checks on a refreshed branch rather than forcing it.

To get it onto Tre's phone, a push is not enough. Dispatch iOS and read the upload step, per CLAUDE.md:

```bash
gh workflow run "iOS Build & Upload to App Store" --ref main
gh run list --workflow "iOS Build & Upload to App Store" -L 1
gh run view <id> --json jobs   # "Upload to App Store Connect" must be success, not skipped
```

Once it has shipped, the branches `claude/quick-add-661548f5`, `ada/quick-add-661548f5` and `claude/dialog-reach-e1b0fffc` can be deleted.
