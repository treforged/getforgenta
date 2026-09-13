import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTINGS_IA,
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
    expect(panelOf('FriendLink')).toBe('account');
    expect(panelOf('PartnerLink')).toBe('account');
  });
});
