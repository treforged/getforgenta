// resolve-release-range.mjs - WHICH COMMITS THIS BUILD IS SHIPPING.
//
// Both store workflows used to answer this inline, identically, and identically WRONGLY:
//
//     if git cat-file -e "$GITHUB_EVENT_BEFORE"; then RANGE="before..sha"; else RANGE="-6"; fi
//
// A `workflow_dispatch` has no `before`, so every dispatched run fell through to `-6`: an
// ARBITRARY six-commit window with no relationship whatever to what the build contains.
//
// ⚠️ THAT WINDOW DOES NOT ONLY FEED THE COVERAGE CHECK. IT GENERATES THE PUBLISHED RELEASE
// NOTE. Measured on run 35359868193 (iOS 956, 2026-09-18): the six commits before the head were
// all handoff commits, so the generator produced "Maintenance release. Nothing changes in how
// you use Forgenta this time." - on the build carrying the dark-mode contrast fix Tre had asked
// for. The coverage check then PASSED, honestly, over the same six.
//
// ⚠️ AND ON ANDROID NOBODY GETS A CHANCE TO NOTICE. iOS writes that text into a step summary for
// a human to paste. `android-build.yml` writes it to `whatsnew/` and hands it to
// `upload-google-play` with `tracks: production`, and that deploy step is UNGATED BY EVENT - so
// a dispatched Android run publishes the sentence to the live listing automatically. The last 40
// Android runs were all `push`, so it has never fired. That is a fact about history, not a
// guarantee about the next dispatch.
//
// WHAT THIS DOES INSTEAD, in order, and it always SAYS WHICH SOURCE IT USED - a fallback that
// runs silently is a hand-named list wearing a derived list's clothes:
//   1. RELEASE_RANGE_SINCE, when an operator names a starting point on a dispatch.
//   2. The push's own `before`, which is correct and needs nothing.
//   3. The head of the LAST SUCCESSFUL RUN of this same workflow on this branch, via `gh`.
//      That is the real answer to "what is new since the last build" and it is what a dispatch
//      should have been using all along.
//   4. REFUSE. Exit 2, naming what to do.
//
// ⚠️ IT REFUSES RATHER THAN GUESSING, AND THE REFUSAL NAMES A DECISION RATHER THAN A WALL. An
// arbitrary window is worse than no window: it produces a confident, plausible, wrong answer
// that no reader can tell from a right one. A caller that cannot tolerate a refusal should pass
// RELEASE_RANGE_SINCE.
//
// ⚠️ THE SHALLOW CLONE IS PART OF THE ANSWER. Both workflows check out `fetch-depth: 50`, so a
// resolved sha that is not IN the clone is as useless as no sha. Every candidate is tested with
// `git cat-file -e <sha>^{commit}` before it is accepted, and failing that test falls THROUGH to
// the next source rather than returning a range git cannot walk.
//
// EXITS: 0 prints the range on stdout . 2 could not resolve, reason on stderr.
import { execFileSync } from 'node:child_process';

const say = (m) => process.stderr.write(`${m}\n`);

function resolves(sha) {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const head = process.env.GITHUB_SHA || 'HEAD';
const since = (process.env.RELEASE_RANGE_SINCE || '').trim();
const before = (process.env.GITHUB_EVENT_BEFORE || '').trim();
const workflow = (process.env.RELEASE_RANGE_WORKFLOW || '').trim();
const branch = (process.env.GITHUB_REF_NAME || 'main').trim();

// 1. An operator said so.
if (since) {
  if (!resolves(since)) {
    say(`REFUSING: RELEASE_RANGE_SINCE="${since}" is not a commit in this clone.`);
    say('The clone is shallow (fetch-depth: 50), so an older sha will not be here. Deepen the');
    say('checkout or pass a sha within the last 50 commits.');
    process.exit(2);
  }
  say(`range source: RELEASE_RANGE_SINCE (an operator named it)`);
  process.stdout.write(`${since}..${head}\n`);
  process.exit(0);
}

// 2. An ordinary push already knows.
if (resolves(before)) {
  say('range source: this push’s own before..sha');
  process.stdout.write(`${before}..${head}\n`);
  process.exit(0);
}

// 3. The last build that actually shipped from this branch.
if (workflow) {
  let last = '';
  try {
    last = execFileSync(
      'gh',
      ['run', 'list', '--workflow', workflow, '--branch', branch, '--status', 'success',
       '--limit', '1', '--json', 'headSha', '-q', '.[0].headSha'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch (err) {
    say(`gh could not be asked for the last successful ${workflow} run: ${err.message.split('\n')[0]}`);
    say('That usually means the job lacks `actions: read`, or GH_TOKEN is not set on the step.');
  }
  if (last && last !== head) {
    if (resolves(last)) {
      say(`range source: last successful ${workflow} run on ${branch} (${last.slice(0, 8)})`);
      process.stdout.write(`${last}..${head}\n`);
      process.exit(0);
    }
    say(`the last successful run was ${last.slice(0, 8)}, which is NOT in this shallow clone.`);
    say('Deepen the checkout past it, or pass RELEASE_RANGE_SINCE.');
  } else if (last === head) {
    say(`the last successful ${workflow} run was this same commit, so there is nothing new to say.`);
  }
}

say('');
say('REFUSING TO INVENT A RANGE.');
say('There is no `before` (this is not a push) and no usable previous successful run, so the');
say('only thing left would be an arbitrary window - and an arbitrary window is worse than none:');
say('it produces a plausible release note that no reader can tell from a correct one. Build 956');
say('shipped "Maintenance release. Nothing changes" over the dark-mode contrast fix that way.');
say('');
say('Re-run this workflow with RELEASE_RANGE_SINCE set to the last shipped commit.');
process.exit(2);
