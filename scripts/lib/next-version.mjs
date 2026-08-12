// The version scheme, from 6.0 onward — and the arithmetic that enforces it.
//
// Tre, 2026-08-12: "once we hit version 6.0 on forgenta, we need to start
// compiling more updates into a single version. maybe use another decimal like
// 6.0.1 for the in between, then back to 6.1 for the overall push that gets
// published to customers. and we'll cap the middle number at 9 before it
// switches the first number, and cap the last number at 99 before it switches
// the middle."
//
// WHAT PROBLEM IT SOLVES. Right now every user-facing change tends to become its
// own published version — the app is at 2.56.0, which is fifty-six minor
// releases. Customers do not want fifty-six release notes; they want to hear
// from the app when something worth hearing about has landed. So work
// accumulates in PATCH releases nobody outside is told about, and a MINOR
// release is the thing that goes to customers with a real changelog behind it.
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

/** The floor this scheme starts at. Below it, the old unbounded-minor history. */
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
 * BELOW 6.0 THIS REFUSES rather than guessing. The app is at 2.56.0 and 56 is
 * not a legal minor under these caps; applying the carry rules to it would
 * produce 3.0.0 out of a routine patch bump and quietly reset a version series
 * customers can see. What happens between here and 6.0 is unchanged, and the
 * changeover is a decision someone makes on purpose.
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
