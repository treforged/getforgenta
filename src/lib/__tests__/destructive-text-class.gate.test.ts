import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// `text-destructive` paints text in the FILL red (--destructive), which reads 3.0:1 on the dark
// card - below AA. Red TEXT must use `text-destructive-text`, whose values theme-contrast.test.ts
// checks. check:destructive-contrast cannot see this: it finds candidates BY the text token's
// colour, so text painted in the fill red is invisible to it. Found 2026-10-07 on Budget's
// "Spent so far" card ("$X over plan").
//
// Allowed: `text-destructive-foreground` (text ON a red fill) and `text-destructive-text`.
// The same holds for green (2026-10-07): `text-success/80` on a Garage phase badge read 3.72:1 dark,
// 3.73:1 light; `text-success-text` reads 6.71 / 5.58.
const BAD = /\btext-(?:destructive|success)(?![-\w])/g;
const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('red and green text use the text tokens, never the fill colours', () => {
  const files = sourceFiles(SRC);

  it('the scan sees the app (positive control)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join('budget', 'SpentOfPlanned.tsx')))).toBe(true);
  });

  it('the pattern catches the defect and spares the allowed classes', () => {
    expect('text-sm text-destructive mt-1'.match(BAD)).toHaveLength(1);
    expect('text-destructive/80'.match(BAD)).toHaveLength(1);
    expect('text-success/80'.match(BAD)).toHaveLength(1);
    expect('text-destructive-text text-destructive-foreground text-success-text/70'.match(BAD)).toBeNull();
  });

  // FADED GOLD (2026-10-07, check:build-badges): `text-primary/80` reads 3.97:1 on the light page (full gold
  // 6.16:1). A resting `text-primary/NN` is refused; `hover:text-primary/NN` is a hover state and is allowed.
  // One exception: spinner icons (`animate-spin`, decorative). The nav files were exempt until be864a14 moved
  // their highlight cue to a gold icon + dot with a full-contrast label (check:nav-highlight measures it).
  const FADED_GOLD = /(?<![:\w-])text-primary\/\d+/;

  it('the faded-gold pattern spares hover states', () => {
    expect(FADED_GOLD.test('text-xs text-primary/80')).toBe(true);
    expect(FADED_GOLD.test('hover:text-primary/80 text-primary')).toBe(false);
  });

  it('no resting text is painted in faded gold', () => {
    const hits = files
      .flatMap((f) => readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
        FADED_GOLD.test(line) && !/animate-spin/.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });

  // FADED MUTED TEXT (2026-10-07, ea15c0fe): muted-foreground is tuned to just clear AA, so any `/NN` on it
  // drops text below 4.5:1 (measured 2.17-3.87:1 in light mode), and an ICON at /60 is 2.69:1 in light, below
  // the 3:1 non-text floor. Allowed only on something hidden from assistive tech (`aria-hidden`).
  const FADED_MUTED = /(?<![:\w-])text-muted-foreground\/\d+/;
  it('no resting text is painted in faded muted grey', () => {
    expect(FADED_MUTED.test('<p className="text-[10px] text-muted-foreground/70">')).toBe(true);
    expect(FADED_MUTED.test('hover:text-muted-foreground/70')).toBe(false);
    const hits = files.flatMap((f) => readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
      FADED_MUTED.test(line) && !/aria-hidden/.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });

  // BLACK ON GOLD (2026-10-07): Garage buttons hardcoded `color: '#000'` on `--primary`. Light mode's gold
  // is dark (43 74% 26%), so that read 3.13:1. Text on the primary fill must use --primary-foreground.
  it('no inline style puts a hardcoded colour on the primary fill', () => {
    const BLACK_ON_GOLD = /background: 'hsl\(var\(--primary\)\)',\s*color: '#/;
    const hits = files.flatMap((f) => readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
      BLACK_ON_GOLD.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });

  it('no source file paints text in a fill colour', () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
        line.match(BAD) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });
});
