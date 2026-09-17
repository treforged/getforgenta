import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTINGS_IA,
  ACCOUNT_PAGE_ONLY,
  TRACKED_COMPONENTS,
  declaredPanelFor,
  type SettingsPanelKey,
} from '../settings-ia';

/**
 * THE GATE FOR "this setting is in the wrong place".
 *
 * Tre reported three misplacements on 2026-09-12 and said the same is probably true of other
 * tabs. Without a declared map, the only detector is him noticing — which is what happened
 * three times with the notched toggles. `settings-ia.ts` holds the map and the reasoning; this
 * asserts the page agrees with it.
 *
 * ⚠️ INSTRUMENT CHOICE, measured rather than assumed — the lesson from the concentricity gate.
 * Settings.tsx pulls in Stripe Elements, Supabase, four contexts and native Capacitor checks, and
 * this repo's CLAUDE.md already records that jsdom reports no usable geometry. Rendering it would
 * need so much mocking that the test would be asserting against the mocks, not the page. The
 * question here is structural — "which panel predicate encloses this section" — and that is
 * present and unambiguous in the source, so the source is the honest place to read it.
 *
 * WHAT IT DOES NOT CATCH, so nobody infers more: it does not prove a section RENDERS (a false
 * `isDemo`/`isNative` guard can still hide one), it does not check order within a panel, it says
 * nothing about wording, layout or whether a control works, and it only tracks the components
 * named in TRACKED_COMPONENTS. It answers exactly one question: is each declared setting
 * enclosed by the panel it is declared under?
 */

const SETTINGS = join(process.cwd(), 'src', 'pages', 'Settings.tsx');

interface Found { item: string; panel: string }

/**
 * Attribute every heading and tracked component to the `{panel === '...'}` block enclosing it.
 * The panel blocks in this file are siblings at the top level of the returned tree, so splitting
 * on the predicate attributes each region correctly. The first test below PINS that assumption.
 */
