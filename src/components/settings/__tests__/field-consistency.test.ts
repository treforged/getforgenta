// EVERY TEXT FIELD ON THE SETTINGS/ACCOUNT SURFACE IS THE SAME FIELD, AND EVERY ONE SHOWS FOCUS.
//
// Tre, 2026-09-13: "they dont look like normal buttons. consider design of other apps when thinking
// about our design always. and consistency across tabs." The deliverable he asked for includes a
// COUNT, so this gate is a count rather than a judgement - that is the only form of this check that
// survives a busy week.
//
// THE COUNT WAS 2 ACROSS 3 ADJACENT FIELDS, AND THE DRIFT HAD ALREADY COST A REAL DEFECT. The
// username field carried `outline-none` with NOTHING replacing it, so it had no visible focus state
// at all: a keyboard or switch user tabbing into "Add a friend" landed on an invisible cursor. The
// email and invite-code fields beneath it were fine. That is how this survives review - the screen
// looks consistent until somebody presses Tab, and nobody presses Tab in a screenshot.
//
// RE-AIMED 2026-09-17, AND THE REASON GENERALISES. Until today this gate had exactly ONE subject:
// `FriendLink.tsx` - a component NOTHING MOUNTS. So five assertions about focus rings and
// hand-rolled field classes were pointed at dead code, and deleting that dead component (queued,
// and correct to delete) would have RETIRED THE WHOLE GATE SILENTLY. Nothing would have gone red;
// the suite would simply have got smaller, which this repo has already measured as the failure that
// looks exactly like a pass.
// A GATE AIMED AT ONE HAND-NAMED FILE DIES WITH THAT FILE. The subject list is now DERIVED - every
// `src/components/settings/*.tsx` that contains an `<input` - so a new field-bearing component is
// covered the day it lands, and no deletion can quietly empty the inventory.
//
// WHY A SOURCE SCAN AND NOT A RENDER, stated rather than implied. jsdom returns '' for class-driven
// computed styles and has no layout, so asserting a focus ring there would be green over nothing -
// this repo has already measured that trap on scroll geometry and again on the color-scheme defect.
// A source scan can prove the MECHANISM is declared. It cannot prove the ring is visible, that its
// contrast is adequate, or that the fields line up; those need a real browser.
//
// WHAT THIS DOES NOT CATCH: fields built at runtime, fields outside `src/components/settings`,
// `<textarea>`/`<select>`, and anything about spacing or alignment.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIELD_INPUT, FIELD_WRAPPER, FIELD_INPUT_BARE, FIELD_INPUT_COMPACT, FIELD_BASE, FIELD_SELECT } from '@/components/shared/field-classes';

/** Every `<input ... />` element in a source file, as raw text. */
function inputs(src: string): string[] {
  return src.match(/<input\b[\s\S]*?\/>/g) ?? [];
}

/**
 * The subjects, DERIVED rather than hand-named: every settings component that actually renders an
 * `<input`. A hand-typed list is blind to the component nobody added to it, and - as the header
 * says - dies outright with whichever file it names.
 */
const SETTINGS_DIR = resolve(__dirname, '..');
const SUBJECTS: { name: string; src: string; inputs: string[] }[] = readdirSync(SETTINGS_DIR)
  .filter(f => f.endsWith('.tsx'))
  .map(f => ({ name: f, src: readFileSync(resolve(SETTINGS_DIR, f), 'utf8') }))
  .map(f => ({ ...f, inputs: inputs(f.src) }))
  .filter(f => f.inputs.length > 0);

const INVENTORY = SUBJECTS.map(f => `${f.name} (${f.inputs.length})`).join(', ');

