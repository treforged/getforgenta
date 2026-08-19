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
// WHAT IT WILL NOT DO. It will not invent a major. `classifyBump` only returns major when a commit
// declares one (`feat!:` or a `BREAKING CHANGE:` footer), because a major cannot be walked back --
// both stores require versions to increase monotonically -- and whether a change is BREAKING as
// opposed to merely large is a judgement only the author has. Under-calling costs a version
// number; over-calling costs the ability to ever use that number again.
//
// It also prints its reasoning rather than only a number, because a version bump nobody can
// explain is one nobody can check.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyBump, classifyBump, displayVersion, formatVersion,
  isCustomerRelease, parseVersion, violations,
} from "./lib/next-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = join(ROOT, "VERSION");

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** The commit that last touched VERSION — i.e. the last release, however it was cut. */
function lastVersionBump() {
  const sha = git("log", "-1", "--format=%H", "--", "VERSION");
  return sha === "" ? null : sha;
}

/** Full messages, not just subjects: a `BREAKING CHANGE:` footer lives in the body. */
function messagesSince(sha) {
  const range = sha ? `${sha}..HEAD` : "HEAD";
  const raw = git("log", range, "--format=%B%x00");
  return raw.split("\0").map(m => m.trim()).filter(Boolean);
}

function main() {
  const write = process.argv.includes("--write");
  const current = parseVersion(readFileSync(VERSION_FILE, "utf8"));

  const anchor = lastVersionBump();
  const messages = messagesSince(anchor);
  const { kind, reason } = classifyBump(messages);
  const next = applyBump(current, kind);

  const problems = violations(next);
  if (problems.length > 0) {
    console.error(`refusing: ${formatVersion(next)} is illegal — ${problems.join("; ")}`);
    process.exit(1);
  }

  console.log(`current   ${formatVersion(current)}  (${displayVersion(current)})`);
  console.log(`since     ${anchor ? anchor.slice(0, 8) : "the beginning"} — ${messages.length} commit(s)`);
  console.log(`bump      ${kind.toUpperCase()}`);
  console.log(`because   ${reason}`);
  console.log(`next      ${formatVersion(next)}  (${displayVersion(next)})`);
  console.log(`customer  ${isCustomerRelease(next) ? "yes — this one goes to the stores" : "no — in-between build"}`);

  if (kind !== "major" && messages.length > 0) {
    console.log(`\nnote      a MAJOR is only ever produced by a commit that declares one`);
    console.log(`          (\`feat!:\` or a \`BREAKING CHANGE:\` footer), or by minor rolling past 9.`);
  }

  if (write) {
    writeFileSync(VERSION_FILE, `${formatVersion(next)}\n`, "utf8");
    console.log(`\nwrote     VERSION = ${formatVersion(next)}`);
  }
}

main();
