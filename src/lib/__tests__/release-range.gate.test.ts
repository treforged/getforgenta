import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY STORE WORKFLOW RESOLVES ITS RELEASE RANGE, AND NONE OF THEM INVENTS ONE.
 *
 * ⚠️ WHAT THIS IS PROTECTING, measured on iOS run 35359868193 (build 956, 2026-09-18). Both
 * store workflows resolved "which commits is this build shipping" inline, identically:
 *
 *     if git cat-file -e "$GITHUB_EVENT_BEFORE"; then RANGE="before..sha"; else RANGE="-6"; fi
 *
 * A `workflow_dispatch` has no `before`, so every dispatched run took an ARBITRARY six-commit
 * window. That window does not only feed the coverage check - it GENERATES THE PUBLISHED
 * RELEASE NOTE. The six commits before 956's head were all handoff commits, so the store text
 * read "Maintenance release. Nothing changes in how you use Forgenta this time." on the build
 * carrying the dark-mode contrast fix Tre had asked for, and the coverage check PASSED,
 * honestly, over the same six.
 *
 * ⚠️ ON ANDROID NOBODY GETS A CHANCE TO NOTICE. iOS writes that text to a step summary for a
 * human to paste. `android-build.yml` writes it to `whatsnew/` and hands it to
 * `upload-google-play` with `tracks: production`, on a deploy step UNGATED BY EVENT. The last
 * 40 Android runs were all `push` so it never fired - a fact about history, not a guarantee
 * about the next dispatch.
 *
 * ⚠️ THE FILE LIST IS DERIVED, NEVER TYPED. This repo has filed the hand-named-inventory defect
 * repeatedly - a dependency list naming three files, a `$expectedStages` maximum, a gate whose
 * single subject was a file queued for deletion. A third store workflow added next month would
 * be invisible to a typed list, and invisible is exactly how this defect survived. So the test
 * asks the DIRECTORY which workflows generate a release note, and covers whatever it finds.
 *
 * WHAT IT CANNOT SEE, stated rather than implied: it reads YAML text, so it proves the
 * MECHANISM is wired, never that a real run resolved a sensible range. Only a dispatch does
 * that. It also says nothing about whether the note's WORDING is any good.
 */

const DIR = '.github/workflows';

/**
 * The YAML with its COMMENT LINES REMOVED, because A GREP THAT MATCHES PROSE IS NOT EVIDENCE
 * ABOUT CODE - and I committed exactly that while writing this file. The first version matched
 * the raw YAML and went RED on both workflows: not because the fallback was still live, but
 * because the comment I had just written to EXPLAIN the fix quotes the offending literal.
 * Without this, a rule that cannot be NAMED in a comment is a rule somebody satisfies by
 * deleting the comment - which would strip the only record of why the fix exists.
 */
function live(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Workflows that generate customer-facing release text - found, not named. */
function workflowsThatPublishNotes(): Array<{ file: string; body: string }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ file: f, body: readFileSync(join(DIR, f), 'utf8') }))
    .filter((w) => w.body.includes('release-notes.mjs'));
}

describe('release range - every store workflow resolves it and none invents one', () => {
  const found = workflowsThatPublishNotes();

  it('finds the workflows by what they DO, and finds more than none', () => {
    // POSITIVE CONTROL ON THE DISCOVERY ITSELF. Every assertion below is of the form "no
    // workflow does X", which an empty list satisfies perfectly - so a typo in the directory
    // name or the marker would make this whole file pass while checking nothing. This repo has
    // shipped that exact shape: a probe that piped its subject to Out-Null and went green
    // against an empty report.
    expect(found.length, `no workflow under ${DIR} references release-notes.mjs`).toBeGreaterThan(0);
    expect(found.map((w) => w.file).sort()).toContain('android-build.yml');
  });

  it.each(found.map((w) => [w.file, w.body] as const))(
    '%s does not fall back to an arbitrary commit window',
    (_file, body) => {
      // The literal that shipped the defect, plus the shape of any sibling someone might reach
      // for next: a bare `-N` count handed to the generator is never an answer to "what is in
      // this build", however large N is.
      expect(live(body)).not.toMatch(/RANGE="?-\d+"?/);
    },
  );

  it.each(found.map((w) => [w.file, w.body] as const))(
    '%s resolves its range through the shared resolver',
    (_file, body) => {
      // ONE resolver, not a copy per workflow. Two copies of a rule is how one of them rots -
      // and these two had already rotted identically, which is what made the defect two bugs
      // instead of one.
      // ⚠️ THE INVOCATION, NOT THE MENTION. A bare path substring is satisfied by the
      // workflow_dispatch input's own DESCRIPTION, which names the resolver in prose - and it
      // silently was, until the step-scoping test below found the header instead of the step.
      // Third time in this one file that a matcher hit prose rather than code.
      expect(live(body)).toContain('node scripts/resolve-release-range.mjs');
    },
  );

  it.each(found.map((w) => [w.file, w.body] as const))(
    '%s can be told the range on a dispatch, so refusing never blocks a real ship',
    (_file, body) => {
      // A gate with no honest way out is a gate somebody deletes. The resolver refuses when it
      // cannot tell what is new; `since` is the one-line answer that lets a dispatch proceed.
      expect(body).toContain('RELEASE_RANGE_SINCE');
      expect(body).toMatch(/inputs:\s*\n\s+since:/);
    },
  );

  it.each(found.map((w) => [w.file, w.body] as const))(
    '%s grants actions: read, without which the resolver can only refuse',
    (_file, body) => {
      // The resolver asks `gh` for the last successful run of this workflow. Without this
      // permission that call fails, every dispatch refuses, and the failure looks like the
      // resolver being broken rather than the job being under-permissioned.
      expect(body).toMatch(/permissions:[\s\S]{0,400}?actions:\s*read/);
    },
  );

  it('ANDROID IS THE ONE THAT MUST FAIL ON A REFUSAL, because nothing human is in its loop', () => {
    // ⚠️ THE ASYMMETRY IS THE POINT AND IT IS EASY TO "TIDY UP" WRONGLY. iOS's note is pasted
    // by hand from a step summary, so a person sees it and a refusal there is a summary, not a
    // failure - failing an upload over a missing sentence trades a communication gap for a
    // blocked release. Android hands the file straight to the Play API on a production track,
    // so a refusal MUST stop the job before the deploy step.
    const android = found.find((w) => w.file === 'android-build.yml');
    expect(android, 'android-build.yml no longer publishes notes').toBeTruthy();
    const body = android!.body;

    // ⚠️ SCOPED TO THE RELEASE-NOTE STEP ITSELF, and the first version was not. It searched
    // everything between the resolver and the deploy, swept up a NEIGHBOURING step's
    // `continue-on-error: true`, and failed - accusing a correct workflow. A check aimed at the
    // wrong object invents a defect exactly as readily as it misses one.
    const steps = body.split(/\n {6}- name: /);
    const noteStep = steps.find((s) => s.includes('node scripts/resolve-release-range.mjs'));
    expect(noteStep, 'no step resolves the release range').toBeTruthy();

    // A step that reports trouble with no route to the exit code is decoration - this repo has
    // filed that family four times. The resolver's non-zero exit has to reach an `exit 1`.
    expect(noteStep!).toMatch(/exit 1/);
    expect(noteStep!).not.toContain('continue-on-error: true');

    // And the deploy must come AFTER it, or failing the step protects nothing.
    expect(body.indexOf('upload-google-play')).toBeGreaterThan(
      body.indexOf('node scripts/resolve-release-range.mjs'),
    );
  });
});