describe('settings text fields are one field, not several', () => {
  it('examines a NON-EMPTY inventory of real, mounted components', () => {
    // THE POSITIVE CONTROL ON THE INSTRUMENT ITSELF, and the whole reason this gate was re-aimed.
    // "0 violations" and "0 files were examined" are the same silence. A derived list that matched
    // nothing - because the glob broke, or because the last subject was deleted - would make every
    // assertion below vacuously true and print a confident pass.
    expect(SUBJECTS.length, `settings components carrying an <input: ${INVENTORY || '(none)'}`)
      .toBeGreaterThanOrEqual(3);
    const total = SUBJECTS.reduce((n, f) => n + f.inputs.length, 0);
    expect(total, `inputs examined across ${SUBJECTS.length} files: ${INVENTORY}`)
      .toBeGreaterThanOrEqual(4);
  });

  it('every input uses a SHARED class constant - none carries a hand-rolled class string', () => {
    for (const f of SUBJECTS) {
      const handRolled = f.inputs.filter(el => /className="[^"]*(?:bg-secondary|bg-transparent)/.test(el));
      expect(handRolled, `${f.name} hand-rolls field classes:\n${handRolled.join('\n\n')}`).toEqual([]);
    }
  });

  it('NO input strips its outline without replacing it — the defect that shipped', () => {
    // `outline-none` is legitimate ONLY on the bare input inside a wrapper, where the wrapper owns
    // the ring. Anywhere else it removes the focus indicator outright.
    for (const f of SUBJECTS) {
      for (const el of f.inputs) {
        if (!/outline-none/.test(el)) continue;
        expect(el, `${f.name}: an input strips its outline inline:\n${el}`).toMatch(/FIELD_INPUT_BARE/);
      }
    }
  });

  it('the wrapper carries focus-WITHIN, because it never receives focus itself', () => {
    // ⚠️ ASSERTED ON THE RESOLVED VALUE, NOT ON THE SOURCE TEXT. The first version of this test read
    // the literal `export const` line and failed on correct code, because the ring arrives through
    // a template interpolation and never appears literally in that line. A gate aimed at how a
    // value is SPELLED rather than at what it IS is wrong every time somebody refactors a constant
    // — and a gate that is wrong on ordinary work is one people switch off on the day it matters.
    expect(FIELD_WRAPPER).toContain('focus-within:ring-1');
    expect(FIELD_WRAPPER).toContain('focus-within:ring-ring');
    // A plain `focus:` on a wrapper never matches, so the field would silently keep the bug.
    expect(FIELD_WRAPPER.replace(/focus-within:/g, '')).not.toMatch(/\bfocus:ring/);
  });

  it('the bare input is ONLY ever paired with the wrapper that owns its ring', () => {
    let bareTotal = 0;
    for (const f of SUBJECTS) {
      const bare = (f.src.match(/FIELD_INPUT_BARE/g) ?? []).length;
      const wrapper = (f.src.match(/FIELD_WRAPPER/g) ?? []).length;
      bareTotal += bare;
      // One wrapper per bare input. A bare input without one has no border and no focus ring at all.
      // A file using no bare input at all is fine - 0 === 0 - which is why the app-wide floor below
      // exists: without it, every subject dropping the bare pattern would satisfy this vacuously.
      expect(wrapper, `${f.name}: ${bare} bare input(s) but ${wrapper} wrapper(s)`).toBe(bare);
    }
    expect(bareTotal, `no subject uses the bare-input/wrapper pairing at all: ${INVENTORY}`)
      .toBeGreaterThan(0);
  });

  it('every field constant that owns a border also owns a focus ring', () => {
    for (const [name, value] of [
      ['FIELD_INPUT', FIELD_INPUT],
      ['FIELD_WRAPPER', FIELD_WRAPPER],
      // Added 2026-09-17 with the constant itself. A new bordered field constant that nobody adds
      // here is a new field that can ship with no focus ring - which is precisely how
      // `GlobalStandingCard` got one.
      ['FIELD_INPUT_COMPACT', FIELD_INPUT_COMPACT],
      ['FIELD_BASE', FIELD_BASE],
      ['FIELD_SELECT', FIELD_SELECT],
    ] as const) {
      expect(value, `${name} declares no focus ring`).toContain('ring-ring');
      expect(value, `${name} has no surface`).toContain('bg-secondary');
    }
    // The bare input is the ONE that legitimately has neither — its wrapper owns both. Asserted so
    // the exception stays deliberate and visible, rather than looking like an omission somebody
    // "fixes" later by adding a second ring inside the box.
    expect(FIELD_INPUT_BARE).toContain('bg-transparent');
    expect(FIELD_INPUT_BARE).not.toContain('ring-ring');
  });
});
