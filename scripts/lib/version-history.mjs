// Where "since the last release" is defined, once, for everything that asks.
//
// This repo does not tag releases, so there is no `v6.4.0` to diff against. The VERSION file IS
// the record, which makes the anchor for "since the last release" the commit that last touched
// VERSION. That definition was written inline in scripts/next-version.mjs on 2026-08-19; it now
// has a second caller (scripts/version-staleness.mjs, which both build workflows run), and two
// copies of it would be two different answers to "how stale is VERSION". The staleness notice is
// only worth printing if it agrees with the thing that does the bumping, so they read the history
// through the same function.
//
// ⚠️ IN A SHALLOW CLONE THE ANCHOR LOOKUP DOES NOT COME BACK EMPTY. IT COMES BACK WRONG, WHICH IS
// THE WORSE OF THE TWO. `git log -1 -- VERSION` can only see commits the clone actually fetched,
// and a truncated clone's oldest commit is presented as parentless, so path-limited log credits
// that commit with its entire tree. VERSION therefore looks like it was introduced at the fetch
// horizon no matter where it really moved. Measured 2026-08-22 against `git clone --depth 1` of
// this repo:
//
//     $ git -C depth1 log -1 --format=%H -- VERSION
//     7e92d93616ccdfcb83c4cc4e86c07bd3c95537b8    # `show --stat`: handoff.md only, no VERSION
//     $ git -C full   log -1 --format=%H -- VERSION
//     3dc970337238becadbaa60fa77a695af892ca2a7    # the real anchor, 3 commits before HEAD
//
// Both build workflows check out at `fetch-depth: 50`, so this is live on any run where VERSION
// has been unmoved for longer than the fetch reaches. An empty answer would have been survivable,
// because "I cannot see it" is at least true. A populated wrong one is the reassuring kind of
// wrong, and a wrong number in a staleness notice is worse than no number at all.
//
// So this returns `complete` alongside the count, and callers are expected to say out loud when
// the answer is a floor rather than a measurement, and to decline to print a number at all when
// the floor comes out at zero and so carries no information. See scripts/version-staleness.mjs.

import { execFileSync } from "node:child_process";

/**
 * Read the commit history since VERSION last moved.
 *
 * Returns:
 *   anchor      sha of the commit that last touched VERSION, or null if this clone cannot name it
 *   messages    full commit messages (not subjects) from that anchor to HEAD, newest first; when
 *               the anchor is unnameable because it sits on a truncated clone's horizon, the range
 *               starts AT that horizon, so the count is the tight floor rather than one too many.
 *               Empty on that path means HEAD IS the horizon, i.e. a floor of zero, which is the
 *               absence of a reading and not a reading of nothing: a caller must not render it as
 *               a count. Empty with a real anchor is the opposite, and means VERSION moved in HEAD
 *   complete    whether `messages` is the WHOLE list, or only as much as this clone can see
 *   shallow     whether git reports this as a shallow clone (`--depth`, `--shallow-since`)
 *
 * Full messages rather than subjects because a `BREAKING CHANGE:` footer lives in the body, and
 * classifyBump has to be able to find it.
 *
 * Throws if git itself cannot answer (not a repo, git missing). A caller that would rather print
 * "no reading" than crash is expected to catch: see scripts/version-staleness.mjs.
 */
