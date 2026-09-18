// Text tokens must clear WCAG AA against the surface they sit on, in EVERY theme block.
//
// Tre, 2026-09-18: "some of the text is very dull compared to the background like some of the
// smaller text and someone like the gray text. It should be white instead because it's kind of
// hard to read." He was objectively right, and nothing in this repo could have told us:
// --muted-foreground measured 4.19:1 in dark, BELOW the 4.5:1 AA floor for normal text, while
// light measured 6.05:1 and passed. A complaint about "dull" text was an accessibility failure
// wearing an aesthetic complaint's clothes.
//
// ⚠️ THIS PARSES THE TOKENS OUT OF index.css RATHER THAN HARDCODING THEM. A hardcoded expectation
// passes for ever after somebody edits the stylesheet, which is the one event it exists to catch.
// The block list is DERIVED from the selectors present, so a theme nobody added to a hand-written
// list cannot escape - this repo has filed the hand-named-inventory defect enough times.
//
// WHAT IT DOES NOT COVER, said plainly: text drawn on --card, --popover, --primary or any other
// surface than --background; text over images or gradients; anything whose colour comes from a
// Tailwind literal rather than a token; the 3:1 large-text exemption (we hold everything to the
// stricter 4.5:1 rather than guessing which text is large); and whether the result LOOKS good,
// which is a rendered frame's job.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');

/** Relative luminance per WCAG 2.x, from an `H S% L%` token triple. */
function luminance(h: number, s: number, l: number): number {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const f = (v: number) => {
    const n = v + m;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r1) + 0.7152 * f(g1) + 0.0722 * f(b1);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(...a), lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Every theme block in the stylesheet, DERIVED - never listed by hand.
 *
 * WARNING IT IS LINE-BASED ON PURPOSE. My first version sliced from `<sel> {` to the next `  }`,
 * which found the blocks (6631 / 2795 / 3847 chars) and then read NULL for every token - these
 * live inside `@layer base`, so the first closing brace at that indent belongs to an inner rule
 * and the slice covered the wrong text. It failed LOUDLY, 6 of 7, because a missing token is a
 * failure here rather than a skip. Had it been a skip it would have read as a clean pass over
 * nothing at all.
 */
function themeBlocks(): Record<string, string> {
  const lines = css.split(/\r?\n/);
  const starts: { sel: string; at: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(:root|\.light|\.dark)\s*\{\s*$/);
    if (m) starts.push({ sel: m[1], at: i });
  });
  const out: Record<string, string> = {};
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : lines.length;
    const body = lines.slice(s.at, end).join('\n');
    // A selector can legitimately appear more than once; keep the block that actually carries the
    // palette, which is the one defining --background.
    if (/--background:/.test(body)) out[s.sel] = body;
  });
  return out;
}

function token(block: string, name: string): [number, number, number] | null {
  const m = block.match(new RegExp(String.raw`^\s*--${name}:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;`, 'm'));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

describe('theme contrast', () => {
  const blocks = themeBlocks();

  // POSITIVE CONTROL. A broken parser returns an empty map, and "no block failed" over zero
  // blocks is the same green as a healthy stylesheet. Assert the instrument found its subject
  // AND that it can compute a ratio it already knows the answer to.
  it('finds the theme blocks and computes a known ratio', () => {
    expect(Object.keys(blocks).length).toBeGreaterThanOrEqual(2);
    // Pure black on pure white is 21:1 by definition.
    expect(contrast([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 1);
  });

  for (const [sel, block] of Object.entries(themeBlocks())) {
    it(`${sel}: muted text clears AA on the background`, () => {
      const bg = token(block, 'background');
      const muted = token(block, 'muted-foreground');
      // A missing token is a FAILURE, never a skip - a skip and a pass look identical in a summary.
      expect(bg, `${sel} has no --background`).not.toBeNull();
      expect(muted, `${sel} has no --muted-foreground`).not.toBeNull();
      expect(contrast(muted!, bg!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${sel}: primary text stays clearly above muted text`, () => {
      const bg = token(block, 'background');
      const fg = token(block, 'foreground');
      const muted = token(block, 'muted-foreground');
      expect(fg, `${sel} has no --foreground`).not.toBeNull();
      // Raising muted toward white fixes legibility and can destroy HIERARCHY. Primary text must
      // stay meaningfully brighter, or a dense money screen becomes one flat wall of text.
      expect(contrast(fg!, bg!)).toBeGreaterThan(contrast(muted!, bg!) * 1.5);
    });
  }
});
