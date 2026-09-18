#!/usr/bin/env node
/**
 * check-release-note-coverage.mjs - which user-visible commits in a range told the customer
 * NOTHING, because they carry no `Release-Note:` trailer at all.
 *
 * WHY THIS EXISTS, measured 2026-09-17 rather than supposed.
 * Tre, 2026-09-16: *"I don't ever think you fulfilled my achievements, tracking ask."* The
 * achievements work was written, merged and uploaded, and its source quotes his own request in
 * its header. He was right anyway, for a reason nobody had looked at: **a commit with no
 * `Release-Note:` trailer produces no customer line at all**, so the feature reached his phone
 * and nothing anywhere told him it had arrived.
 *
 * Measured with a control, which is what makes it a finding rather than a theory:
 *   - the share-link / username-typeahead commit ......... 0 trailer lines
 *   - the eleven-badge achievements commit ............... 0 trailer lines
 *   - the accounts-compaction commit ..................... 1 trailer line, and it DULY APPEARS
 *     in the generated customer note for build 939
 * So the two features he said were never fulfilled shipped with no note anywhere. He could have
 * read the entire What's New and still not known. That is not forgetfulness.
 *
 * ⚠️ WHY THIS IS NOT THE GATE SOMEBODY WOULD REACH FOR FIRST. The obvious version - "every commit
 * must carry a note" - fires on every refactor, every test, every handoff edit, and is switched
 * off within a week. A gate that is wrong on ordinary work is one somebody `--no-verify`s on the
 * day it would have caught something. Two things keep this one honest:
 *
 *   1. IT ONLY LOOKS AT USER-VISIBLE PATHS. A commit qualifies only if it touches `src/pages/`,
 *      `src/components/` or `src/locales/` in a NON-test file. Engine, hooks, scripts, docs,
 *      workflows and tests are all outside it - they can be user-visible, and that is a deliberate
 *      under-reach: a gate that misses some real cases and never cries wolf survives, and one that
 *      catches everything at the cost of noise does not.
 *   2. `Release-Note: none` SATISFIES IT. The generator already honours that value, so the author
 *      always has a one-line, honest way out. The gate therefore asks for a DECISION, never for
 *      prose - which is the difference between a rule people follow and a rule people route around.
 *
 * WHAT IT DOES NOT COVER, said plainly because a coverage check invites more trust than it earns:
 * whether a note that EXISTS is accurate, well-worded, or describes what actually shipped; any
 * user-visible change made outside those three directories; anything in a merge commit's own
 * diff; and whether the note survived into the store listing - `check:release-note` owns the
 * wrapped-trailer half of that, and neither of them can see App Store Connect.
 *
 * ⛔ DELIBERATELY NOT WIRED INTO THE BUILD. Failing an upload because a commit lacked a sentence
 * would trade a silent customer-communication gap for a blocked release, which is a worse trade on
 * a day something needs shipping. It is a report WITH AN EXIT CODE, run before a customer release
 * - because this repo already records what a report with no route to an exit code is worth.
 *
 * USAGE:  node scripts/check-release-note-coverage.mjs <git-range>
 *         npm run check:notes-coverage -- <last-release-sha>..HEAD
 * EXITS:  0 every user-visible commit declared one . 1 one or more said nothing . 2 could not test
 */
import { execFileSync } from 'node:child_process';

const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

const range = process.argv[2];
if (!range) fail(2, 'no git range given. Example: node scripts/check-release-note-coverage.mjs abc123..HEAD');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let shas;
try {
  // `--no-merges`: a merge commit's own diff is not where a feature is written, and counting one
  // would flag the person who merged rather than the person who shipped.
  shas = git('log', '--no-merges', '--format=%H', range).split('\n').filter(Boolean);
} catch (err) {
  fail(2, `could not read the range "${range}" (${String(err.message).split('\n')[0]}).`);
}

// A range that matches nothing is NOT a clean release. It is a range nobody checked, and the two
// must not print the same thing - this repo has the zero-examined trap on record several times.
if (shas.length === 0) fail(2, `the range "${range}" contains no non-merge commits, so nothing was examined.`);

const USER_VISIBLE_DIRS = ['src/pages/', 'src/components/', 'src/locales/'];
const isTestPath = (p) => /(^|\/)__tests__\//.test(p) || /\.(test|spec|gate\.test)\./.test(p);
const isUserVisiblePath = (p) => USER_VISIBLE_DIRS.some((d) => p.startsWith(d)) && !isTestPath(p);

const missing = [];
let userVisible = 0;

for (const sha of shas) {
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
  if (!files.some(isUserVisiblePath)) continue;
  userVisible += 1;

  const body = git('log', '-1', '--format=%B', sha);
  // Any `Release-Note:` line counts, INCLUDING `none`. The gate asks for a decision, not prose.
  if (!/^Release-Note:/m.test(body)) {
    const subject = git('log', '-1', '--format=%s', sha).trim();
    const touched = files.filter(isUserVisiblePath).slice(0, 3).join(', ');
    missing.push({ sha: sha.slice(0, 8), subject: subject.slice(0, 72), touched });
  }
}

console.log(`examined ${shas.length} commit(s) in ${range}; ${userVisible} touched a user-visible path`);

// A range whose commits are all engine/tests/docs is a legitimate clean result, but it is a
// DIFFERENT result from "every user-visible commit declared one", so it says which.
if (userVisible === 0) {
  console.log('PASS: no commit in this range touched src/pages, src/components or src/locales.');
  process.exit(0);
}

if (missing.length) {
  console.error(`\n${missing.length} user-visible commit(s) told the customer NOTHING:`);
  for (const m of missing) {
    console.error(`  - ${m.sha}  ${m.subject}`);
    console.error(`      touched: ${m.touched}`);
  }
  console.error('\nAdd a one-line `Release-Note:` trailer, or `Release-Note: none` to say so out loud.');
  console.error('See docs/release-notes-template.md. A wrapped trailer is a separate defect - check:release-note owns that.');
  process.exit(1);
}

console.log(`PASS: all ${userVisible} user-visible commit(s) declared a Release-Note.`);
