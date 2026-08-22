// What the App Store and Play Store readers actually see — and how it stops
// being an engineering log.
//
// Tre, 2026-08-22: "i also want the release notes to be more catered towards
// customers. its seems too informative on item that customers dont need to
// know."
//
// THE DEFECT, in one line that really shipped to production on 2026-08-22:
//
//     - The $2 above the floor is the cushion, not surplus the cards could not absorb
//
// That is a good sentence. It is a good sentence for the next engineer. It is
// nonsense to somebody who installed a budgeting app, and it is the FIRST thing
// they read on the store listing.
//
// WHY THE OLD SCRIPT COULD NOT HAVE PREVENTED IT. scripts/release-notes.sh was
// built entirely out of REJECTION filters: a type allowlist, a scope blocklist,
// a jargon substring blocklist. Everything that survived was published verbatim.
// All three lines of the live 6.4.0 listing PASSED every one of those filters,
// because they are well-written conventional commits with no jargon in them.
// A filter can only ever suppress; it can never produce a customer sentence. So
// no amount of tightening it would have fixed this, and tightening it further is
// not the fix here either.
//
// THE FIX: THREE TIERS, MOST SPECIFIC FIRST.
//
//   1. AUTHORED, and this is the primary path. Written up for humans in
//      docs/release-notes-template.md.
//      A `Release-Note:` trailer in the commit body is published VERBATIM.
//      ONE LINE. Git reads a trailer as one line, and so does this:
//
//          fix(cash-floor): month 0 gets the same $2 cushion as every other month
//
//          Release-Note: Your first forecast month keeps the same safety cushion as every month after it.
//
//      A continuation line INDENTED by whitespace is folded in, the way
//      `git interpret-trailers` folds one. An UNINDENTED second line is not part
//      of the trailer, in git or here, and `parseTrailers` warns about it on
//      stderr rather than dropping half the sentence in silence.
//
//      It costs one line at the moment the commit is already being written, it
//      travels with the change through cherry-picks and reverts, it needs no
//      second file to keep in sync, and several commits each contributing one
//      line compose into a release naturally. It is also the only mechanism
//      here that can express MEANING, because a person wrote it.
//
//      A whole release can also be hand-written in docs/next-release-notes.txt.
//      That file is honoured ONLY when a commit in the same range touched it —
//      see the note on staleness in scripts/release-notes.mjs. The trailer is
//      the primary because it cannot go stale at all.
//
//   2. DERIVED, and it never publishes a commit subject.
//      This is the part that changed shape. A shell script — or this module —
//      cannot understand what a sentence MEANS, so it must not publish a
//      sentence it did not write. What it CAN determine reliably is the AREA of
//      the app a commit touched, from its scope and its vocabulary. So it
//      classifies each public commit into a THEME and emits a pre-written,
//      customer-legible sentence for that theme. The commit subject is evidence,
//      never output.
//
//      That is what makes the derived path safe by construction: a hostile,
//      jargon-soaked, emoji-ridden, 900-character commit subject cannot put a
//      single byte into the store listing. The worst it can do is pick a theme.
//
//   3. HONEST GENERIC.
//      A release with public work that matches no theme says so generically. A
//      release with nothing user-visible at all says THAT, rather than inventing
//      "performance improvements" nobody made. Never invent a feature.
//
// THE HARD CONSTRAINT. Google Play allows 500 bytes per locale and
// .github/workflows/android-build.yml hard-fails the build outside 20..500, so
// an output that misses the window converts a bad release note into a FAILED
// PRODUCTION DEPLOY. Everything here budgets in BYTES (the workflow measures
// with `wc -c`, which counts bytes, and one emoji is four of them), counts the
// trailing newline, and truncates on word boundaries.

/**
 * TWO NUMBERS, AND THEY ARE NOT THE SAME NUMBER.
 *
 *   - The GATE: .github/workflows/android-build.yml fails the build unless
 *     whatsnew/whatsnew-en-US measures 20..500 bytes with `wc -c`. 500 is Google
 *     Play's own per-locale cap.
 *   - The CAP below: 480, this generator's INTERNAL ceiling. It exists to leave
 *     20 bytes of headroom under the gate rather than sit exactly on it.
 *
 * So every path here emits 20..480 bytes, which is strictly inside the 20..500
 * the workflow enforces. Say both numbers when describing this; they get
 * conflated, and then a comment claims a contract nothing checks.
 */
