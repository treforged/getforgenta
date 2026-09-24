#!/usr/bin/env node
/**
 * install-git-hooks.mjs - point git at this repo's TRACKED hooks in `.githooks/`, idempotently.
 *
 * ⚠️ WHY THE HOOKS MOVED INTO THE TREE (2026-09-24, ask 6942ae27). They used to live only in
 * `.git/hooks/`, which is NOT tracked: a hook there cannot be reviewed in a diff, cannot be
 * restored, and cannot be noticed when it vanishes. The pre-commit there also had no secret scan,
 * and a staged `sk-or-v1-...` key passed it with exit 0. `.githooks/` now holds all three:
 *   pre-commit  secret scan (scripts/secret-scan.mjs) + the empty-stub check for src/lib
 *   pre-push    refuses a push from an unattended job (CONDUCTOR_JOB)
 *   commit-msg  refuses a wrapped Release-Note trailer (scripts/check-release-note-trailer.mjs)
 * Earlier this file said re-pointing core.hooksPath would disable the hand-written hooks. That
 * was true only while they were NOT in `.githooks/`. They are copied there verbatim, so nothing
 * is lost.
 *
 * ⚠️ A FRESH CLONE HAS NO PROTECTION UNTIL THIS RUNS - git never runs hooks from a clone by itself.
 * `git commit --no-verify` still skips every hook.
 *
 * RUN IT: npm run install:hooks
 * UNDO:   git config --unset core.hooksPath   (git then runs whatever is in .git/hooks again)
 * EXITS:  0 installed or already correct . 2 could not install
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = '.githooks';
const HOOKS = ['pre-commit', 'pre-push', 'commit-msg'];
const fail = (msg) => { process.stderr.write(`install-git-hooks: ${msg}\n`); process.exit(2); };

if (!existsSync('.git')) fail('no .git directory here - cannot install.');
const missing = HOOKS.filter((h) => !existsSync(join(DIR, h)));
if (missing.length) fail(`${DIR}/ is missing ${missing.join(', ')} - refusing to point git at an incomplete set.`);

let current = '';
try {
  current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
} catch (err) {
  if (err.status !== 1) fail(`could not read core.hooksPath (git exit ${err.status}).`); // 1 = unset
}

if (current === DIR) {
  process.stdout.write(`install-git-hooks: core.hooksPath is already ${DIR} (${HOOKS.join(', ')}).\n`);
  process.exit(0);
}
// A DIFFERENT hooksPath is somebody's decision. Say so rather than replace it silently.
if (current) fail(`core.hooksPath is already "${current}". Refusing to overwrite it - merge by hand.`);

execFileSync('git', ['config', 'core.hooksPath', DIR]);
const after = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
if (after !== DIR) fail(`set core.hooksPath but it reads back "${after}".`);
process.stdout.write(`install-git-hooks: core.hooksPath -> ${DIR} (${HOOKS.join(', ')}). Undo: git config --unset core.hooksPath\n`);
process.exit(0);
