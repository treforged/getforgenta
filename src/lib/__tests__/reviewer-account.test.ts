import { describe, it, expect } from 'vitest';
import { REVIEWER_EMAIL, REVIEWER_FIRST_RUN_PROFILE } from '../reviewer-account';

// The reviewer reset writes REVIEWER_FIRST_RUN_PROFILE. Dropping display_name made the reviewer
// "first run" in the database yet unable to reach the wizard (measured 2026-09-13), so the exact
// shape is pinned here. A groq draft of this file was replaced: its tests asserted only that a
// constant is not '' / null / undefined, which no change to the reset could ever fail.
describe('reviewer account', () => {
  it('the first-run profile clears exactly the three columns the wizard depends on', () => {
    expect(REVIEWER_FIRST_RUN_PROFILE).toEqual({
      founder_note_seen: false,
      onboarding_completed: false,
      display_name: null,
    });
  });

  it('targets the dedicated reviewer address only', () => {
    expect(REVIEWER_EMAIL).toBe('reviewer@treforged.com');
  });
});