export const MAX_TOTAL_BYTES = 480;
/** The gate's lower bound, enforced here too so a short note never fails a deploy. */
export const MIN_TOTAL_BYTES = 20;
/** A single note longer than this is doing too much for a store listing. */
export const MAX_LINE_BYTES = 200;
/** Most people skim three or four lines and stop. */
export const MAX_NOTES = 5;

/** The trailer that makes a commit author the customer wording themselves. */
export const TRAILER = "Release-Note";
/** Written on a trailer to say "this commit contributes nothing to the listing". */
export const TRAILER_NONE = /^(none|skip|-)$/i;

/** The hand-written-release escape hatch. Relative to the repo root. */
export const AUTHORED_FILE = "docs/next-release-notes.txt";

/** Commit types that can describe user-visible change. Everything else is internal. */
const PUBLIC_TYPES = /^(feat|fix|perf)(\(([^)]*)\))?!?:\s*/i;

/**
 * ASCII record/unit separators, written as escapes rather than as literal bytes
 * so this file stays plain text that an editor, a diff and a code review can all
 * read. They match `git log --format=%H%x1f%s%x1f%b%x1e` in scripts/release-notes.mjs,
 * and they are used because a commit body can legally contain anything else,
 * newlines very much included.
 */
const RECORD_SEP = "\u001e";
const FIELD_SEP = "\u001f";
/** Anything a commit body can carry that must never reach a store listing. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
/** ANSI colour/cursor sequences, removed whole rather than byte by byte. */
const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/**
 * Scopes that are not the shipped app. Real work, but not what somebody
 * installed a budgeting app to hear about.
 */
const INTERNAL_SCOPES = new Set([
  "reddit-scout", "reddit", "scout", "marketing", "deps", "deps-dev", "ci", "build",
  "infra", "tooling", "docs", "doc", "test", "tests", "release", "security", "chore",
  "version", "comments", "handoff", "graphify", "backup", "backups", "lint", "types",
]);

/**
 * A subject carrying any of these is internal work no matter how clean its type
 * and scope look.
 *
 * WHAT THIS LIST IS FOR, AND THE ASYMMETRY THAT SIZES IT (retuned 2026-08-22
 * after round-1 review). Since the derived path never publishes a commit subject,
 * this list has exactly one job left: decide whether a commit COUNTS as
 * user-visible when picking a theme. It is no longer a safety filter on published
 * text, because no subject text is published.
 *
 * That makes the two errors wildly unequal:
 *
 *   - OVER-rejecting costs a whole release its honesty. Reject the one marquee
 *     `feat` in a range and the store publishes MAINTENANCE_NOTE, which is a lie
 *     about a release that shipped a feature.
 *   - UNDER-rejecting costs a theme. The worst an internal commit can do is make
 *     the listing say "Improvements to your accounts and balances." on a release
 *     that also did internal work. Vague, true, harmless.
 *
 * So the test for every term is "could this word appear in a sentence a customer
 * would happily read about THIS app?" and anything that can is out. Round 1
 * word-anchored `export`, `import`, `type`, `types`, `policy`, `policies`,
 * `upgrade`, `merge`, `log`, `logs`, `logging`, `snapshot`, `coverage`, `unit`,
 * `interface`, `branch`, `bundle`, `comment(s)`, `agent`, `instrument`, `inline`,
 * `constant`, `grant(s)`, `annotate`, `generic` and `workflow` — every one of
 * which is ordinary product English here. `log` alone rejected "log in with Face
 * ID"; `policy` rejected an insurance policy; `snapshot` rejected the net-worth
 * snapshots this app actually ships; `coverage` rejected insurance coverage;
 * `merge` rejected merging duplicate accounts; `branch` rejected a bank branch.
 * All removed. Only unambiguously internal vocabulary stays.
 *
 * Word-anchored on purpose: a bare "lint" substring would reject "linting"'s
 * neighbours, and a bare "cd" substring would reject "cards".
 */
