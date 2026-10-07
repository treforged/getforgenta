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
const BAD = /\btext-destructive(?![-\w])/g;
const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('red text uses the text token, never the fill red', () => {
  const files = sourceFiles(SRC);

  it('the scan sees the app (positive control)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join('budget', 'SpentOfPlanned.tsx')))).toBe(true);
  });

  it('the pattern catches the defect and spares the allowed classes', () => {
    expect('text-sm text-destructive mt-1'.match(BAD)).toHaveLength(1);
    expect('text-destructive/80'.match(BAD)).toHaveLength(1);
    expect('text-destructive-text text-destructive-foreground'.match(BAD)).toBeNull();
  });

  it('no source file paints text in the fill red', () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf-8').split(/\r?\n/).flatMap((line, i) =>
        line.match(BAD) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(hits).toEqual([]);
  });
});
