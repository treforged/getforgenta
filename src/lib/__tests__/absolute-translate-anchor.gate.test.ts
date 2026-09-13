import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠️ THE GATE FOR A DEFECT THAT HAS NOW SHIPPED THREE TIMES.
 *
 * Tre, 2026-09-12: "the notches in the display section of settings are still messed up. this is
 * like the 3rd time ive pointed out this type of issue. fix this so it stops occuring everytime
 * its coded." He is asking for a GATE, not a fix. A third recurrence of one shape is a design
 * result, not carelessness.
 *
 * THE MECHANISM, and it was already measured and written down on recurrence #2 in
 * `NotificationSettings.tsx`: an element with `absolute` and NO horizontal anchor
 * (`left-*` / `right-*` / `inset-*`) is laid out at its STATIC position — roughly the centre of a
 * `<button>`, because a button centres its content — and a `translate-x-*` then moves it from
 * THERE rather than from the track's left edge. Measured in Chrome at the time: the ON knob's
 * right edge sat 14px OUTSIDE a 36px track. That is the "notch" — the knob overhanging the
 * track's rounded cap, so the pill reads as cut.
 *
 * WHY THIS GATE IS A SOURCE SCAN AND NOT A BOX MEASUREMENT. Sam specified "render it and measure
 * the rendered boxes — clipping is arithmetic". It is, but not in this harness: this repo's own
 * CLAUDE.md records that **jsdom reports every geometric property as 0** and
 * `getBoundingClientRect()` returns zeroes, so a jsdom box-measuring gate would be GREEN against
 * a knob hanging entirely outside its track. That is the exact false-green this repo has already
 * been burned by. A real-browser measurement would work and cannot run in CI, so the instrument
 * that actually discriminates here is the one aimed at the CAUSE: the missing anchor.
 *
 * WHAT THIS GATE DOES NOT CATCH, so nobody infers more coverage than exists:
 *   - wrong colours, wrong spacing, wrong copy, wrong font
 *   - a control clipped by an `overflow-hidden` ancestor with a smaller radius
 *   - an anchored knob whose translate distance is simply the wrong NUMBER
 *   - anything in a CSS file, an inline `style`, or a class built at runtime from a variable
 * It catches ONE class of defect: a translated absolute element with no anchor on that axis.
 * That is the class that has now shipped three times.
 */

const SRC = join(process.cwd(), 'src');

/** Every className string literal in the file, template literals included. */
function classAttributes(source: string): string[] {
  const out: string[] = [];
  // className="..."  |  className={`...`}  |  className={'...'}
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

const HAS_X_ANCHOR = /(?:^|[\s`${}'"(])(?:-?(?:left|right|inset|start|end)-|inset-x-)/;
const HAS_Y_ANCHOR = /(?:^|[\s`${}'"(])(?:-?(?:top|bottom|inset)-|inset-y-)/;

interface Offence {
  file: string;
  axis: 'x' | 'y';
  cls: string;
}

function findOffences(): Offence[] {
  const files = globSync('**/*.tsx', { cwd: SRC }).map(f => join(SRC, f));
  const offences: Offence[] = [];

  for (const file of files) {
    if (file.includes('__tests__')) continue;
    const source = readFileSync(file, 'utf8');

    for (const cls of classAttributes(source)) {
      if (!/(?:^|[\s`${}'"(])absolute(?:[\s`${}'")]|$)/.test(cls)) continue;

      const movesX = /(?:^|[\s`${}'"(])-?translate-x-/.test(cls);
      const movesY = /(?:^|[\s`${}'"(])-?translate-y-/.test(cls);

      // `translate-x-0` and `-1/2`-style centring tricks still need an anchor to be
      // meaningful, so they are NOT exempted — an unanchored element is the defect
      // regardless of how far it is asked to move.
      if (movesX && !HAS_X_ANCHOR.test(cls)) {
        offences.push({ file: file.replace(process.cwd(), '').replace(/\\/g, '/'), axis: 'x', cls: cls.trim() });
      }
      if (movesY && !HAS_Y_ANCHOR.test(cls)) {
        offences.push({ file: file.replace(process.cwd(), '').replace(/\\/g, '/'), axis: 'y', cls: cls.trim() });
      }
    }
  }
  return offences;
}

describe('absolute + translate must carry an anchor on the same axis', () => {
  it('examines a non-trivial number of components (a zero scan must never read as clean)', () => {
    const files = globSync('**/*.tsx', { cwd: SRC });
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds no unanchored translated absolute element anywhere in src/', () => {
    const offences = findOffences();
    const report = offences
      .map(o => `  ${o.file}\n    translate-${o.axis} with no ${o.axis === 'x' ? 'left/right/inset' : 'top/bottom/inset'} anchor:\n    ${o.cls}`)
      .join('\n\n');

    expect(
      offences,
      offences.length === 0 ? '' :
        `\n\nAn absolutely-positioned element is translated with no anchor on that axis, so it ` +
        `moves from its STATIC position (the centre of a button, in the case that has shipped ` +
        `three times) instead of from its container's edge. Add left-0 / top-0 (or the inset you ` +
        `actually want) to the same element.\n\n${report}\n`,
    ).toEqual([]);
  });
});
