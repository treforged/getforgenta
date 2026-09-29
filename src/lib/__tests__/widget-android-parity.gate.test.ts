import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ANDROID/iOS WIDGET PARITY GATE.
 *
 * The Android surplus widget said "MONTHLY SURPLUS" over the figure the app calls Month-End Cash
 * (ask 4026e4e3). Nothing could see it: the label lives in an XML layout, the app's wording lives
 * in React, and the iOS widget lives in Swift. This gate holds the joins, and every side is
 * DERIVED from the files: the labels are read out of ForgentaWidgetView.swift, and the colours out
 * of the .dark and .light blocks of src/index.css - the tokens, not the iOS palette, because the
 * iOS palette was converted by hand and drifts (gold #CDA44B against the token's #C9A240, muted
 * #A0A0AB against #A0A0A7, measured 2026-09-28 and filed for Mac Ada).
 *
 * WHAT THIS DOES NOT PROVE: that the widget renders on a home screen, that the launcher applies
 * values-night/, or that it looks right. Only a device does that.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const SWIFT = read('ios/App/ForgentaWidget/ForgentaWidgetView.swift');
const RES = 'android/app/src/main/res';
const SURPLUS = read(`${RES}/layout/widget_surplus.xml`);
const NETWORTH = read(`${RES}/layout/widget_networth.xml`);
const NIGHT = read(`${RES}/values-night/widget_colors.xml`);
const DAY = read(`${RES}/values/widget_colors.xml`);

function iosLabel(kind: 'monthEndCash' | 'netWorth'): string {
  const m = SWIFT.match(new RegExp(`case \\.${kind}:\\s*\\n\\s*figure\\(label: "([^"]+)"`));
  if (!m) throw new Error(`no iOS label for .${kind}`);
  return m[1];
}

function androidLabel(layout: string): string {
  const m = layout.match(/android:id="@\+id\/widget_label"[\s\S]*?android:text="([^"]+)"/);
  if (!m) throw new Error('no widget_label text');
  return m[1];
}

/**
 * The app's theme tokens, read out of one block of src/index.css and converted to #RRGGBB.
 * The block is found by its selector so a token moved inside it still resolves.
 */
const CSS = read('src/index.css');
function block(selector: string): Record<string, string> {
  const start = CSS.search(new RegExp(`^\\s*\\${selector}\\s*\\{`, 'm'));
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([\d.]+) ([\d.]+)% ([\d.]+)%;/g)) {
    out[m[1]] = hslHex(Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100);
  }
  return out;
}

/** The cascade: .dark and .light each override only some tokens and inherit the rest from :root. */
function tokens(theme: '.dark' | '.light'): Record<string, string> {
  return { ...block(':root'), ...block(theme) };
}

function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function androidColors(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<color name="(\w+)">(#[0-9A-Fa-f]{6})<\/color>/g)) {
    out[m[1]] = m[2].toUpperCase();
  }
  return out;
}

/** Channel distance: one unit of rounding between two HSL->RGB conversions. */
function close(a: string, b: string, tol = 1): boolean {
  const ch = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return ch(a).every((v, i) => Math.abs(v - ch(b)[i]) <= tol);
}

// widget colour -> the app token it must equal. The dark background is the page (--background,
// as on iOS); the light one is the card (--card), because a near-white page grey on a light
// wallpaper reads as a hole.
const MAP: Array<[string, string, string]> = [
  ['widget_bg', 'background', 'card'],
  ['widget_text', 'foreground', 'foreground'],
  ['widget_muted', 'muted-foreground', 'muted-foreground'],
  ['widget_gold', 'gold', 'gold'],
  ['widget_green', 'success', 'success'],
  ['widget_red', 'destructive-text', 'destructive-text'],
];

describe('Android widgets match the iOS widget', () => {
  it('positive control: the readers find what they must', () => {
    expect(iosLabel('monthEndCash').length).toBeGreaterThan(0);
    expect(tokens('.dark').gold).toMatch(/^#[0-9A-F]{6}$/);
    expect(tokens('.light').gold).toMatch(/^#[0-9A-F]{6}$/);
    expect(tokens('.dark').gold).not.toBe(tokens('.light').gold);
    expect(Object.keys(androidColors(NIGHT)).length).toBe(MAP.length);
  });

  it('the surplus widget uses the iOS label for monthEndCash (not MONTHLY SURPLUS)', () => {
    expect(androidLabel(SURPLUS)).toBe(iosLabel('monthEndCash'));
  });

  it('the net worth widget uses the iOS label for netWorth', () => {
    expect(androidLabel(NETWORTH)).toBe(iosLabel('netWorth'));
  });

  for (const [theme, xml, col] of [['.dark', NIGHT, 1], ['.light', DAY, 2]] as const) {
    it(`the ${theme === '.dark' ? 'dark (values-night)' : 'light (values)'} palette is the app's ${theme} tokens`, () => {
      const t = tokens(theme);
      const a = androidColors(xml);
      for (const row of MAP) {
        const token = row[col];
        expect(t[token], `--${token} in ${theme}`).toBeDefined();
        expect(close(t[token], a[row[0]]), `${row[0]} ${a[row[0]]} vs --${token} ${t[token]}`).toBe(true);
      }
    });
  }

  it('light defines every colour dark does, and differs from it', () => {
    const day = androidColors(DAY);
    const night = androidColors(NIGHT);
    expect(Object.keys(day).sort()).toEqual(Object.keys(night).sort());
    expect(day.widget_bg).not.toBe(night.widget_bg);
  });

  it('both layouts start on the empty state the iOS widget draws', () => {
    for (const layout of [SURPLUS, NETWORTH]) {
      expect(layout).toMatch(/android:id="@\+id\/widget_amount"[\s\S]*?android:text="--"/);
      expect(layout).toMatch(/android:text="Open Forgenta to sync"/);
    }
  });

  it('no XML comment contains a double hyphen (aapt refuses the file)', () => {
    for (const [name, xml] of [['surplus', SURPLUS], ['networth', NETWORTH], ['night', NIGHT], ['day', DAY]]) {
      const comments = [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
      expect(comments.length, `${name} has comments to check`).toBeGreaterThan(0);
      for (const c of comments) expect(c.includes('--'), `${name}: ${c.trim().slice(0, 60)}`).toBe(false);
    }
  });
});
