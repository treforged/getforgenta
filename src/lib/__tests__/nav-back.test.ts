// BACK MUST NEVER LEAVE THE APP.
//
// ⚠️ The case that breaks is a FRESH ENTRY — a push notification opening a lesson, a pasted URL,
// or the native WebView whose first navigation may be any route. `history.back()` there exits the
// app rather than returning to a previous screen, because there is no previous screen.
//
// ⚠️ AND `history.length` IS THE WRONG SIGNAL, which is why it is not used: it counts the whole
// tab's history including pages from before this app loaded, so on a fresh entry it is greater
// than 1 and would claim there is somewhere to go back to.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { backTarget, historyIndex, BACK_FALLBACK } from '@/lib/nav-back';

describe('backTarget', () => {
  it('⚠️ falls back INSIDE the app on a fresh entry, rather than stepping out of it', () => {
    expect(backTarget(0)).toBe(BACK_FALLBACK);
  });

  it('steps back through the router once there is history of our own', () => {
    // -1 rather than a reconstructed path on purpose: it produces a POP, which is what rule 8's
    // scroll restoration listens for. A path would PUSH and land at the top of the page.
    expect(backTarget(1)).toBe(-1);
    expect(backTarget(7)).toBe(-1);
  });

  it('treats a negative index as no history, not as history', () => {
    expect(backTarget(-1)).toBe(BACK_FALLBACK);
  });
});

describe('historyIndex', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads react-router\'s idx', () => {
    vi.stubGlobal('window', { history: { state: { idx: 3 } } });
    expect(historyIndex()).toBe(3);
  });

  it('⚠️ an unreadable or absent state reads as 0, taking the SAFE branch', () => {
    // Uncertain must route to the fallback: sending somebody to the dashboard when they could
    // have gone back is a small wrong; sending them out of the app is the bug being fixed.
    vi.stubGlobal('window', { history: { state: null } });
    expect(historyIndex()).toBe(0);
    vi.stubGlobal('window', { history: { state: { idx: 'two' } } });
    expect(historyIndex()).toBe(0);
    vi.stubGlobal('window', { history: { state: { idx: Number.NaN } } });
    expect(historyIndex()).toBe(0);
  });

  it('survives a throwing history without taking the page down', () => {
    vi.stubGlobal('window', { history: { get state() { throw new Error('blocked'); } } });
    expect(historyIndex()).toBe(0);
  });
});
