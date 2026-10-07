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
  // Exceptions, each named: spinner icons (`animate-spin`, decorative), and the two nav files, where the faded
  // gold marks a highlighted-but-not-current item - full gold would read as the current page, so that one needs
  // its own measured fix rather than a blanket repoint.
  const FADED_GOLD = /(?<![:\w-])text-primary\/\d+/;
  const NAV_EXCEPTIONS = [path.join('layout', 'MobileNav.tsx'), path.join('layout', 'Sidebar.tsx')];

  it('the faded-gold pattern spares hover states', () => {
    expect(FADED_GOLD.test('text-xs text-primary/80')).toBe(true);
    expect(FADED_GOLD.test('hover:text-primary/80 text-primary')).toBe(false);
  });

  it('no resting text is painted in faded gold', () => {
    const hits = files
      .filter((f) => !NAV_EXCEPTIONS.some((n) => f.endsWith(n)))
      .flatMap((f) => readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
        FADED_GOLD.test(line) && !/animate-spin/.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });

  it('no source file paints text in a fill colour', () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
        line.match(BAD) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });
});