const JARGON = new RegExp(
  "\\b(" + [
    "handoff", "session \\d+", "fixture", "fixtures", "golden",
    "typecheck", "tsc", "eslint", "lint", "linter", "prettier", "codeql", "dependabot",
    "lockfile", "package-lock", "node_modules", "npm", "yarn", "pnpm", "vite", "rolldown",
    "refactor", "refactored", "refactoring", "rewrite",
    "test", "tests", "e2e", "vitest", "mock", "mocks", "stub", "stubs",
    "scaffold", "todo", "dead code", "unused",
    "module", "modules", "helper", "helpers", "util",
    "utils", "typescript", "enum", "generics",
    "null check", "assert", "assertion", "invariant", "regression",
    "flake", "flaky", "migration", "migrations", "schema", "rls",
    "edge function", "cron", "webhook", "webhooks", "env", "envs",
    "secret", "secrets", "api key", "apikey", "sdk", "endpoint",
    "stack trace", "debug", "telemetry", "instrumentation",
    "ci", "cd", "pipeline", "workflows", "runner", "deploy", "deployment",
    "chunk", "chunks", "tree-shake", "dependency", "dependencies",
    "bump", "revert", "reverted", "cherry-pick", "rebase", "commit",
    "docstring", "readme", "docs", "changelog",
    "claude", "opus", "sonnet", "haiku", "gemini", "anthropic", "codex",
    "supabase", "postgres", "sql", "jsonb", "pg_net", "pg_cron", "react", "react-router",
    "capacitor", "gradle", "xcode", "altool", "cocoapods", "eas",
    "internal", "internals", "under the hood", "plumbing", "wiring", "groundwork",
    "no-op", "noop", "cleanup", "tidy",
    // NOT "rename": `feat(accounts): a user may rename a linked account` is a
    // real, shipped, customer-facing feature and the word is ordinary English.
    // NOT "trace", "guard", "token", "dead", "clean up", "extract",
    // "placeholder", "constants", "policy", "type", "export", "import", "merge",
    // "upgrade", "log", "snapshot" or "coverage" either, for the same reason:
    // each one has a plain-English reading a customer sentence could carry.
  ].join("|") + ")\\b",
  "i",
);

/**
 * The themes, in match order, most specific first. `scopes` wins outright when
 * it matches; `words` is the fallback read of the subject.
 *
 * The `note` is the ONLY thing that ever reaches a customer from the derived
 * path, so each one is written to be true of any feat, fix or perf landing in
 * that area — "Improvements to X" cannot overstate a fix and cannot understate
 * a feature. Nothing here claims a capability that may not exist.
 */
