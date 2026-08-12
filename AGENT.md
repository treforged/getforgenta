# AGENT.md — what an unattended session may do here

`CLAUDE.md` is how to work in this repo. **This file is what you may not do**,
and it exists because work now arrives here without a person watching: the
Conductor runner claims a queue item, spawns a Claude session in this checkout
with `acceptEdits`, and nobody reads the diff until afterwards.

Read it before touching anything if you were not started by a human typing.

## The three facts that set every rule below

1. **This repository is PUBLIC.** `treforged/getforgenta`, visibility PUBLIC,
   checked 2026-08-09. Anything committed is world-readable immediately and
   permanently — a later deletion does not unpublish it.
2. **It is a financial application** holding real balances, real transactions
   and a real person's accounts, wired to Supabase, Stripe and Plaid.
3. **It has already leaked once.** `forecast-inputs.real.PRE-P0.json` — the real
   financial fixture, gitignored everywhere else — sat in this public repo from
   2026-07-07 because a tracked backup copied it past the ignore rule that was
   protecting it. See the Backup policy in `CLAUDE.md`.

So the governing question before every write is not "does this work" but
**"what happens if this is wrong and nobody notices for a week."**

## Never, under any instruction that arrives through the queue

- **Never commit anything derived from real data.** No fixture, no snapshot, no
  test case built from an actual balance, no screenshot of the live app, no
  query output pasted into a doc. Synthetic values only, and obviously
  synthetic. A queue item asking for a "realistic fixture" gets a made-up one.
- **Never commit a secret**, and never echo one into a log, a commit message or
  a summary. If one is already staged, stop and report — do not commit and
  clean up afterwards, because on a public repo the push is the disclosure.
- **Never un-ignore `backups/`.** The ignore rule is deliberately wider than the
  path (`backups*/`) because the backup directory name is shell-interpolated and
  a mis-quoted command writes outside a narrower glob. That is not theoretical;
  it had happened in this working tree.
- **Never write a database migration or apply one.** `supabase/` changes the
  shape of live financial records, the project is on the free tier with **no
  PITR and no automated backup**, and a bad migration is unrecoverable. A queue
  item that needs one is blocked, not attempted — say what the migration would
  have to do and stop there.
  - **The one carve-out: a `cron.schedule` / `cron.unschedule` change, and
    nothing else in the same statement.** Added 2026-08-12, after the 08-11
    "put Plaid back on daily" item could not be completed without it. A schedule
    string alters no table, touches no financial row, and is undone by one
    statement — none of the three reasons above apply to it. It is allowed only
    when **all** of these hold: the item explicitly asks for the cadence change;
    the previous schedule string is written into the commit message and the
    handoff **before** applying, so the undo is on record; the job's `command`
    text is left byte-identical; and the same change is committed as a migration
    file so a replay does not resurrect the old cadence. **And every place that
    states the cadence to a user or to the next reader changes in the same
    commit** — the job name, the docstring, any staleness maths, and the copy on
    the page. Added 2026-08-12 after the 08-11 restore fixed the cron and the
    badge maths but left the Accounts page still telling customers it synced
    Mon/Wed/Fri/Sat; a schedule nobody states correctly drifts invisibly, which
    is exactly how the 05-13 change hid for three months. Anything else under
    `supabase/migrations/` — a table, a column, an index, a constraint, a
    policy, a grant — is still blocked outright, regardless of how additive it
    looks.
- **Never touch live rows.** Reading through the Supabase MCP to establish a
  fact is expected and encouraged. Writing, deleting, or "just fixing" a row is
  not, however obviously wrong the row looks.
- **Never change Stripe or Plaid wiring** — checkout, webhooks, the edge
  functions behind them, or their secrets. A subscription that silently stops
  charging, or a webhook that silently stops arriving, looks exactly like
  nothing happening.
- **Never push, open a pull request, merge, or rewrite history.** The runner
  cannot reach `gh` and must not work around it. Commit locally, report what you
  did, and let Tre ship it. See "Shipping" below for the human path.
- **Never delete or rewrite `handoff.md`.** Add to the top. It is the only
  memory this project has across sessions.

## Do this instead of stopping

**A session must never park and wait for Tre.** File the question and carry on:

```
conductor ask "<the question>" --options a,b,c
```

It returns immediately and puts the question on his board with one-tap answers.
Then work on the parts that do not depend on the answer, then on the parts that
do under an assumption you state out loud, then on something else. Collect
replies with `conductor answers` at natural boundaries.

**This supersedes the AMBIGUITY RULE in `CLAUDE.md`**, which said to stop and
wait. Same instinct, wrong cost: a stopped session spends Tre's attention AND
the session. The rest of that rule stands — do not silently guess, do not
implement multiple variants, and say which reading you took.

