import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DOES FIRST RUN NAME THE PLACES THE APP ACTUALLY HAS?
 *
 * The 2026-09-18 onboarding inventory found this flow teaching a layout the app no longer has.
 * Three false claims were fixed then. The OMISSIONS were the larger half and were not: first
 * run named the Account tab's five sections NOWHERE, and taught the bottom bar not at all.
 *
 * ⚠️ WHY IT MATTERS MORE HERE THAN IT WOULD ELSEWHERE. Both bars are ICON-ONLY - the bottom
 * nav renders icons, and Account's section bar renders icons with `aria-label` only. So a
 * first-run user is handed ten controls carrying no words. And first run IS the whole product
 * for the dormant majority: 23 of 29 real users had not opened the app in a month when this
 * was measured, and this portfolio already records that most users only ever saw first run.
 *
 * BOTH SIDES DERIVE, which is the only version of this test worth having. The destinations
 * come from `primary-nav.ts` and from Account's own section bar; the copy comes from
 * `Onboarding.tsx`. A test that hardcoded either side would enforce nothing - rename a tab
 * tomorrow and the onboarding copy goes stale SILENTLY, which is the exact defect class this
 * repo has now paid for twice ("Budget Control" for a page titled Plan; "Activity" for a
 * surface renamed Transactions two weeks earlier).
 *
 * ⚠️ WHAT THIS DOES NOT PROVE. It does not prove the orientation is on SCREEN - it reads
 * source, and a block inside a branch that never renders would satisfy it. It does not prove
 * the wording is good, that the destination is reachable, or that anyone reads it. The
 * rendered half needs a browser AND a reviewer account genuinely in first-run state, which
 * this repo has measured is NOT verifiable from the database row - the app undoes the reset
 * within a second, so the walk must assert the SCREEN. That walk is tracked separately.
 */

const REPO = join(__dirname, '..', '..', '..');
const NAV_SRC = readFileSync(join(REPO, 'src/lib/primary-nav.ts'), 'utf8');
const ACCOUNT_SRC = readFileSync(join(REPO, 'src/pages/Account.tsx'), 'utf8');
const ONBOARDING_SRC = readFileSync(join(REPO, 'src/pages/Onboarding.tsx'), 'utf8');

/** The five bottom-bar destinations, from the one list both layouts render. */
const NAV_LABELS = [...NAV_SRC.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);

/**
 * Account's section bar. Its segments are ICONS, so the accessible name is the only name they
 * have - which is precisely why first run has to say them out loud.
 *
 * ⚠️ THE FIRST EXTRACTOR HERE WAS FRAGILE IN THE WORST DIRECTION. It required the `aria-label`
 * and the `title` to be the SAME string (a backreference). So renaming one of them made that
 * section DISAPPEAR from this list rather than mismatch - and a vanished section cannot be
 * reported missing from the onboarding copy, so the gate went GREEN on exactly the rename it
 * exists to catch. An inventory that shrinks silently is the recurring failure in this repo.
 *
 * It now takes the `aria-label` of any icon control that also carries a `title`, whatever the
 * two say, and the COUNT is asserted so a section that vanishes is itself a failure.
 */
const ACCOUNT_SECTIONS = [...ACCOUNT_SRC.matchAll(/aria-label="([^"]+)"\s*\n\s*title="[^"]*"/g)]
  .map((m) => m[1]);

/**
 * Only the finish step. Naming a destination inside a comment, or on some other step, is not
 * naming it to the user - and this file's own explanatory comments quote every one of these
 * labels, so a whole-file search would pass on a page that said nothing.
 */
const FINISH_STEP = (() => {
  const start = ONBOARDING_SRC.indexOf("{step === 'finish' && (");
  expect(start).toBeGreaterThan(-1);
  const end = ONBOARDING_SRC.indexOf("{/* Navigation.", start);
  return ONBOARDING_SRC.slice(start, end > start ? end : undefined)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
})();

describe('onboarding orientation - positive controls', () => {
  /**
   * COUNTS, not just non-emptiness. A section that vanishes from the extraction cannot be
   * reported missing from the copy, so the size of the inventory is itself load-bearing - if
   * either number moves, the copy below needs re-reading whether or not anything mismatched.
   */
  it('both derived lists are populated, and the COUNT is what it should be', () => {
    expect(NAV_LABELS).toHaveLength(5);
    expect(ACCOUNT_SECTIONS).toHaveLength(5);
  });

  /**
   * ⚠️ THIS CONTROL DELIBERATELY DOES NOT PIN SPECIFIC LABELS, and the first version did.
   *
   * Pinning `toContain('Achievements')` meant that RENAMING a section - a legitimate product
   * change - failed the CONTROL rather than the assertion. That reports "the instrument is
   * broken" for what is actually "the onboarding copy is now stale", and this repo already
   * records that a tooling fault gets re-run, then ignored, then switched off, while a finding
   * gets fixed. The control must not fail on the day the defect is real.
   *
   * So it checks the EXTRACTOR works - the shape and size of what was parsed - and leaves the
   * naming to the assertion below, where a rename correctly reads as stale copy.
   */
  it('the extractor parsed real names rather than empty strings', () => {
    for (const name of [...NAV_LABELS, ...ACCOUNT_SECTIONS]) {
      expect(name).toMatch(/^[A-Z][A-Za-z0-9 ]{1,24}$/);
    }
    expect(new Set(NAV_LABELS).size).toBe(NAV_LABELS.length);
  });

  /**
   * The slice is load-bearing: an empty or whole-file slice would make every assertion below
   * pass for ever. This file's comments quote every label, so the comment strip matters too.
   */
  it('the finish-step slice is real, bounded, and comment-free', () => {
    expect(FINISH_STEP.length).toBeGreaterThan(500);
    expect(FINISH_STEP.length).toBeLessThan(ONBOARDING_SRC.length);
    expect(FINISH_STEP).not.toContain('Where things are.');  // a comment-only mention
    expect(FINISH_STEP).toContain('Where things are');       // the rendered heading
  });
});

describe('onboarding orientation - first run names what the app has', () => {
  it('names every bottom-bar destination', () => {
    const missing = NAV_LABELS.filter((l) => !FINISH_STEP.includes(l));
    expect(missing).toEqual([]);
  });

  it('names every Account section', () => {
    const missing = ACCOUNT_SECTIONS.filter((s) => !FINISH_STEP.includes(s));
    expect(missing).toEqual([]);
  });
});