export const THEMES = [
  {
    id: "forecast",
    note: "Improvements to your cash flow forecast.",
    scopes: ["forecast", "cash-floor", "cashflow", "cash-flow", "month0-drawer", "projection", "projections", "simulation", "sim"],
    words: /\b(forecast|projection|projected|cash flow|cashflow|runway|month 0|safe.?to.?spend|floor|cushion|shortfall)\b/i,
  },
  {
    id: "payoff",
    note: "Improvements to your credit card payoff plan.",
    scopes: ["debt", "consolidation", "tranches", "ranked-allocation", "payoff", "paydown", "cc", "credit", "cards", "creditcard", "credit-card", "interest"],
    words: /\b(credit cards?|payoff|paydown|debt|apr|interest|utili[sz]ation|tranche|promo|minimum payment|revolving|statement balance|avalanche|snowball|consolidat\w*)\b/i,
  },
  {
    id: "vehicles",
    note: "Improvements to vehicle and loan planning.",
    scopes: ["vehicle", "vehicles", "car", "auto", "loan", "loans", "mortgage"],
    words: /\b(vehicles?|cars?|auto loan|loans?|mortgage|amorti[sz]ation)\b/i,
  },
  {
    id: "bank",
    note: "Improvements to linking and syncing your bank accounts.",
    scopes: ["plaid", "sync", "link", "bank", "banks", "institution", "connections"],
    words: /\b(plaid|banks?|re-?link\w*|link\w*|institutions?|connection|reconnect\w*|sync\w*)\b/i,
  },
  {
    id: "transactions",
    note: "Improvements to transactions and how they are matched.",
    scopes: ["transactions", "transaction", "capture", "merchants", "merchant", "review"],
    words: /\b(transactions?|merchants?|purchases?|receipts?)\b/i,
  },
  {
    id: "bills",
    note: "Improvements to recurring bills and due dates.",
    scopes: ["bills", "bill", "recurring", "commitments", "commitment", "calendar", "subscriptions"],
    words: /\b(bills?|recurring|due dates?|subscriptions?|obligations?)\b/i,
  },
  {
    id: "goals",
    note: "Improvements to savings goals.",
    scopes: ["goals", "goal", "savings", "sinking"],
    words: /\b(goals?|savings?|sinking funds?)\b/i,
  },
  {
    id: "budget",
    note: "Improvements to budgeting and spending.",
    scopes: ["budget", "budgets", "spending", "categories", "category", "income"],
    words: /\b(budgets?|budgeting|spending|categor\w+|paychecks?|income)\b/i,
  },
  {
    id: "accounts",
    note: "Improvements to your accounts and balances.",
    scopes: ["accounts", "account", "net-worth", "networth", "balances", "balance", "assets"],
    words: /\b(accounts?|balances?|net worth)\b/i,
  },
  // WHY THIS IS FOUR THEMES AND NOT ONE (split 2026-08-22 after round-1 review).
  // Round 1 had a single `auth` theme whose sentence was "Improvements to signing
  // in and keeping your data private." and whose scopes included `settings`,
  // `profile`, `billing`, `stripe` and `subscription`. A commit renaming a field
  // on the settings page would therefore have published a PRIVACY claim to the
  // App Store. Never make a privacy claim a commit does not support: `privacy` is
  // now its own theme reachable only from a privacy scope or the word itself, and
  // the other three say only what their scope actually covers.
  {
    id: "privacy",
    note: "Improvements to privacy and security controls.",
    scopes: ["privacy", "security-ui", "encryption"],
    words: /\b(privacy|private|encrypt\w*|biometrics?|face ?id|touch ?id|passcode)\b/i,
  },
  {
    id: "signin",
    note: "Improvements to signing in and account setup.",
    scopes: ["auth", "login", "signin", "sign-in", "signup", "sign-up", "onboarding", "password"],
    words: /\b(sign ?in|sign ?up|log ?in|log ?out|sign ?out|password|onboarding|verification email)\b/i,
  },
  {
    id: "subscription",
    note: "Improvements to plans, billing, and checkout.",
    scopes: ["billing", "stripe", "subscription", "subscriptions", "plans", "pricing", "paywall", "purchase"],
    words: /\b(subscriptions?|billing|checkout|free trial|paywall|pricing)\b/i,
  },
  {
    id: "settings",
    note: "Improvements to settings and your profile.",
    scopes: ["settings", "profile", "preferences", "account-settings"],
    words: /\b(settings|preferences|your profile)\b/i,
  },
  {
    id: "display",
    note: "Improvements to charts, layout, and how numbers are shown.",
    scopes: ["ui", "ux", "charts", "chart", "dashboard", "layout", "mobile", "theme", "a11y", "design", "nav"],
    words: /\b(charts?|graphs?|dashboards?|tiles?|layout|dark mode|responsive|accessib\w+|keyboard)\b/i,
  },
  {
    // "The app starts faster and uses less memory." was the round-1 wording, and
    // it was the only note here making a MEASURED claim: two specific, testable
    // assertions that nobody measured, on a listing that has to hold up. Every
    // other theme hedges to "Improvements to X" precisely because the generator
    // cannot know the magnitude or the direction of a change. Brought in line.
    id: "perf",
    note: "Improvements to app performance.",
    scopes: ["perf", "performance"],
    words: /\b(performance|faster|speed|startup time|load time)\b/i,
  },
];

/** Public work landed, but in nothing this module can name for a customer. */
export const GENERIC_NOTE = "Bug fixes and small improvements across the app.";

/**
 * Nothing user-visible shipped. Says exactly that. The previous evergreen
 * paragraph promised "performance improvements, stability fixes" on releases
 * that contained neither, which is the one thing requirement 3 forbids.
 */
export const MAINTENANCE_NOTE =
  "Maintenance release. Nothing changes in how you use Forgenta this time. This one is quiet work behind the scenes to keep things steady.";

/**
 * The one line that exists only to make a very short AUTHORED note clear
 * MIN_TOTAL_BYTES without replacing it. See `buildNotes`.
 *
 * It has to be true of every release, so it claims nothing about this one. It
 * is never used on its own and never appears above a person's words.
 */
export const PAD_NOTE = "Thanks for using Forgenta.";

