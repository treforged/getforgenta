// The version scheme, from 6.0 onward — and the arithmetic that enforces it.
//
// Tre, 2026-08-12: "once we hit version 6.0 on forgenta, we need to start
// compiling more updates into a single version. maybe use another decimal like
// 6.0.1 for the in between, then back to 6.1 for the overall push that gets
// published to customers. and we'll cap the middle number at 9 before it
// switches the first number, and cap the last number at 99 before it switches
// the middle."
//
// WHAT PROBLEM IT SOLVES, and it is worse than "too many release notes".
//
// The version customers see is not a release number at all — it is a count of CI
// runs. `.github/workflows/android-build.yml` computes it:
//
//     RAW = 75 + (github.run_number - 4)
//     versionName = "${1 + RAW/100}.${RAW % 100}"
//
// Google Play shows 5.86 today, which is run 415. Every Actions build moves it,
// whether or not anything shipped, whether or not a customer would notice. There
// is no such thing as an in-between build in that scheme, because the number has
// no idea what a release is.
//
// (Nothing in the repo agrees with the store, either: package.json says 2.56.0,
// android/app/build.gradle falls back to "1.75", and the iOS project says 1.0.
// The only true version is the one CI computes at build time, and it is not
// written down anywhere.)
//
// So work accumulates in PATCH releases nobody outside is told about, and a
// MINOR release is the thing that goes to customers with a real changelog behind
// it:
//
//   6.0.1, 6.0.2, …    IN BETWEEN. Internal. Not announced, not published.
//   6.1                THE PUSH. This is what customers get, and it carries
//                      everything the 6.0.x builds accumulated.
//
// THE CAPS, and they are the part a human gets wrong by hand:
//
//   patch  0…99   at 99, the next bump rolls the minor and patch returns to 0
//   minor  0…9    at 9,  the next bump rolls the major and minor returns to 0
//
// So 6.9.99 is the last version in the 6 series, and what follows it is 7.0.0.
// A major therefore holds a thousand in-between builds and exactly ten customer
// releases, which is the ratio the whole scheme is expressing.
//
// WHY THIS IS CODE AND NOT ONLY A LINE IN AGENT.md. A rule about carrying at 9
// and 99 is precisely the kind a person applies correctly forty times and then
// gets wrong once, at 6.9.99, months from now, in a hurry — and a version that
// goes backwards or skips is not a cosmetic mistake. Both app stores require the
// version to increase monotonically, so a bad bump is a release that cannot be
// published and is discovered at submission.

// WHEN IT STARTS, and it is soon: under the formula above, 6.00 lands 14 builds
// after 5.86 and arrives on its own. That is the changeover Tre named, and it is
// a deadline rather than an aspiration.
//
// THIS MODULE IS THE ARITHMETIC, NOT THE PIPELINE. Nothing here is wired into a
// build yet, and it cannot be until versionName stops being derived from
// run_number and starts being read from a declared version in the repo —
// run_number cannot know whether a build is an in-between or a customer push,
// which is the entire distinction being introduced. versionCode should keep
// coming from run_number: it must only ever increase and is unrelated to what is
// displayed.

/** The floor this scheme starts at. Below it, the CI-run-derived history. */
export const SCHEME_FROM = { major: 6, minor: 0, patch: 0 };

/** `"6.0.1"` -> `{ major, minor, patch }`. Throws on anything else, deliberately:
 *  a version string that cannot be read is not a thing to guess about. */
export function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  if (!m) throw new Error(`not a version: ${JSON.stringify(text)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

/**
 * The version as a PERSON sees it — two parts for a release, three for a build
 * that is not one.
 *
 * Tre, 2026-08-12: "the one that's published to users should just show 6.0. 3
 * digits is internal between public release."
 *
 * So the third digit is not merely unimportant to customers, it is the MARK of
 * something they were never meant to be looking at. `6.0` is a release; `6.0.1`
 * is an in-between build, and if one ever reaches a store listing the extra
 * digit is the thing that says so at a glance.
 *
 * The canonical version stays three-part everywhere it is stored and compared —
 * VERSION, this module, the tests. This is a rendering, applied at the edge, and
 * it is deliberately not reversible: `6.0` and `6.0.0` are the same version
 * said to two different audiences.
 */
export function displayVersion(version) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  if (!underScheme(v)) return formatVersion(v);
  return v.patch === 0 ? `${v.major}.${v.minor}` : formatVersion(v);
}

/** Is this version inside the scheme's range — i.e. do the caps apply to it? */
export function underScheme(version) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  return v.major >= SCHEME_FROM.major;
}

/**
 * The next version, given what kind of release this is.
 *
 * `kind` is "patch" (an in-between build) or "minor" (a customer release).
 * There is no "major": the major NEVER moves on its own. It moves only because
 * the minor carried past 9, which is the point of the scheme — a major is a
 * consequence of ten customer releases, not a marketing decision taken
 * separately from them.
 *
 * BELOW 6.0 THIS REFUSES rather than guessing. Play shows 5.86, and 86 is not a
 * legal minor under these caps; applying the carry rules to it would produce
 * 6.0.0 out of a routine patch bump and skip the fourteen builds still to come.
 * What happens between here and 6.0 is unchanged, and the changeover is a
 * decision someone makes on purpose.
 */
export function nextVersion(current, kind) {
  const v = typeof current === "string" ? parseVersion(current) : { ...current };
  if (!underScheme(v)) {
    throw new Error(
      `the 9/99 scheme starts at ${formatVersion(SCHEME_FROM)}; ${formatVersion(v)} predates it`,
    );
  }
  if (kind !== "patch" && kind !== "minor") {
    throw new Error(`kind must be "patch" or "minor", not ${JSON.stringify(kind)}`);
  }

  if (kind === "minor") return carryMinor({ ...v, minor: v.minor + 1, patch: 0 });
  return carryPatch({ ...v, patch: v.patch + 1 });
}

/** 99 is a legal patch; 100 is not, and rolls into the minor. */
function carryPatch(v) {
  if (v.patch <= 99) return v;
  return carryMinor({ major: v.major, minor: v.minor + 1, patch: 0 });
}

/** 9 is a legal minor; 10 is not, and rolls into the major. */
function carryMinor(v) {
  if (v.minor <= 9) return v;
  return { major: v.major + 1, minor: 0, patch: 0 };
}

/**
 * Is this version legal under the scheme?
 *
 * Separate from `nextVersion` because the thing worth catching is a version that
 * was written BY HAND into package.json — the carry rules cannot be broken by
 * `nextVersion`, only by a person editing the file.
 */
export function violations(version) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  const out = [];
  if (!underScheme(v)) return out;
  if (v.minor > 9) out.push(`minor is ${v.minor}; it is capped at 9 and rolls the major`);
  if (v.patch > 99) out.push(`patch is ${v.patch}; it is capped at 99 and rolls the minor`);
  return out;
}

/**
 * Does this version go to customers?
 *
 * A patch of 0 is the release the minor bump produced; anything above it is an
 * in-between build. This is the question the release notes and the store upload
 * both turn on, and it is one line — but it is the line the whole scheme exists
 * for, so it is named rather than re-derived at each call site.
 */
export function isCustomerRelease(version) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  return underScheme(v) ? v.patch === 0 : true;
}
