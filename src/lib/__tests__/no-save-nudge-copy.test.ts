// Proposal D: the nudge asks for one quick add, not the full wizard. Would-fail: point the link
// back at /onboarding and "links to quick add" fails; drop the unsubscribe line and both footer
// cases fail.
import { describe, it, expect } from 'vitest';
import { buildNudgeText, quickAddLink, NUDGE_SUBJECT } from '../../../supabase/functions/_shared/no-save-nudge-copy';
import { passesOnboardingGate, wantsQuickAdd } from '@/lib/quick-add-link';

const APP = 'https://app.example.invalid';

describe('no-save-nudge copy', () => {
  it('links to quick add, not to the wizard', () => {
    const text = buildNudgeText(APP, 'help@example.invalid', null);
    expect(text).toContain(`Add a purchase: ${APP}/dashboard?quickadd=1`);
    expect(text).not.toContain('/onboarding');
    expect(text).toMatch(/\+ at the bottom/);
    expect(text).toMatch(/five taps/);
    expect(NUDGE_SUBJECT.length).toBeGreaterThan(0);
  });

  it('the link it sends is the one the app opens quick add for, through the setup gate', () => {
    const u = new URL(quickAddLink(`${APP}/`));
    expect(u.pathname).toBe('/dashboard');
    expect(wantsQuickAdd(u.search)).toBe(true);
    expect(passesOnboardingGate(u.pathname, u.search)).toBe(true);
  });

  it('keeps a working unsubscribe with or without the one-click secret', () => {
    expect(buildNudgeText(APP, 'help@example.invalid', null)).toContain('reply with "unsubscribe" or write to help@example.invalid');
    expect(buildNudgeText(APP, 'help@example.invalid', 'https://u.invalid/x')).toContain('Unsubscribe in one click: https://u.invalid/x');
  });
});