/** Bytes, because the workflow's `wc -c` counts bytes and an emoji is four. */
export function byteLength(text) {
  return Buffer.byteLength(String(text), "utf8");
}

/**
 * Cut `text` to at most `maxBytes` INCLUDING the ellipsis, on a word boundary,
 * never mid-word and never mid-codepoint.
 *
 * LINEAR, deliberately. Round 1 popped one code point at a time and re-joined and
 * re-measured the whole string on every iteration, which is O(n²) in the input:
 * one 40 kB commit body line (a pasted stack trace, a base64 blob, a `git log`
 * dump in a `Release-Note:` value) would have made a store deploy spend real time
 * in this loop. This walks the string ONCE, accumulating bytes as it goes, and
 * remembers where the last space that still fit was.
 */
export function truncateToBytes(text, maxBytes) {
  const s = String(text);
  if (byteLength(s) <= maxBytes) return s;

  const ellipsis = "…";
  const budget = maxBytes - byteLength(ellipsis);
  if (budget <= 0) return "";

  // One pass, by code point (never by UTF-16 unit, never by byte).
  let used = 0;
  let end = 0; // index into `s`, in UTF-16 units, of the first char that did not fit
  let lastSpace = -1; // index of the last space that DID fit, same units
  for (const ch of s) {
    const width = byteLength(ch);
    if (used + width > budget) break;
    if (ch === " ") lastSpace = end;
    used += width;
    end += ch.length;
  }

  // Then back off to the last whole word, if there is one worth keeping.
  let cut = lastSpace > budget / 3 ? s.slice(0, lastSpace) : s.slice(0, end);

  return cut.replace(/[\s,;:.—–-]+$/u, "") + ellipsis;
}

/**
 * Make one line safe to publish: strip control characters (a commit body can
 * carry anything), flatten whitespace, drop a bullet the author already typed,
 * and cap the length.
 */
export function sanitizeLine(text) {
  let s = String(text ?? "")
    // ANSI escape sequences go WHOLE. Stripping the ESC byte on its own would
    // leave "[31m" behind as ordinary-looking text and publish it.
    .replace(ANSI_SEQUENCE, "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // After the trim, so a bullet with leading whitespace is still recognised.
    .replace(/^[-*•]\s*/, "")
    .trim();
  if (!s) return "";
  return truncateToBytes(s, MAX_LINE_BYTES);
}

/**
 * Split `git log --format=%H%x1f%s%x1f%b%x1e` output into commits.
 * Also accepts a plain list of subjects, one per line, for the older
 * `git log --format=%s | release-notes --stdin` shape.
 */
export function parseCommitRecords(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];

  if (raw.includes(RECORD_SEP)) {
    return raw
      .split(RECORD_SEP)
      .map((rec) => rec.replace(/^[\r\n]+/, ""))
      .filter((rec) => rec.trim())
      .map((rec) => {
        const [sha = "", subject = "", body = ""] = rec.split(FIELD_SEP);
        return { sha: sha.trim(), subject: subject.trim(), body };
      })
      .filter((c) => c.subject);
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((subject) => ({ sha: "", subject, body: "" }));
}

/** A `Release-Note:` line. `^\s*` so an indented trailer is still a trailer. */
const TRAILER_LINE = new RegExp(`^\\s*${TRAILER}\\s*:\\s*(.*)$`, "i");
/** Any git trailer at all (`Signed-off-by:`, `Co-Authored-By:`, `Fixes:`). */
const ANY_TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*\s*:\s/;
/** A folded continuation: git's own trailer parser continues on indented lines. */
const FOLDED_CONTINUATION = /^[ \t]+\S/;
/** A value that ends mid-sentence has probably been wrapped, not finished. */
const ENDS_A_SENTENCE = /[.!?:;)"”'’]$/u;

/**
 * `Release-Note:` trailers in one commit body, in the order written, with a
 * warning for every one that looks like it was WRAPPED rather than written.
 *
 * WHY THIS EXISTS (added 2026-08-22; round 1 shipped the bug it fixes). The
 * documented worked example in docs/release-notes-template.md was itself wrapped
 * across two lines, and round 1 read a single line only. The example for the
 * mechanism the design calls "the primary path" therefore published a truncated
 * half-sentence and dropped the rest without a word. Two changes close that:
 *
 *   1. FOLDING IS SUPPORTED, the way git's own trailer parser supports it: a
 *      following line INDENTED by whitespace continues the value. This is the
 *      RFC-822 convention `git interpret-trailers` follows, so a note wrapped
 *      the way git expects now means what its author meant.
 *   2. AN UNINDENTED WRAP IS DETECTED AND SAID OUT LOUD. Git does not treat an
 *      unindented following line as a continuation and neither does this, because
 *      quietly guessing would swallow a genuine paragraph. But the value is then
 *      almost certainly cut short, so the caller gets a warning it prints to
 *      stderr. Losing half a sentence silently is what made this a blocker; a
 *      release note that is wrong is survivable, one nobody can see going wrong
 *      is not.
 *
 * @returns {{ notes: string[], warnings: string[] }}
 */
export function parseTrailers(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const notes = [];
  const warnings = [];

  let i = 0;
  while (i < lines.length) {
    const m = TRAILER_LINE.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }

    let value = m[1].trim();
    i += 1;

    // (1) Fold indented continuation lines into the value.
    while (
      i < lines.length &&
      FOLDED_CONTINUATION.test(lines[i]) &&
      !TRAILER_LINE.test(lines[i])
    ) {
      value = `${value} ${lines[i].trim()}`;
      i += 1;
    }

    // (2) Whatever follows is NOT part of the value. Say so when it looks like
    //     the author meant it to be.
    const next = i < lines.length ? lines[i] : "";
    const looksWrapped =
      next.trim() !== "" &&
      !/^\s/.test(next) &&
      !ANY_TRAILER_LINE.test(next) &&
      (!ENDS_A_SENTENCE.test(value) || /^[a-z]/.test(next.trim()));
    if (looksWrapped) {
      warnings.push(
        `${TRAILER}: looks wrapped onto the next line, and git does not read it that way. ` +
          `Published: "${value}". DROPPED: "${sanitizeLine(next)}". ` +
          `Keep the note on ONE line, or indent the continuation. See docs/release-notes-template.md.`,
      );
    }

    if (!value || TRAILER_NONE.test(value)) continue;
    const clean = sanitizeLine(value);
    if (clean) notes.push(clean);
  }

  return { notes, warnings };
}

