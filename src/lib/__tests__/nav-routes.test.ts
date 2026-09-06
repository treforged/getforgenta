// @vitest-environment jsdom
//
// (jsdom because the drift assertion imports the real MobileNav, which pulls in localStorage. The
// alternative — asserting against the file's source text — would pass against a renamed constant.)
// A PUSHED SCREEN GETS A WAY BACK; A TAB ROOT MUST NOT.
//
// ⚠️ Offering "back" on a tab root offers to leave a place there is nothing to go back from. The
// five tab roots are the bottom bar's own destinations, and the last test here is the one that
// matters long-term: it asserts this list still equals MobileNav's PRIMARY, so a sixth tab cannot
// be added without this file noticing.

import { describe, it, expect } from 'vitest';
import { isPushedRoute, TAB_ROOT_PATHS } from '@/lib/nav-routes';
import { PRIMARY } from '@/components/layout/MobileNav';

describe('isPushedRoute', () => {
  it('every tab root is NOT pushed', () => {
    for (const p of TAB_ROOT_PATHS) expect(isPushedRoute(p)).toBe(false);
  });

  it('the screens reachable only from the drawer ARE pushed', () => {
    // These are the three that had no way back at all before 2026-09-06.
    for (const p of ['/settings', '/ai', '/premium']) expect(isPushedRoute(p)).toBe(true);
  });

  it('⚠️ an unknown route counts as pushed, so a NEW screen gets its way out for free', () => {
    // The opposite default ships a screen with no exit, which is the bug being fixed.
    expect(isPushedRoute('/something-nobody-has-built-yet')).toBe(true);
  });

  it('the landing route is not pushed', () => {
    expect(isPushedRoute('/')).toBe(false);
  });

  it('⚠️ a trailing slash does not turn a tab root into a pushed screen', () => {
    // Pasted links and some native shells add one. `/debt/` is the same screen as `/debt`.
    expect(isPushedRoute('/debt/')).toBe(false);
    expect(isPushedRoute('/settings/')).toBe(true);
  });
});

describe('the two lists cannot drift', () => {
  it('⚠️ TAB_ROOT_PATHS still matches the bottom bar it describes', () => {
    expect([...TAB_ROOT_PATHS]).toEqual(PRIMARY.map(p => p.to));
  });
});