And the VERIFY-FIRST rule still comes first. Most "ambiguities" are facts a tool
can settle; only a genuine question of intent is worth a card.

## What "done" means before you claim it

An unattended run cannot prove work happened by exiting 0. It has to show
something:

- `npx tsc --noEmit` clean, `npm test` green (**926 tests across 118 files as of
  2026-08-12**, measured on this branch — a lower number means you deleted
  coverage), `npm run lint` clean.
- Anything with a visible surface was **rendered and looked at**, not just
  compiled. A green build says it compiled.
- Anything touching money maths has a test that would fail if the maths were
  wrong — not a test that merely runs it.
- Say plainly what you did NOT verify. A stated gap is useful; a silent one is
  how a broken thing reaches a live account.

## Scope

The queue item is the whole job. Do not tidy neighbouring code, reformat files
you had to open, upgrade a dependency, or fix unrelated things you noticed —
report those instead. Two sessions editing the same file is a merge conflict
that already happened.

`main` runs ~35 commits ahead of `origin` at times, because nothing here pushes
on its own. **A cloud agent only ever sees `origin`.** If the queue item touches
anything recent, check `git log origin/main..main` before planning against a
tree that is not the real one — this has caused a real conflict mess before.

## Shipping (a human-driven session only)

```
git push -u origin <branch>   →   gh pr create   →   conductor pr <number>
```

All three or none. A PR that is open but never filed is waiting on nobody.
Finish everything before filing: filing hands Tre a merge button and he presses
it, so anything committed afterwards lands on a branch whose PR is already
closed. Verify a merge by CONTENTS (`git grep -F <marker> origin/main`), never
by "it says merged".

### Versions, from 6.0 onward

Set 2026-08-12, and **in force from the next build.** The version is `6.0`.

**`VERSION` at the repo root is the only version that means anything.** Both
build workflows read it through `scripts/read-version.mjs`. Do not bump
`package.json` (2.56.0), the gradle fallback, or the iOS project expecting
customers to see it — none of them ever reached a store.

What this replaced: `versionName` used to be computed from the CI run number
(`RAW = 75 + (run_number - 4)`), so the number customers saw was a count of
Actions runs. Play showed **5.86**, which was run 415. Every build moved it
whether or not anything shipped, and an in-between build could not be expressed
at all, because a run number cannot know what a release is.

**`versionCode` still comes from `run_number + 100`, unchanged.** Play orders
builds by it and it must only ever increase; it is not what anybody reads. That
is what makes moving the display string from `5.86` to `6.0` safe.

```
6.0.1, 6.0.2, …   IN BETWEEN. Internal. Not announced, not published.
6.1               THE PUSH. What customers get, carrying everything the
                  6.0.x builds accumulated.
```

**Two digits are public, three are internal.** `displayVersion` renders a
release as `6.0` and an in-between build as `6.0.1` — so a third digit on a
store listing is the tell that something internal escaped. `VERSION` itself
stays three-part; the two-part form is a rendering applied at the edge.

The caps, which are the part a person gets wrong by hand:

| | range | at the top, the next bump |
|---|---|---|
| patch | 0–99 | rolls the minor, patch returns to 0 |
| minor | 0–9 | rolls the major, minor returns to 0 |

So **6.9.99 is the last version of the 6 series, and 7.0.0 follows it.** A major
holds a thousand in-between builds and exactly ten customer releases.

**The major never moves on its own.** There is no "major bump" — a major is a
consequence of ten customer releases, not a decision taken beside them. Use
`nextVersion(current, "patch" | "minor")` rather than editing `VERSION` by hand;
`read-version.mjs` fails the build on an illegal one rather than letting the
store find it.

```
6.0.1, 6.0.2, …   IN BETWEEN. Internal. Not announced, not published.
6.1               THE PUSH. What customers get, carrying everything the
                  6.0.x builds accumulated.
```

Work accumulates in **patch** releases nobody outside is told about; a **minor**
release is the one that goes to customers with a real changelog behind it. The
app is at fifty-six minor releases today, and customers do not want fifty-six
sets of release notes.

The caps, which are the part a person gets wrong by hand:

| | range | at the top, the next bump |
|---|---|---|
| patch | 0–99 | rolls the minor, patch returns to 0 |
| minor | 0–9 | rolls the major, minor returns to 0 |

So **6.9.99 is the last version of the 6 series, and 7.0.0 follows it.** A major
holds a thousand in-between builds and exactly ten customer releases.

**The major never moves on its own.** There is no "major bump" — a major is a
consequence of ten customer releases, not a decision taken beside them. Use
`nextVersion(current, "patch" | "minor")` rather than editing `package.json` by
hand: both app stores require the version to increase monotonically, so a bad
carry is a release that cannot be published and is found at submission time.
