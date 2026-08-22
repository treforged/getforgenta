#!/usr/bin/env node
// Is this build shipping a version the stores have already seen?
//
//     node scripts/version-staleness.mjs                     # print the reading
//     node scripts/version-staleness.mjs /path/to/a/checkout # ...for some other clone
//
// WHY THIS EXISTS, and it is not a style point. On 2026-08-21 Apple rejected an upload because
// CFBundleShortVersionString 6.3 was not higher than the 6.3 already approved. Nothing in this
// repo bumps VERSION: it had sat at 6.3.0 across 72 commits, 18 of them `feat:`, while CI
// cheerfully rebuilt and re-uploaded that same already-approved version. Every part of the machine
// worked. The build was green, the upload ran, and the only thing missing was anybody being told
// that the number had not moved.
//
// So this prints a reading into `$GITHUB_STEP_SUMMARY`, which is the page a person actually opens
// after a run: the current version, how many commits it has been stale, what the classifier would
// pick instead, and the one tap that fixes it.
//
// ⚠️ IT MUST NEVER FAIL A BUILD. Note the difference from scripts/read-version.mjs, which refuses
// to print an illegal version because a build is the last place to discover a typo. That one is a
// gate and should be. This one is a NOTICE: a stale version still builds, still installs, and is
// still the right thing to ship if the person reading the summary decides so. Turning it into a
// gate would block store deploys on an advisory opinion about release cadence.
//
// That is an INVARIANT and it was false for a day. Until 2026-08-22 only `readStaleness` was
// wrapped, and `buildNotice` ran outside it; a checkout with VERSION on disk but never committed
// produced anchor=null, complete=true, state='stale', and the table cell dereferenced it:
// `TypeError: Cannot read properties of null (reading 'slice')`, exit 1, nothing printed. Through
// the workflow's own `node … | tee -a "$GITHUB_STEP_SUMMARY"` the exit code GitHub saw was tee's
// 0 and the bytes appended were 0, so the one step whose entire purpose is to be LOUD failed
// silently and green. Now it is belt AND braces: every null the notice can meet is guarded below,
// AND the entry point at the bottom wraps the whole call so any future throw still resolves to
// text and still exits 0. The workflow step gained `set -o pipefail` so a third failure of this
// kind is visible rather than swallowed by the pipe.
//
// ⚠️ AND IT NEVER PRINTS A NUMBER IT CANNOT STAND BEHIND. The build workflows check out 50 commits,
// and in a shallow clone the anchor lookup does not merely go missing, it comes back pointing at
// the fetch horizon: measured on 2026-08-22, `git clone --depth 2` of this repo named 1eebd1f3 as
// the commit that last touched VERSION, and 1eebd1f3 touches four files under src/ and no VERSION
// at all. That produced "1 commit stale" where the answer was 3. See scripts/lib/version-history.mjs
// for the fix; when the history is truncated this says so out loud and calls the count a floor.
// And when the truncation is total, a depth-1 checkout whose floor is 0 for any repo on earth, it
// prints no count at all: a floor of 0 is not a number to stand behind, it is the lack of one.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyBump, classifyBump, displayVersion, formatVersion, parseVersion,
} from "./lib/next-version.mjs";
import { readVersionHistory } from "./lib/version-history.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The two ways to move it, in the order a person should reach for them. */
const HOW_TO_FIX =
  "**Actions → Bump VERSION → Run workflow** does it in one tap. " +
  "Locally it is `npm run version:bump`, then commit the changed `VERSION`.";

/** The story, one sentence, so the notice explains itself to somebody who was not here for it. */
const WHY =
  "Apple rejected an upload on 2026-08-21 because `VERSION` had sat at 6.3.0 for 72 commits while " +
  "CI kept rebuilding an already-approved 6.3. This notice is here so that is visible before the " +
  "upload rather than after it. It never fails a build.";

/**
 * Both halves of a version, because they are two different audiences and the notice is read by
 * somebody deciding whether to ship. The canonical three-part number is what VERSION holds; the
 * two-part rendering is what a store listing shows. See displayVersion in lib/next-version.mjs.
 */
const pair = v => {
  const canonical = `\`${formatVersion(v)}\``;
  const display = displayVersion(v);
  return display === formatVersion(v) ? canonical : `${canonical} (customers see \`${display}\`)`;
};

/**
 * The notice, as GitHub-flavoured Markdown.
 *
 * Pure: handed a reading, returns text. That keeps the workflow step down to one line and lets the
 * interesting part be exercised without a build, which matters because the two states worth
 * getting right (stale and fresh) cannot both exist in one checkout.
 */
