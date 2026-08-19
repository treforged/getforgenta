// @vitest-environment jsdom
// WARNING: what this protects. The app is DARK-FIRST — `:root` in index.css is the dark palette and
// `.light` overrides it — which is the opposite of the usual arrangement and therefore the thing a
// future change is most likely to get backwards. These pin the resolution rules and the one DOM
// operation, because a theme bug shows up as "the whole app is the wrong colour", which is both the
// most visible failure in the product and the least likely to be caught by any other test.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTheme, readStoredTheme, applyTheme, isThemeChoice,
  DEFAULT_THEME, THEME_STORAGE_KEY,
} from '@/lib/theme';

describe('what a choice resolves to', () => {
  it('honours an explicit choice regardless of the device', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the device on `system`, in both directions', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  // Dark is the app's own palette, so it is what an unknown signal must land on.
  it('defaults to system, which without a light signal is dark', () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(resolveTheme(DEFAULT_THEME, false)).toBe('dark');
  });
});

describe('reading a stored choice', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips each valid choice', () => {
    for (const choice of ['system', 'dark', 'light'] as const) {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
      expect(readStoredTheme()).toBe(choice);
    }
  });

  it('falls back rather than trusting junk in the store', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('guards the type at the boundary', () => {
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice('LIGHT')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(isThemeChoice(1)).toBe(false);
  });
});

describe('applying it to the document', () => {
  beforeEach(() => document.documentElement.classList.remove('light', 'dark'));

  // WARNING: the failure this is really about. Adding a class without removing the other leaves
  // BOTH on <html>, and then whichever rule comes later in the stylesheet silently wins — a switch
  // that works one way and not the other, which reads as "light mode is broken".
  it('never leaves both classes on the element', () => {
    applyTheme('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('is idempotent', () => {
    applyTheme('light');
    applyTheme('light');
    expect(document.documentElement.className.match(/light/g)).toHaveLength(1);
  });

  // So native form controls and scrollbars follow the page instead of staying dark on a white page.
  it('sets color-scheme alongside the class', () => {
    applyTheme('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
