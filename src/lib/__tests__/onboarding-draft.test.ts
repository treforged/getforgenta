// @vitest-environment jsdom
//
// The wizard's unsent answers. Two properties matter more than the round trip: a draft belonging to
// somebody else is not readable, and nothing here ever claims setup is finished — that lives in
// `onboarding-state.ts` and only there.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from '../onboarding-draft';

const KEY = 'forgenta_onboarding_draft_v1';
const ME = 'user-me';
const THEM = 'user-them';

beforeEach(() => localStorage.clear());

describe('onboarding draft', () => {
  it('hands back what this user typed', () => {
    writeOnboardingDraft(ME, { displayName: 'Tre', weeklyGross: '1200' });
    expect(readOnboardingDraft(ME)).toEqual({ displayName: 'Tre', weeklyGross: '1200' });
  });

  it('IGNORES another user\'s draft rather than merging it — a shared device must not leak income', () => {
    writeOnboardingDraft(THEM, { displayName: 'Jordan', weeklyGross: '2400' });
    expect(readOnboardingDraft(ME)).toBeNull();
  });

  it('reads as nothing when there is no user yet', () => {
    writeOnboardingDraft(ME, { displayName: 'Tre' });
    expect(readOnboardingDraft(undefined)).toBeNull();
  });

  it('does not write without a user — an anonymous draft could never be matched back', () => {
    writeOnboardingDraft(undefined, { displayName: 'Tre' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('survives a corrupt store instead of taking the wizard down with it', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readOnboardingDraft(ME)).toBeNull();
  });

  it('clears completely — a finished or skipped setup leaves nothing to reappear', () => {
    writeOnboardingDraft(ME, { displayName: 'Tre' });
    clearOnboardingDraft();
    expect(readOnboardingDraft(ME)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('overwrites rather than accumulating, so the last answer is the answer', () => {
    writeOnboardingDraft(ME, { displayName: 'Tre' });
    writeOnboardingDraft(ME, { displayName: 'Trevor' });
    expect(readOnboardingDraft(ME)).toEqual({ displayName: 'Trevor' });
  });
});