export function buildNotice(reading) {
  if (reading.state === "unreadable") {
    // Tre's standing rule for anything with a gauge on it: an empty track beats a confident zero,
    // because a reading of 0 and a reading that failed to parse look identical to the person
    // glancing at it.
    return [
      "### VERSION staleness: no reading",
      "",
      "The commit history could not be read here, so no number is shown rather than a wrong one:",
      "",
      `> \`${reading.error}\``,
      "",
      `\`VERSION\` itself reads \`${reading.versionText}\`.`,
      "",
      WHY,
    ].join("\n");
  }

  const { current, next, kind, reason, count, anchor, truncated } = reading;

  if (reading.state === "horizon-only") {
    // ⚠️ A WARNING TRIANGLE OVER A ZERO REFUTES ITSELF. Until 2026-08-22 a depth-1 checkout
    // rendered "### ⚠️ VERSION has not moved in at least 0 commits", which raises an alarm and
    // then reports that there is nothing to be alarmed about. Worse, the 0 was not a measurement
    // that happened to come out small: it is the floor a depth-1 clone yields for EVERY repo,
    // whether VERSION moved in HEAD or, on this one measured 2026-08-22, three commits back with
    // 1687 behind it. Nothing about this checkout could have produced any other number.
    //
    // So: no triangle, no count, no classifier verdict and no proposed next version, because this
    // checkout supports none of them. Same rule as the `unreadable` branch above, and the fix on
    // offer is a deeper fetch rather than a bump nobody can show is needed.
    return [
      "### VERSION staleness: no reading (clone too shallow)",
      "",
      `This build ships ${pair(current)}. How long \`VERSION\` has held that number cannot be ` +
        "measured here: this checkout's HEAD is also its fetch horizon, so there is no commit " +
        "whose contents it is entitled to attribute, and the truth could be anything from zero " +
        "commits to the entire history.",
      "",
      "A checkout that sets no `fetch-depth` fetches exactly one commit. Both store build " +
        "workflows ask for `fetch-depth: 50`, so a run that lands here is a run that did not, and " +
        "deepening the fetch is what turns this back into a reading.",
      "",
      WHY,
    ].join("\n");
  }

  if (reading.state === "fresh") {
    // `anchor` is all but certainly a sha here — fresh means a bounded range that came back empty —
    // but "all but certainly" is what the 2026-08-22 crash was made of, so it is guarded rather
    // than assumed. See the header.
    const declaredBy = anchor ? `, declared by \`${anchor.slice(0, 8)}\`,` : ",";
    return [
      `### VERSION is current at ${formatVersion(current)}`,
      "",
      `This build ships ${pair(current)}${declaredBy} which is this build's own ` +
        "HEAD. Nothing has landed since, so there is nothing to bump.",
    ].join("\n");
  }

  const commits = `${count} commit${count === 1 ? "" : "s"}`;

  // ⚠️ `anchor` IS NULL ON TWO OF THE THREE STALE PATHS. `complete` is `anchor !== null ||
  // shallow === false` — `=== false` and not merely falsy, because `null` there means git could
  // not be asked at all — so a truncated reading ALWAYS has a null anchor, and a complete one can
  // still have one when VERSION exists on disk but appears in no commit — a fresh `git init`, a
  // worktree, a checkout of a commit that predates the file. That second case is what crashed.
  // All three are named explicitly rather than papered over with a fallback string, because the
  // three answers to "when did this last change" are genuinely different facts.
  const heading = truncated
    ? `### ⚠️ VERSION has not moved in at least ${commits}`
    : anchor
      ? `### ⚠️ VERSION is ${commits} stale`
      : "### ⚠️ VERSION is not in this repository's history";

  const lastChanged = truncated
    // "at or before", not "before": the horizon commit is the one commit whose contents this clone
    // cannot attribute, so VERSION may well have moved exactly there. Saying "before" was wrong on
    // the six-commit --depth 2 fixture, where it moved AT the horizon. See lib/version-history.mjs.
    ? "at or before this clone's horizon"
    : anchor
      ? `\`${anchor.slice(0, 8)}\`, ${commits} ago`
      : "never — `VERSION` is on disk but is in no commit here";

  // ⚠️ NO "AGAIN". This sentence used to read "This build ships 6.4.0 (customers see 6.4) again",
  // and the script cannot know that: all it knows is that VERSION has not moved. It was also
  // simply false on the tree that introduced it — `git show origin/main:VERSION` was 6.3.0 and the
  // hand-bump 3dc97033 was not an ancestor of origin/main, so 6.4 had never been uploaded at all.
  // Because package.json sits in both build workflows' `paths:` filters, the very first appearance
  // of this notice would have been on 6.4.0's first ever store build, announced with a warning
  // triangle and the word "again". A notice that cries wolf on its own first run is the failure
  // mode this repo keeps getting bitten by, so it now states only the thing it measured.
  const held = truncated
    ? `the number \`VERSION\` has held for at least ${commits}`
    : anchor
      ? `the number \`VERSION\` has held for ${commits}`
      : "a number no commit in this checkout declares";

  const lines = [
    heading,
    "",
    `This build ships ${pair(current)}, ${held}.`,
    "",
    "| | |",
    "| --- | --- |",
    `| VERSION now | ${pair(current)} |`,
    `| last changed | ${lastChanged} |`,
    `| classifier says | **${kind.toUpperCase()}**, because ${reason} |`,
    `| next would be | ${pair(next)} |`,
    "",
  ];

  if (truncated) {
    // Saying "50" when the truth was 72 is the same species of mistake as saying nothing at all.
    //
    // What this must NOT say is the old "and `VERSION` did not change in any of them". The count is
    // now taken from the horizon commit forward precisely because VERSION may have changed AT the
    // horizon and this clone cannot tell, so claiming it did not change in any of the commits read
    // is the one sentence the reading does not support.
    lines.push(
      // "could be read" rather than "were read" so the sentence survives count === 1, which the
      // horizon fix made a routine outcome rather than a corner case.
      `⚠️ Only the ${commits} after this clone's horizon could be read, and \`VERSION\` last moved at or ` +
        "before that horizon, so the count is a **floor** and so is the bump: commits past the horizon " +
        "can only add a `feat:` or a declared break, never remove one.",
      "",
    );
  }

  if (kind !== "patch") {
    // This is the exact shape of the rejection. A patch worth of drift is untidy; a minor worth of
    // drift is a customer release that nobody cut.
    lines.push(
      `⚠️ The classifier reached **${kind.toUpperCase()}** rather than patch, which means work customers ` +
        "would notice has piled up under a version number that has not moved. That is the shape of the " +
        "2026-08-21 rejection.",
      "",
    );
  }

  lines.push(HOW_TO_FIX, "", WHY);
  return lines.join("\n");
}

