// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIMARY_NAV } from '../primary-nav';
import { PRIMARY } from '@/components/layout/MobileNav';

/**
 * THE DESKTOP RAIL AND THE PHONE BAR OFFER THE SAME DESTINATIONS, IN THE SAME ORDER.
 *
 * Tre, 2026-09-15: *"The tabs or selections for the left side when it's on a bigger screen are
 * different from the selections when it's on mobile."* Measured before fixing — the rail declared
 * seven destinations and the bar five, three were desktop-only, one mobile-only, and two shared
 * destinations carried different labels at different widths.
 *
 * ⚠️ THE SETS ARE EQUAL BY CONSTRUCTION, NOT BY COMPARISON, and that distinction is the point.
 * This repo already had a test comparing two hand-declared lists — `nav-routes.test.ts` compared
 * `TAB_ROOT_PATHS` against `MobileNav`'s PRIMARY and never read the rail at all — so when Forecast
 * left the bar and stayed in the rail, the same destination existed twice and every test passed.
 * Both components now map over `PRIMARY_NAV`.
 *
 * SO WHAT IS LEFT TO GUARD IS THE WAY BACK: a component re-declaring destinations of its own. That
 * is what the source assertions below are for, and they are the only assertions here that can
 * actually fail — which is stated rather than hidden, because a test that cannot fail is not a
 * test. `expect(PRIMARY).toBe(PRIMARY_NAV)` is an identity check, kept as the POSITIVE CONTROL
 * that the re-export is still a re-export and not a copy.
 *
 * WHAT IT DOES NOT CATCH: whether either component RENDERS every item (a filter, a flag or an
 * early return can still drop one — `npm run check:rail` presses the rail and reads its labels
 * back), the order things appear on screen if a component sorts, styling, or any secondary
 * navigation such as the hamburger drawer.
 */

const SIDEBAR = join(process.cwd(), 'src', 'components', 'layout', 'Sidebar.tsx');
const MOBILE = join(process.cwd(), 'src', 'components', 'layout', 'MobileNav.tsx');

/** A destination literal is `{ to: '/something'` — the shape both files used to declare. */
function declaredDestinations(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  // Comments quote the old lists on purpose (they record what was measured), so strip them first:
  // a doc comment naming `/premium` is documentation, not a declaration.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/\{\s*to:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('primary navigation parity', () => {
  it('the phone bar re-exports the shared list rather than copying it', () => {
    // POSITIVE CONTROL for the two absence assertions below: if this is ever a copy, they are
    // asserting nothing and the sets can drift while everything stays green.
    expect(PRIMARY).toBe(PRIMARY_NAV);
  });

  it('the shared list is non-empty and every entry has a route and a label', () => {
    // An empty list satisfies "neither component declares destinations" perfectly.
    expect(PRIMARY_NAV.length).toBeGreaterThan(3);
    for (const d of PRIMARY_NAV) {
      expect(d.to.startsWith('/'), `${d.to} is not a route`).toBe(true);
      expect(d.label.trim().length, `${d.to} has no label`).toBeGreaterThan(0);
    }
  });

  for (const [name, file] of [['the desktop rail', SIDEBAR], ['the phone bar', MOBILE]] as const) {
    it(`${name} declares no destinations of its own`, () => {
      const declared = declaredDestinations(file);
      expect(
        declared,
        declared.length === 0 ? '' :
          `\n\n${name} declares ${declared.length} destination(s) in its own source: ` +
          `${declared.join(', ')}.\n\nThat is how the two navigations drifted apart in the first ` +
          `place. Add or remove the destination in src/lib/primary-nav.ts instead, so both widths ` +
          `change together.\n`,
      ).toEqual([]);
    });
  }
});
