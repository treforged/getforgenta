// EVERY TEXT FIELD ON THE FRIENDS SURFACE IS THE SAME FIELD, AND EVERY ONE SHOWS FOCUS.
//
// Tre, 2026-09-13: "they dont look like normal buttons. consider design of other apps when thinking
// about our design always. and consistency across tabs." The deliverable he asked for includes a
// COUNT, so this gate is a count rather than a judgement — that is the only form of this check that
// survives a busy week.
//
// ⚠️ THE COUNT WAS 2 ACROSS 3 ADJACENT FIELDS, AND THE DRIFT HAD ALREADY COST A REAL DEFECT. The
// username field carried `outline-none` with NOTHING replacing it, so it had no visible focus state
// at all: a keyboard or switch user tabbing into "Add a friend" landed on an invisible cursor. The
// email and invite-code fields beneath it were fine. That is how this survives review — the screen
// looks consistent until somebody presses Tab, and nobody presses Tab in a screenshot.
//
// ⚠️ WHY A SOURCE SCAN AND NOT A RENDER, stated rather than implied. jsdom returns '' for
// class-driven computed styles and has no layout, so asserting a focus ring there would be green
// over nothing — this repo has already measured that trap on scroll geometry and again on the
// color-scheme defect. A source scan can prove the MECHANISM is declared. It cannot prove the ring
// is visible, that its contrast is adequate, or that the fields line up; those need a real browser.
//
// WHAT THIS DOES NOT CATCH: fields built at runtime, fields in other files, and anything about
// spacing or alignment.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIELD_INPUT, FIELD_WRAPPER, FIELD_INPUT_BARE } from '@/components/shared/field-classes';

const friendLink = readFileSync(resolve(__dirname, '../FriendLink.tsx'), 'utf8');

/** Every `<input ... />` element in a source file, as raw text. */
function inputs(src: string): string[] {
  return src.match(/<input\b[\s\S]*?\/>/g) ?? [];
}

describe('FriendLink text fields are one field, not several', () => {
  it('every input uses a SHARED class constant — none carries a hand-rolled class string', () => {
    const found = inputs(friendLink);
    // ⚠️ Assert the inventory is NON-EMPTY first. A regex that stopped matching — after a refactor
    // to a different element, say — would make every assertion below vacuously true, and
    // "0 violations" would be indistinguishable from "0 inputs were examined".
    // 2 since 2026-09-15: the email-invite field was removed (usernames only), leaving the
    // username field and the invite-code field. The floor tracks the real count deliberately -
    // a floor left above it would fail every run, and one left far below it stops guarding.
    expect(found.length).toBeGreaterThanOrEqual(2);

    const handRolled = found.filter(el => /className="[^"]*(?:bg-secondary|bg-transparent)/.test(el));
    expect(handRolled, `hand-rolled field classes:\n${handRolled.join('\n\n')}`).toEqual([]);
  });

  it('NO input strips its outline without replacing it — the defect that shipped', () => {
    // `outline-none` is legitimate ONLY on the bare input inside a wrapper, where the wrapper owns
    // the ring. Anywhere else it removes the focus indicator outright.
    for (const el of inputs(friendLink)) {
      if (!/outline-none/.test(el)) continue;
      expect(el, `an input strips its outline inline:\n${el}`).toMatch(/FIELD_INPUT_BARE/);
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
    const bare = (friendLink.match(/FIELD_INPUT_BARE/g) ?? []).length;
    const wrapper = (friendLink.match(/FIELD_WRAPPER/g) ?? []).length;
    expect(bare).toBeGreaterThan(0);
    // One wrapper per bare input. A bare input without one has no border and no focus ring at all.
    expect(wrapper).toBe(bare);
  });

  it('every field constant that owns a border also owns a focus ring', () => {
    for (const [name, value] of [
      ['FIELD_INPUT', FIELD_INPUT],
      ['FIELD_WRAPPER', FIELD_WRAPPER],
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
