// The rule a backdrop tap follows, and the two ways it could get it wrong.
//
// Getting it wrong in one direction throws away typed work (the bug being fixed); getting
// it wrong in the other writes a half-filled financial record, or makes an untouched form
// feel stuck. Each of those is a case below.
import { describe, it, expect } from 'vitest';
import { backdropAction } from '../form-dismiss';

const empty = { name: '', amount: '', notes: '' };

describe('backdropAction', () => {
  it('closes an untouched form — the user meant to dismiss it', () => {
    expect(backdropAction(empty, empty)).toBe('close');
  });

  it('saves as soon as anything has been typed', () => {
    expect(backdropAction({ ...empty, name: 'Sofa' }, empty)).toBe('save');
    // Even a value that would FAIL validation: routing it to the save handler is what
    // keeps the popup open with the reason, instead of discarding what was typed.
    expect(backdropAction({ ...empty, amount: '0' }, empty)).toBe('save');
  });

  it('measures against the form as OPENED, not against an empty one', () => {
    // Editing an existing record and changing nothing is pristine. Comparing to `empty`
    // here would make every edit-dismiss trigger a pointless save.
    const loaded = { name: 'Sofa', amount: '900', notes: '' };
    expect(backdropAction(loaded, loaded)).toBe('close');
    expect(backdropAction({ ...loaded, amount: '950' }, loaded)).toBe('save');
  });

  it('treats a value typed and then removed as pristine', () => {
    // Nothing is lost by closing, so the form should not insist on saving.
    expect(backdropAction({ ...empty }, empty)).toBe('close');
  });
});
