// The email door into quick add. Would-fail: let every route skip the setup gate and "only Home"
// fails; forget to strip the param and a reload reopens the sheet ("strips only its own param").
import { describe, it, expect } from 'vitest';
import { wantsQuickAdd, withoutQuickAdd, passesOnboardingGate } from '@/lib/quick-add-link';

describe('quick-add link', () => {
  it('opens only for quickadd=1', () => {
    expect(wantsQuickAdd('?quickadd=1')).toBe(true);
    expect(wantsQuickAdd('?quickadd=0')).toBe(false);
    expect(wantsQuickAdd('?quickadd')).toBe(false);
    expect(wantsQuickAdd('')).toBe(false);
  });

  it('strips only its own param', () => {
    expect(withoutQuickAdd('?quickadd=1')).toBe('');
    expect(withoutQuickAdd('?quickadd=1&utm_source=newsletter')).toBe('?utm_source=newsletter');
  });

  it('passes the setup gate on Home only', () => {
    expect(passesOnboardingGate('/dashboard', '?quickadd=1')).toBe(true);
    expect(passesOnboardingGate('/dashboard/', '?quickadd=1')).toBe(true);
    expect(passesOnboardingGate('/dashboard', '')).toBe(false);
    expect(passesOnboardingGate('/transactions', '?quickadd=1')).toBe(false);
    expect(passesOnboardingGate('/account', '?quickadd=1')).toBe(false);
  });
});
