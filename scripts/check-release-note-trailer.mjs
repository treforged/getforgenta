#!/usr/bin/env node
/**
 * check-release-note-trailer.mjs - REFUSE a commit whose `Release-Note:` trailer is wrapped.
 *
 * WHY THIS EXISTS, and it is a failure this repo committed twice in one morning.
 * `d0bf7c6` published *"Fixed a credit card projection that charged one month of"* to the stores
 * and DROPPED *"purchases twice when a card was paid off..."*. `e874995` published *"The credit
 * card payoff rows no longer carry an explanation that"* and dropped the rest. Both read as
 * truncated mid-sentence to a real App Store reader. git reads a trailer as ONE LINE, so a
 * continuation that is not indented is simply not part of it.
 *
 * ⚠️ THE DETECTION ALREADY EXISTED AND ALREADY FIRED. `parseTrailers` has warned about exactly
 * this for months, and the warning prints on every single `npm run test:tz` run - inside an output
 * where 4,773 tests pass around it. That is the "failure that does not fail the job" family: the
 * report was honest, and it had no route to an exit code, so nobody read it. This gives it one.
 *
 * ⚠️ AND IT HAS TO RUN BEFORE THE COMMIT EXISTS. A pushed commit message cannot be rewritten, so
 * a gate that notices afterwards can only ever tell you about damage already done. That is why
 * this is a `commit-msg` check and not a test.
 *
 * ⚠️ IT REUSES `parseTrailers` RATHER THAN RE-IMPLEMENTING THE RULE. A second copy of "what counts
 * as wrapped" is a second definition that drifts, and then the gate and the publisher disagree
 * about the one thing they both exist to agree on.
 *
 * WHAT IT DOES NOT COVER, said plainly:
 *   - it does not judge the WORDING of a note, only its shape;
 *   - `git commit --no-verify` skips it, and so does anyone who deletes the hook. It stops the
 *     accident, which is what actually happened here, not the determined;
 *   - it says nothing about commits that already exist, because nothing can.
 *
 * USAGE: node scripts/check-release-note-trailer.mjs <path-to-commit-message-file>
 * EXITS: 0 clean . 1 a trailer is wrapped . 2 could not check (no file, unreadable, empty)
 *
 * The exit-2 case is deliberate and load-bearing: a gate that cannot read its subject must not
 * report a clean commit. "0 problems" and "0 messages examined" are the same zero otherwise.
 */
import { readFileSync } from 'node:fs';
import { parseTrailers, TRAILER } from './lib/release-notes.mjs';

const path = process.argv[2];
if (!path) {
  process.stderr.write('release-note-check: no commit-message file given - cannot check.\n');
  process.exit(2);
}

let message;
try {
  message = readFileSync(path, 'utf8');
} catch (err) {
  process.stderr.write(`release-note-check: cannot read ${path} (${err.message}) - cannot check.\n`);
  process.exit(2);
}

// A commit message is never legitimately empty, so an empty read means the wrong file, not a
// clean commit.
if (message.trim() === '') {
  process.stderr.write(`release-note-check: ${path} is empty - cannot check.\n`);
  process.exit(2);
}

// git hands the hook the RAW message, subject line included; parseTrailers reads a body. Passing
// the whole thing is correct - a subject line cannot match TRAILER_LINE.
const { warnings } = parseTrailers(message);

if (warnings.length > 0) {
  process.stderr.write(`\nREFUSED: this commit's ${TRAILER} trailer is wrapped onto the next line.\n\n`);
  for (const w of warnings) process.stderr.write(`  ${w}\n`);
  process.stderr.write(
    `\ngit reads a trailer as ONE line. The dropped half never reaches the App Store or Play\n`
    + `listing, so the note ships truncated mid-sentence. Put it on one line, or indent the\n`
    + `continuation by one space. See docs/release-notes-template.md.\n\n`,
  );
  process.exit(1);
}

process.exit(0);
