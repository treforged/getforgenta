#!/usr/bin/env node
// The one place a build learns what version it is.
//
// Printed as `KEY=value` lines for `$GITHUB_ENV`, so both build workflows read
// the same file through the same validator and cannot drift:
//
//     node scripts/read-version.mjs >> "$GITHUB_ENV"
//
// WHAT THIS REPLACES, and why it had to go. `versionName` used to be computed
// from the CI run number:
//
//     RAW = 75 + (run_number - 4)
//     versionName = "${1 + RAW/100}.${RAW % 100}"
//
// Under that, the number customers see was a count of Actions runs. Every build
// moved it whether or not anything shipped, and there was no way to express an
// in-between build at all, because a run number cannot know what a release is.
// Google Play showed 5.86 at run 415. Tre, 2026-08-12: "we can just change it
// now to the new format and start in 6."
//
// VERSIONCODE STILL COMES FROM THE RUN NUMBER, deliberately and unchanged.
// Play orders builds by versionCode alone and it must only ever increase; it is
// not what anybody reads. Keeping `run_number + 100` preserves the existing
// sequence exactly, so this change cannot make an upload be rejected as a
// downgrade. `versionName` is the human-facing string and Play does not order by
// it at all — which is what makes moving from "5.86" to "6.0.0" safe.
//
// IT REFUSES TO PRINT AN ILLEGAL VERSION. A build is the last place to discover
// that someone typed `6.10.0` into VERSION by hand, and the caps are exactly the
// kind of rule a person gets right forty times and wrong once. Failing here
// costs a red CI run; failing at the store costs a release.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { displayVersion, isCustomerRelease, parseVersion, underScheme, violations } from "./lib/next-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readVersion(root = ROOT) {
  const raw = readFileSync(join(root, "VERSION"), "utf-8").trim();
  // Parses or throws — a VERSION file that cannot be read is not something to
  // fall back from. The old fallback (`versionName ?: "1.75"` in build.gradle)
  // is how a build could quietly ship a version four years stale.
  parseVersion(raw);

  const bad = violations(raw);
  if (bad.length) throw new Error(`VERSION is ${raw}: ${bad.join("; ")}`);
  if (!underScheme(raw)) {
    throw new Error(`VERSION is ${raw}, below the ${"6.0.0"} the scheme starts at`);
  }
  return raw;
}

// `pathToFileURL`, not a hand-built comparison: on Windows the naive version
// yields `file://C:/…` against an actual `file:///C:/…` and this block silently
// never runs — which for a script whose whole job is to print would look like a
// build that produced no version at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = readVersion();
  const runNumber = Number(process.env.GITHUB_RUN_NUMBER ?? 0);
  // TWO PARTS FOR A RELEASE, THREE FOR A BUILD THAT IS NOT ONE. The canonical
  // version in VERSION stays three-part; this is the string a person reads, and
  // a stray third digit on a store listing is the tell that something internal
  // escaped. See displayVersion.
  console.log(`VERSION_NAME=${displayVersion(version)}`);
  console.log(`VERSION_CANONICAL=${version}`);
  console.log(`VERSION_CODE=${runNumber + 100}`);
  // So the build log says which kind of release it is without anyone deriving
  // it again. `false` means these bits are not going to customers.
  console.log(`CUSTOMER_RELEASE=${isCustomerRelease(version)}`);
}