export function readVersionHistory(root) {
  // stderr is PIPED, not inherited. Inherited, a checkout that is not a repo prints two bare
  // `fatal: not a git repository` lines into the build log from a step whose whole point is to be
  // quiet and advisory, and the reason still has to be recovered from the thrown error anyway.
  // Piped, it lands in `error.message` where the caller can put it in the notice instead.
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  const shallow = isShallow(git);
  const sha = git("log", "-1", "--format=%H", "--", "VERSION");
  let anchor = sha === "" ? null : sha;
  let onHorizon = false;

  // ⚠️ AN ANCHOR ON THE HORIZON IS NOT AN ANCHOR, AND THIS IS THE NASTY CASE. The obvious shallow
  // failure is the lookup coming back empty. The one that actually bit, measured on 2026-08-22
  // against `git clone --depth 2` of this repo, is that it comes back POPULATED and WRONG:
  //
  //     $ git -C shallow log -1 --format=%H -- VERSION
  //     1eebd1f39e770ecc25bdd26a3421bf55db3d9fc0
  //     $ git -C full show --stat 1eebd1f3        # touches four files under src/, and no VERSION
  //
  // A shallow clone's oldest commit is presented as parentless, so path-limited log treats
  // everything in its tree as introduced there. VERSION is therefore "last changed" at the
  // horizon, whatever the truth is, and the reading came out as "1 commit stale" when the real
  // answer was 3. Empty would have been survivable; confidently wrong by a factor is not.
  //
  // So an anchor sitting on the horizon is discarded as an ANSWER — it is not a fact, only an
  // artefact of where the fetch stopped — and `complete` goes false so callers hedge.
  if (anchor && shallow !== false && horizonCommits(git).includes(anchor)) {
    onHorizon = true;
    anchor = null;
  }

  // ⚠️ DISCARDING THE ANCHOR IS NOT THE SAME AS DISCARDING THE RANGE, AND CONFLATING THE TWO COST
  // AN OFF-BY-ONE. The first draft of this (2026-08-22) fell back to `HEAD`, i.e. counted the
  // whole visible history including the horizon commit itself. Fixture: six commits, VERSION moved
  // at HEAD~1, `git clone --depth 2`. It reported "has not moved in at least 2 commits" when the
  // truth was 1, and said VERSION "did not change in any of them" when it had changed in one of
  // the two. On the real store deploys that is reachable the moment VERSION last moved exactly 49
  // commits before HEAD at `fetch-depth: 50` — the boundary, which is exactly where a floor is
  // supposed to be tight.
  //
  // The horizon commit is the ONLY ambiguous one: everything after it is unambiguously "since
  // VERSION last moved", and the horizon itself either IS the anchor (so it does not count) or
  // predates it (so it does not count either). Excluding it is therefore the correct floor,
  // `messages.length - 1` against the old fallback, and it is still a floor because the true
  // anchor may sit anywhere at or before the horizon.
  const range = anchor ? `${anchor}..HEAD` : onHorizon ? `${sha}..HEAD` : "HEAD";
  const messages = git("log", range, "--format=%B%x00")
    .split("\0")
    .map(m => m.trim())
    .filter(Boolean);

  // CAN WE TRUST THAT `messages` IS EVERYTHING? There are only two ways to be sure. Either a real
  // anchor survived the check above, in which case the range is bounded at both ends by commits we
  // actually have; or the clone is not shallow, in which case HEAD's entire ancestry is present
  // and "no anchor" really does mean VERSION has never moved.
  //
  // Anything else resolves to incomplete: no usable anchor in a shallow clone, or a git too old to
  // answer `--is-shallow-repository` and so `shallow === null`. Failing toward "I might not be
  // seeing all of it" costs a hedged sentence in a run summary; failing the other way costs a
  // version number computed from a fraction of the commits it should have read.
  return { anchor, messages, complete: anchor !== null || shallow === false, shallow };
}

/**
 * The commits git presents as parentless from HEAD.
 *
 * In a full clone that is the repo's true initial commit. In a shallow one it is the fetch
 * boundary, because the shallow file makes git stop traversing there, and in a grafted one it is
 * the graft point. Plumbing rather than reading `.git/shallow` directly, so all three truncation
 * mechanisms answer through the same question.
 *
 * Only consulted when the clone may be truncated. In a complete clone this WOULD match a VERSION
 * that was added in the initial commit, and discarding that anchor would be wrong.
 */
function horizonCommits(git) {
  try {
    return git("rev-list", "--max-parents=0", "HEAD").split("\n").map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** `true`, `false`, or `null` when git could not be asked. */
function isShallow(git) {
  try {
    return git("rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return null;
  }
}