/** `Release-Note:` values from one commit body, in the order written. */
export function trailersFrom(body) {
  return parseTrailers(body).notes;
}

/** Every authored note in the range, newest commit first, deduped, plus warnings. */
export function collectAuthored(commits) {
  const seen = new Set();
  const notes = [];
  const warnings = [];
  for (const c of commits) {
    const parsed = parseTrailers(c.body);
    warnings.push(...parsed.warnings);
    for (const note of parsed.notes) {
      const key = note.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push(note);
    }
  }
  return { notes, warnings };
}

/** Every authored note in the range, newest commit first, deduped. */
export function authoredNotes(commits) {
  return collectAuthored(commits).notes;
}

/**
 * Read a commit's conventional prefix. Returns null when the subject is not a
 * public type at all — which is the default, and is why chore/docs/refactor/style
 * and anything with no prefix never reach a customer.
 */
export function publicPrefix(subject) {
  const m = PUBLIC_TYPES.exec(String(subject ?? ""));
  if (!m) return null;
  return { type: m[1].toLowerCase(), scope: (m[3] ?? "").trim().toLowerCase(), rest: String(subject).slice(m[0].length) };
}

/**
 * The theme a commit belongs to, or null if it must not influence the listing.
 * NOTE what this does NOT return: the subject. The subject is evidence used to
 * pick a pre-written sentence and is never itself published.
 */