function scanSettings(): { found: Found[]; panelBlocks: string[] } {
  const src = readFileSync(SETTINGS, 'utf8');
  const parts = src.split(/\{panel === '(\w+)'/);
  const found: Found[] = [];
  const panelBlocks: string[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const panel = parts[i];
    const body = parts[i + 1] ?? '';
    panelBlocks.push(panel);

    const headings = [
      ...body.matchAll(/<h2[^>]*>\s*(?:<[^>]+\/>\s*)?([A-Za-z][^<]{2,40}?)\s*<\/h2>/g),
    ].map(m => m[1].trim());
    const titles = [...body.matchAll(/title="([^"]+)"/g)].map(m => m[1].trim());
    const comps = TRACKED_COMPONENTS.filter(c => new RegExp(`<${c}\\b`).test(body));

    for (const item of [...headings, ...titles, ...comps]) found.push({ item, panel });
  }
  return { found, panelBlocks };
}

describe('Settings information architecture', () => {
  it('parsed the page and found all four panels (a blind scan must not read as clean)', () => {
    const { found, panelBlocks } = scanSettings();
    expect(panelBlocks.length).toBeGreaterThan(4);
    expect(new Set(panelBlocks)).toEqual(new Set(['account', 'security', 'preferences', 'plan']));
    expect(found.length).toBeGreaterThan(10);
  });

  it('places every declared setting under its declared panel', () => {
    const { found } = scanSettings();
    const misplaced = found
      .filter(f => declaredPanelFor(f.item) !== null)
      .filter(f => declaredPanelFor(f.item) !== f.panel)
      .map(f => `  "${f.item}" is rendered under '${f.panel}' but declared under '${declaredPanelFor(f.item)}'`);

    expect(
      misplaced,
      misplaced.length === 0 ? '' :
        `\n\nA setting is not under the panel it is declared to belong to. Either move it, or ` +
        `change SETTINGS_IA and say in its doc comment WHY that panel is now the right home.\n\n` +
        `${misplaced.join('\n')}\n`,
    ).toEqual([]);
  });

  it('has no ORPHAN — every rendered section is declared somewhere', () => {
    const { found } = scanSettings();
    const orphans = [...new Set(
      found.filter(f => declaredPanelFor(f.item) === null).map(f => `${f.item} (under '${f.panel}')`),
    )];

    expect(
      orphans,
      orphans.length === 0 ? '' :
        `\n\nA section renders but is declared in no panel. An undeclared section is how "Danger ` +
        `Zone" became a peer of "Display" — add it to SETTINGS_IA under the panel whose stated ` +
        `purpose covers it.\n\n  ${orphans.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('declares nothing twice, and nothing that no longer renders', () => {
    const { found } = scanSettings();
    const rendered = new Set(found.map(f => f.item));

    const seen = new Set<string>();
    const duplicated: string[] = [];
    const missing: string[] = [];

    for (const panel of Object.keys(SETTINGS_IA) as SettingsPanelKey[]) {
      for (const item of SETTINGS_IA[panel]) {
        if (seen.has(item)) duplicated.push(item);
        seen.add(item);
        if (!rendered.has(item)) missing.push(`${item} (declared under '${panel}')`);
      }
    }

    expect(duplicated, `declared under two panels: ${duplicated.join(', ')}`).toEqual([]);
    // A stale entry is not harmless: it makes the map look like it covers something it does not.
    expect(missing, `declared but never rendered: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the three moves Tre asked for', () => {
    const { found } = scanSettings();
    const panelOf = (item: string) => found.find(f => f.item === item)?.panel;

    expect(panelOf('Danger Zone')).toBe('security');
    // Connections is the POINTER card left behind where the two forms used to be. The forms
    // themselves are asserted on `/account` below — see ACCOUNT_PAGE_ONLY.
    expect(panelOf('Connections')).toBe('account');
  });

  /**
   * ⚠️ MOVED MEANS MOVED — ONE MOUNT, NOT TWO.
   *
   * `PartnerLink` and `FriendLink` were declared under the Settings `account` panel and were
   * rendering on BOTH Settings and the Account page: duplicated rather than moved, the same shape
   * `a0328857` fixed for `FriendsLeaderboard`. Each copy keeps its own pending-invite state, so
   * cancelling an invite on one screen leaves the other showing it.
   *
   * The presence half is the POSITIVE CONTROL for the absence half. "Not in Settings" is satisfied
   * perfectly by the component not existing anywhere, which is how a moved section silently becomes
   * a deleted one.
   */
  describe('the two sections that moved OFF this page', () => {
    const ACCOUNT_PAGE = join(process.cwd(), 'src', 'pages', 'Account.tsx');

    /**
     * WARNING 2026-09-17: THIS GATE READ ONE FILE, AND THE THING IT GUARDS MOVED ONE LEVEL DEEPER.
     *
     * Tre: "friends should be followers and following just like instagram. it should only be on
     * that tab." `FriendLink` is now mounted inside `FollowersPanel`, which `Account.tsx` mounts.
     * The page still renders it exactly once for a user, and a scan of `Account.tsx` alone counted
     * ZERO and called the section deleted. That is this portfolio's recorded component-boundary
     * blind spot: the more disciplined the component library, the more reliably a per-file source
     * scan misses a relationship that exists only at a call site.
     *
     * AND THE FALSE READING WAS THE DANGEROUS ONE. A zero here reads as "a section that moved
     * never arrived", which sends the next session rebuilding a feature that already works.
     *
     * So the subtree is DERIVED, never hand-named: read `Account.tsx`, take every
     * `@/components/settings/...` module it imports, and count mounts across the page plus those.
     * A hand-typed list of two files is blind to the third component nobody adds to it, which is
     * exactly how this gate went wrong in the first place.
     */
    const SETTINGS_COMPONENT_DIR = join(process.cwd(), 'src', 'components', 'settings');

    /** The files a /account render can reach, one import level below the page. */
    const accountSubtree = (): { path: string; src: string }[] => {
      const src = readFileSync(ACCOUNT_PAGE, 'utf8');
      const children = [...src.matchAll(/from\s+'@\/components\/settings\/([A-Za-z0-9_]+)'/g)]
        .map((m) => m[1]);
      return [
        { path: 'src/pages/Account.tsx', src },
        ...children.map((name) => ({
          path: `src/components/settings/${name}.tsx`,
          src: readFileSync(join(SETTINGS_COMPONENT_DIR, `${name}.tsx`), 'utf8'),
        })),
      ];
    };

    it('the derived /account subtree is non-empty and really includes the page', () => {
      // POSITIVE CONTROL ON THE EXTRACTION. A gate that slices before it asserts can run zero
      // assertions and print clean; an empty subtree and a clean codebase give the same silence.
      const files = accountSubtree();
      expect(files.length, 'the subtree collapsed — the import regex stopped matching')
        .toBeGreaterThan(1);
      expect(files.some((f) => f.path.endsWith('Account.tsx'))).toBe(true);
    });

    for (const comp of ACCOUNT_PAGE_ONLY) {
      it(`${comp} is mounted in the /account subtree exactly once, and not at all in Settings`, () => {
        const settings = readFileSync(SETTINGS, 'utf8');
        const mounts = (s: string) => (s.match(new RegExp(`<${comp}\\b`, 'g')) ?? []).length;

        const files = accountSubtree();
        const total = files.reduce((n, f) => n + mounts(f.src), 0);
        const where = files.filter((f) => mounts(f.src) > 0).map((f) => f.path).join(', ');

        // "Exactly one, and here is where" is stronger than a bare count: it survives the section
        // legitimately moving between files, and it names the second copy when there is one.
        expect(total, `${comp} is mounted ${total} time(s) in the /account subtree (${where || 'nowhere'}) - a section that moved must arrive somewhere, exactly once`).toBe(1);
        expect(mounts(settings), `${comp} still renders in Settings - that is the duplicate, not the move`).toBe(0);
      });
    }

    it('Settings still redirects the live invite links to /account, carrying the code', () => {
      const settings = readFileSync(SETTINGS, 'utf8');
      // Invite emails already sent point at `/settings?friend_code=…` and cannot be edited;
      // invites last 7 days. Dropping this strands every outstanding invite.
      expect(settings).toMatch(/friend_code/);
      expect(settings).toMatch(/partner_code/);
      expect(settings, 'the redirect must carry the search string — the code IS the search string')
        .toMatch(/navigate\(`\/account\$\{location\.search\}`/);
    });
  });
});
