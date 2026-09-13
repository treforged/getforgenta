import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NO NAV MAY POINT AT A ROUTE THAT ONLY REDIRECTS.
 *
 * ⚠️ THIS GATE EXISTS BECAUSE I SHIPPED THE DEFECT IT CATCHES. On 2026-09-12 Forecast moved into
 * the Transactions surface and `/forecast` became a `<Navigate>`. I removed the row from
 * `MobileNav` and left the one in `Sidebar`, so on desktop the same destination existed TWICE —
 * a rail row pointing at a redirect, and a pill inside the surface it had moved into. Tre saw it
 * in a screenshot. Half-landed is worse than not started, because the app contradicts itself.
 *
 * The existing drift guard could not catch it: `nav-routes.test.ts` asserts TAB_ROOT_PATHS equals
 * `MobileNav`'s PRIMARY and never looks at `Sidebar` at all. A guard aimed at one of two lists is
 * a guard with a blind spot exactly the size of the other.
 *
 * THE RULE IS GENERAL, not a patch for this instance: a nav row whose target immediately bounces
 * the user somewhere else is a row that promises a destination the app does not have. Every future
 * "X is a panel now" move creates this same shape, and there have already been four of them —
 * Accounts, Plan, Goals and now Forecast.
 *
 * WHAT IT DOES NOT CATCH, so nobody reads more into a green: it says nothing about whether a nav
 * row's target EXISTS (a typo'd path that matches no route is a different bug), nothing about
 * order, labels, icons or whether the row renders at all, and it only reads the two nav files
 * named below. It answers one question: does any nav row point at a path App.tsx only redirects?
 */

const ROOT = process.cwd();
const APP = join(ROOT, 'src', 'App.tsx');
const NAVS = [
  join(ROOT, 'src', 'components', 'layout', 'MobileNav.tsx'),
  join(ROOT, 'src', 'components', 'layout', 'Sidebar.tsx'),
];

/** Every path App.tsx maps straight to a `<Navigate>` — i.e. a route that is not a destination. */
function redirectOnlyPaths(): string[] {
  const src = readFileSync(APP, 'utf8');
  const out: string[] = [];
  // <Route path="/x" element={<Navigate to="/y" .../>} />  — element is a Navigate and nothing else.
  const re = /<Route\s+path="([^"]+)"\s+element=\{<Navigate\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** Every `to:` a nav file declares. */
function navTargets(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/\bto:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('nav rows must point at real destinations', () => {
  it('found the routes and the navs at all — a blind scan must not read as clean', () => {
    const redirects = redirectOnlyPaths();
    // There are several established "X is a panel now" redirects; if this hits zero the regex has
    // gone stale against App.tsx and every result below is meaningless.
    expect(redirects.length).toBeGreaterThan(2);
    for (const nav of NAVS) {
      expect(navTargets(nav).length, `${nav} yielded no nav targets`).toBeGreaterThan(2);
    }
  });

  it('no nav row targets a redirect-only route', () => {
    const redirects = new Set(redirectOnlyPaths());
    const offences: string[] = [];

    for (const nav of NAVS) {
      const short = nav.slice(nav.lastIndexOf('\\') + 1).replace(/^.*\//, '');
      for (const target of navTargets(nav)) {
        if (redirects.has(target)) offences.push(`  ${short} -> "${target}" (App.tsx only redirects it)`);
      }
    }

    expect(
      offences,
      offences.length === 0 ? '' :
        `\n\nA nav row points at a route that immediately redirects, so the same destination is ` +
        `reachable two ways and the app contradicts itself. Either remove the row, or point it at ` +
        `the real destination.\n\n${offences.join('\n')}\n`,
    ).toEqual([]);
  });

  it('specifically: Forecast is gone from BOTH navs, not just the phone one', () => {
    for (const nav of NAVS) {
      expect(navTargets(nav)).not.toContain('/forecast');
    }
  });
});
