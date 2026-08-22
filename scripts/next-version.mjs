#!/usr/bin/env node
// What should the next version be, and why?
//
//     node scripts/next-version.mjs            # say what it would be
//     node scripts/next-version.mjs --write    # and write it to VERSION
//
// WHAT IT READS. Every commit since VERSION last changed. That anchor is used rather than a git
// tag because this repo does not tag releases -- the VERSION file IS the record, so "since the
// last release" means "since that file last moved". If VERSION has never changed it falls back to
// the whole history, which only happens on a fresh clone of a repo that has not released yet.
//
// CORRECTION, 2026-08-22: the sentence above was not the whole truth, and the gap had teeth. In a
// SHALLOW clone -- which is what every CI checkout is -- VERSION may well have moved before the
// fetch horizon, and the anchor lookup does not go quiet about it. Measured against
// `git clone --depth 2` of this repo, it named a commit that touches four files under src/ and no
// VERSION at all, because a shallow clone's oldest commit is presented as parentless and
// path-limited log therefore credits it with everything in its tree. The reading came out three
// times smaller than the truth and looked exact. The lookup now lives in
// scripts/lib/version-history.mjs, which discards a horizon anchor and reports whether it could see
// everything; --write refuses when it could not.
//
// WHAT IT WILL NOT DO. It will not invent a major. `classifyBump` only returns major when a commit
// declares one (`feat!:` or a `BREAKING CHANGE:` footer), because a major cannot be walked back --
// both stores require versions to increase monotonically -- and whether a change is BREAKING as
// opposed to merely large is a judgement only the author has. Under-calling costs a version
// number; over-calling costs the ability to ever use that number again.
//
// It also prints its reasoning rather than only a number, because a version bump nobody can
// explain is one nobody can check.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyBump, classifyBump, displayVersion, formatVersion,
  isCustomerRelease, parseVersion, violations,
} from "./lib/next-version.mjs";
import { readVersionHistory } from "./lib/version-history.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = join(ROOT, "VERSION");

function main() {
  const write = process.argv.includes("--write");
  const current = parseVersion(readFileSync(VERSION_FILE, "utf8"));

  // The anchor lookup and the "since" range moved to scripts/lib/version-history.mjs on
  // 2026-08-22, unchanged, because the staleness notice the build workflows print has to reach
  // the same answer this does. See that file for why `complete` is reported separately.
  const { anchor, messages, complete } = readVersionHistory(ROOT);
  const { kind, reason } = classifyBump(messages);
  const next = applyBump(current, kind);

  const problems = violations(next);
  if (problems.length > 0) {
    console.error(`refusing: ${formatVersion(next)} is illegal — ${problems.join("; ")}`);
    process.exit(1);
  }

  console.log(`current   ${formatVersion(current)}  (${displayVersion(current)})`);
  // "the beginning" only when it really is the beginning. In a truncated clone the anchor is
  // discarded rather than trusted (see lib/version-history.mjs), and printing "the beginning" for
  // that would claim the repo has never released, which is a different and much calmer fact.
  const from = anchor ? anchor.slice(0, 8) : complete ? "the beginning" : "this clone's horizon";
  console.log(`since     ${from} — ${messages.length} commit(s)`);
  console.log(`bump      ${kind.toUpperCase()}`);
  console.log(`because   ${reason}`);
  console.log(`next      ${formatVersion(next)}  (${displayVersion(next)})`);
  console.log(`customer  ${isCustomerRelease(next) ? "yes — this one goes to the stores" : "no — in-between build"}`);

  if (kind !== "major" && messages.length > 0) {
    console.log(`\nnote      a MAJOR is only ever produced by a commit that declares one`);
    console.log(`          (\`feat!:\` or a \`BREAKING CHANGE:\` footer), or by minor rolling past 9.`);
  }

  // ⚠️ A TRUNCATED HISTORY UNDER-CALLS, ALWAYS IN THE SAME DIRECTION. Commits this clone cannot
  // see can only ADD a `feat:` or a `BREAKING CHANGE:` to the pile, never remove one, so a bump
  // classified from a partial list is a floor: it can be a patch where the real answer was a
  // minor. Printing that is a hedge; WRITING it is how the version that goes to a store gets
  // decided by an accident of `fetch-depth`. So --write refuses, and .github/workflows/
  // version-bump.yml checks out with fetch-depth: 0 so it never has to.
  if (!complete) {
    // "the history is truncated", not "it is shallow". `complete` is also false when
    // `git rev-parse --is-shallow-repository` could not be answered at all (shallow === null, an
    // old git), and on that path "it is shallow" asserts a fact the script never established --
    // exactly the kind of confident wrong reading this whole slice exists to stop. "At or before
    // its horizon" for the same reason: when the anchor sits ON the horizon, that IS where VERSION
    // last moved as far as anyone here can tell. One string, so the --write refusal below and the
    // advisory warning further down cannot drift apart.
    const truncation = `only the ${messages.length} commit(s) this clone can see were classified; the history is truncated and VERSION last moved at or before its horizon`;
    if (write) {
      console.error(`\nrefusing to write: ${truncation}.`);
      console.error(`             re-run in a full clone (git fetch --unshallow, or fetch-depth: 0 in CI).`);
      process.exit(1);
    }
    console.log(`\nwarning   ${truncation},`);
    console.log(`          so the bump above is a FLOOR: the real answer can only be larger.`);
  }

  if (write) {
    writeFileSync(VERSION_FILE, `${formatVersion(next)}\n`, "utf8");
    console.log(`\nwrote     VERSION = ${formatVersion(next)}`);
  }
}

main();
