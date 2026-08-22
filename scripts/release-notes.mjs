#!/usr/bin/env node
//
// Build the "What's new" text the app stores show, from a range of commits.
//
// Usage:
//   node scripts/release-notes.mjs <git-range>          # e.g. abc123..def456, or -6
//   node scripts/release-notes.mjs <git-range> --why    # same, plus a note on stderr
//   git log --format=%s | node scripts/release-notes.mjs --stdin
//
// Writes the notes to stdout and nothing else there. Exit code is ALWAYS 0 and
// stdout is ALWAYS 20..480 bytes, which sits strictly inside the 20..500-byte
// window .github/workflows/android-build.yml hard-fails outside of (500 is
// Google Play's per-locale cap; 480 is this generator's own ceiling, for
// headroom). A store deploy must never fail because its release note could not
// be generated, and an empty note fails that build as hard as a 600-byte one.
//
// Warnings, if any, go to stderr unconditionally. --why adds a source line.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO WRITE THE CUSTOMER WORDING YOURSELF, which is the point of the rewrite.
// The version for humans is docs/release-notes-template.md.
//
// Put a `Release-Note:` trailer in the commit body, ON ONE LINE. It is published
// VERBATIM and it beats everything this script would otherwise derive:
//
//     git commit -m "fix(cash-floor): month 0 gets the same \$2 cushion as every other month" \
//                -m "Release-Note: Your first forecast month keeps the same safety cushion as every month after it."
//
// One line, because that is how git reads a trailer. If it has to wrap, INDENT
// the continuation and it is folded in; an unindented second line is not part of
// the trailer and this prints a warning to stderr saying what it dropped.
//
// Several commits in one release each contribute their line, newest first.
// `Release-Note: none` says "this commit adds nothing to the listing" out loud.
//
// To hand-write a WHOLE release instead, put the finished lines in
// docs/next-release-notes.txt. It is honoured only when a commit in the same
// range actually touched that file — see NOT LETTING A HAND-WRITTEN FILE GO
// STALE below.
//
// If neither exists, the script derives themed sentences it wrote itself. It
// never publishes a commit subject. See scripts/lib/release-notes.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { AUTHORED_FILE, buildNotes, parseCommitRecords } from "./lib/release-notes.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `%H` sha, `%s` subject, `%b` body — see RECORD_SEP/FIELD_SEP in the lib. */
const LOG_FORMAT = "%H%x1f%s%x1f%b%x1e";

function git(args) {
  // stderr is captured rather than inherited: a bad range makes git print
  // "fatal: ambiguous argument", which is handled here and must not appear in
  // the deploy log as if something had gone wrong.
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * NOT LETTING A HAND-WRITTEN FILE GO STALE, which is the one real hazard of the
 * file mechanism and the reason the trailer is the primary path.
 *
 * docs/next-release-notes.txt is read ONLY if a commit inside THIS range changed
 * it. Without that check the file is a landmine: written once for 6.4, forgotten,
 * and then republished on 6.5, 6.6 and 6.7 describing work that shipped months
 * ago — which is the "never overstate" rule broken by a file nobody remembered.
 * With it, the file is self-clearing: editing it opts one release in, and doing
 * nothing opts every later release out.
 */
function authoredFileFor(range) {
  const path = join(REPO_ROOT, AUTHORED_FILE);
  if (!existsSync(path)) return null;
  if (!range) return null;
  try {
    const touched = git(["log", range, "--format=", "--name-only", "--", AUTHORED_FILE]).trim();
    if (!touched) return null;
  } catch {
    return null;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function main(argv) {
  const args = argv.filter((a) => a !== "--why");
  const why = argv.includes("--why");

  let commits = [];
  let range = null;

  if (args[0] === "--stdin") {
    commits = parseCommitRecords(readStdin());
  } else {
    range = args[0] || "-6";
    try {
      commits = parseCommitRecords(git(["log", range, `--format=${LOG_FORMAT}`]));
    } catch {
      commits = [];
    }
  }

  const authoredFile = args[0] === "--stdin" ? null : authoredFileFor(range);
  const { text, source, bytes, warnings } = buildNotes({ commits, authoredFile });

  process.stdout.write(text);
  // Warnings are NOT gated behind --why. A `Release-Note:` an author wrapped
  // onto a second line loses half its sentence, and the whole point of warning
  // is that the person who wrote it finds out; the Android step runs with --why
  // but the iOS step captures stdout with `NOTE=$(node ...)` and would otherwise
  // see nothing at all. stderr never contaminates either.
  for (const warning of warnings ?? []) process.stderr.write(`release-notes: ${warning}\n`);
  if (why) {
    process.stderr.write(`release-notes: source=${source} commits=${commits.length} bytes=${bytes}\n`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  // Belt and braces. Nothing above should throw, and if it somehow does, a
  // release must still get a legal note rather than a failed deploy.
  process.stderr.write(`release-notes: ${err?.message ?? err}\n`);
  process.stdout.write("Maintenance release. Nothing changes in how you use Forgenta this time.\n");
}

// NO `process.exit(0)` HERE, and that is the fix rather than an omission.
// process.exit() tears the process down immediately; a `process.stdout.write`
// whose target is a PIPE rather than a TTY can still be buffered at that moment,
// and the tail of the note is lost. The iOS workflow captures this with
// `NOTE=$(node scripts/release-notes.mjs "$RANGE")`, which is exactly a pipe.
// Letting the event loop drain and exit on its own is already exit code 0;
// setting it explicitly says so without forcing anything.
process.exitCode = 0;
