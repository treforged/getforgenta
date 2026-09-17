#!/usr/bin/env node
/**
 * install-git-hooks.mjs - put this repo's commit-msg hook in place, idempotently.
 *
 * ⚠️ WHY A HOOK NEEDS AN INSTALLER AT ALL. `.git/hooks/` is NOT tracked, so a hook written there
 * cannot be reviewed in a diff, cannot be restored, and cannot be noticed when it vanishes - a
 * fresh clone simply has no protection and nothing says so. The durable half (the rule, the
 * reasoning, the limits) therefore lives in `scripts/check-release-note-trailer.mjs`, in the tree;
 * the thing in `.git/hooks/` is a three-line shim that calls it, and this script writes that shim.
 *
 * ⚠️ IT DOES NOT TOUCH THE OTHER HOOKS. This repo already has a `pre-commit` (empty exported stubs
 * in src/lib) and a `pre-push` (refuses a push from an unattended job), both written by hand and
 * both load-bearing. Re-pointing `core.hooksPath` at a tracked directory would silently disable
 * BOTH of them, which trades one protection for two.
 *
 * RUN IT: npm run install:hooks
 * EXITS:  0 installed or already correct . 2 could not install (no .git/hooks)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_DIR = join('.git', 'hooks');
const HOOK = join(HOOK_DIR, 'commit-msg');

const BODY = `#!/bin/sh
# Refuse a wrapped Release-Note trailer. The rule, the reasoning and the limits all live in
# scripts/check-release-note-trailer.mjs, which is IN THE TREE so it can be reviewed in a diff,
# restored, and noticed if it disappears - unlike this shim.
exec node scripts/check-release-note-trailer.mjs "$1"
`;

if (!existsSync('.git')) {
  process.stderr.write('install-git-hooks: no .git directory here - cannot install.\n');
  process.exit(2);
}
try {
  mkdirSync(HOOK_DIR, { recursive: true });
} catch (err) {
  process.stderr.write(`install-git-hooks: cannot create ${HOOK_DIR} (${err.message}).\n`);
  process.exit(2);
}

// An existing commit-msg hook that is NOT ours is somebody's work. Say so rather than replacing
// it: a silent overwrite is how a protection disappears without anybody noticing.
if (existsSync(HOOK)) {
  const current = readFileSync(HOOK, 'utf8');
  if (current === BODY) {
    process.stdout.write('install-git-hooks: commit-msg already installed and identical.\n');
    process.exit(0);
  }
  if (!current.includes('check-release-note-trailer.mjs')) {
    process.stderr.write(
      'install-git-hooks: a DIFFERENT commit-msg hook is already installed. Refusing to overwrite '
      + `it - read ${HOOK} and merge by hand.\n`,
    );
    process.exit(2);
  }
}

writeFileSync(HOOK, BODY, 'utf8');
try { chmodSync(HOOK, 0o755); } catch { /* chmod is a no-op on Windows; git still runs the hook */ }
process.stdout.write(`install-git-hooks: wrote ${HOOK}\n`);
process.exit(0);