/** Everything the notice needs, or `unreadable` plus the reason why. */
export function readStaleness(root = ROOT) {
  let versionText = "unreadable";
  try {
    versionText = readFileSync(join(root, "VERSION"), "utf8").trim();
    const current = parseVersion(versionText);
    const { anchor, messages, complete } = readVersionHistory(root);
    const { kind, reason } = classifyBump(messages);

    // applyBump throws below 6.0.0 by design: the 9/99 carry rules do not apply to the
    // CI-run-number history that came before the scheme, and guessing at them would turn a routine
    // patch into 6.0.0. That throw lands in the catch below and prints "no reading", which is the
    // honest answer for a checkout of a commit that predates the scheme.
    const next = applyBump(current, kind);

    const truncated = !complete;
    // An empty range means one of two opposite things, and which one it is turns entirely on
    // whether the range was bounded by a real anchor.
    //
    // Bounded: VERSION moved in HEAD itself. This build IS the release and there is nothing to
    // warn about. That is `fresh`.
    //
    // Unbounded because the anchor was discarded at the horizon: HEAD is the horizon, so there is
    // not one commit here whose contents can be attributed, and the floor is 0. A floor of 0 is
    // not a small amount of staleness, it is the absence of a measurement, so it gets its own
    // state rather than being rendered as a count. See buildNotice.
    const state = messages.length === 0 ? (truncated ? "horizon-only" : "fresh") : "stale";
    return { state, versionText, current, next, kind, reason, count: messages.length, anchor, truncated };
  } catch (error) {
    // Flattened to one line. A thrown git error is "Command failed: ...\nfatal: ...\n", and a
    // newline inside a Markdown blockquote ends the blockquote, so the second half of the reason
    // would render as body text and the backtick span would swallow the paragraph after it.
    const oneLine = String(error?.message ?? error).replace(/\s+/g, " ").trim();
    return { state: "unreadable", versionText, error: oneLine };
  }
}

// Exit code is 0 on every path, deliberately: see the header. This is the one version script that
// is not allowed to take a store deploy down with it.
//
// `pathToFileURL` rather than a hand-built comparison, for the same reason read-version.mjs gives:
// on Windows the naive version yields `file://C:/…` against an actual `file:///C:/…`, this block
// silently never runs, and a script whose whole job is to print looks like a step that printed
// nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let notice;
  try {
    notice = buildNotice(readStaleness(process.argv[2] ?? ROOT));
  } catch (error) {
    // THE LAST BACKSTOP, and it exists because the invariant in the header was asserted before it
    // was true. `readStaleness` catches what git and the parser can throw; nothing caught what the
    // FORMATTER could throw, and on 2026-08-22 the formatter threw on a null anchor. Guarding that
    // one dereference fixes that one bug; this fixes the class. A notice is advisory, so the worst
    // acceptable outcome is a paragraph saying it could not be written — never a stack trace, and
    // never a non-zero exit out of a step that sits in front of a store deploy.
    const oneLine = String(error?.message ?? error).replace(/\s+/g, " ").trim();
    notice = [
      "### VERSION staleness: no reading",
      "",
      "The reading was taken but could not be rendered, which is a bug in " +
        "`scripts/version-staleness.mjs` rather than anything wrong with this build:",
      "",
      `> \`${oneLine}\``,
      "",
      WHY,
    ].join("\n");
  }
  console.log(notice);
}