export function classify(subject) {
  const pre = publicPrefix(subject);
  if (!pre) return null;
  if (pre.scope && INTERNAL_SCOPES.has(pre.scope)) return null;
  if (JARGON.test(pre.rest)) return null;
  // A subject that reads like a path, a hash, a symbol name or a diff is
  // internal whatever else it says.
  if (/[/\\]|\b[0-9a-f]{7,40}\b|\w+\(\)|[a-z]+[A-Z]\w*|\w+_\w+|`|\{|\}|=>|<\w+>/.test(pre.rest)) return null;

  for (const theme of THEMES) {
    if (pre.scope && theme.scopes.includes(pre.scope)) return theme.id;
  }
  for (const theme of THEMES) {
    if (theme.words.test(pre.rest)) return theme.id;
  }
  if (pre.type === "perf") return "perf";
  return "general";
}

/** Theme sentences for a range, in the order the themes first appear. */
export function derivedNotes(commits) {
  const seen = new Set();
  const out = [];
  let sawPublic = false;

  for (const c of commits) {
    const id = classify(c.subject);
    if (!id) continue;
    sawPublic = true;
    if (id === "general" || seen.has(id)) continue;
    seen.add(id);
    const theme = THEMES.find((t) => t.id === id);
    if (theme) out.push(theme.note);
  }

  if (out.length === 0 && sawPublic) out.push(GENERIC_NOTE);
  return out;
}

/** Assemble bullets into the final block, never exceeding MAX_TOTAL_BYTES. */
function assemble(notes) {
  let text = "";
  let count = 0;
  for (const note of notes) {
    if (count >= MAX_NOTES) break;
    const candidate = `- ${note}\n`;
    if (byteLength(text) + byteLength(candidate) > MAX_TOTAL_BYTES) {
      // A single first line that cannot fit is trimmed rather than dropped;
      // dropping it would leave an empty release note and fail the build.
      if (text === "") {
        const room = MAX_TOTAL_BYTES - byteLength("- \n");
        text = `- ${truncateToBytes(note, room)}\n`;
        count += 1;
      }
      break;
    }
    text += candidate;
    count += 1;
  }
  return text;
}

/**
 * The whole decision, in one place.
 *
 * @param {object} input
 * @param {Array<{subject:string, body:string}>} input.commits  newest first
 * @param {string|null} [input.authoredFile]  contents of docs/next-release-notes.txt,
 *        ONLY when a commit in this range touched it (see scripts/release-notes.mjs)
 * @returns {{ text: string, source: string, bytes: number, warnings: string[] }}
 */
export function buildNotes({ commits = [], authoredFile = null } = {}) {
  const { notes: authored, warnings } = collectAuthored(commits);

  const fileLines = String(authoredFile ?? "")
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);

  /**
   * A PERSON'S WORDS ARE NEVER REPLACED (fixed 2026-08-22; round 1 replaced
   * them). The minimum is 20 bytes, so a short authored note like
   * `Release-Note: Now on iPad.` produced a 15-byte block, and round 1's closure
   * swapped the whole thing for MAINTENANCE_NOTE: the store then published the
   * exact OPPOSITE of what the author wrote, on a release they had just told it
   * was worth announcing.
   *
   * So a short authored block is PADDED UNDERNEATH instead, first with the themes
   * genuinely derived from the same range, then with PAD_NOTE, which claims
   * nothing about the release. The author's line stays first and stays intact.
   * Only paths with no human wording in them can fall back to MAINTENANCE_NOTE.
   */
  const finish = (lines, source, { byAPerson = false } = {}) => {
    let notes = [...lines];
    let out = assemble(notes);

    if (byteLength(out) >= MIN_TOTAL_BYTES) return { text: out, source, bytes: byteLength(out), warnings };

    if (!byAPerson) {
      out = `${MAINTENANCE_NOTE}\n`;
      return { text: out, source: "maintenance", bytes: byteLength(out), warnings };
    }

    for (const filler of [...derivedNotes(commits), PAD_NOTE]) {
      if (notes.includes(filler)) continue;
      notes.push(filler);
      out = assemble(notes);
      if (byteLength(out) >= MIN_TOTAL_BYTES) break;
    }

    // Only reachable if MAX_NOTES lines were all so short they still miss the
    // minimum. Drop the LAST line to make room for the pad, never the first.
    if (byteLength(out) < MIN_TOTAL_BYTES) {
      out = assemble([...notes.slice(0, MAX_NOTES - 1), PAD_NOTE]);
    }

    return { text: out, source: `${source}+padded`, bytes: byteLength(out), warnings };
  };

  if (fileLines.length > 0) return finish(fileLines, "file", { byAPerson: true });
  if (authored.length > 0) return finish(authored, "authored", { byAPerson: true });

  const derived = derivedNotes(commits);
  if (derived.length > 0) return finish(derived, "derived");

  const out = `${MAINTENANCE_NOTE}\n`;
  return { text: out, source: "maintenance", bytes: byteLength(out), warnings };
}
