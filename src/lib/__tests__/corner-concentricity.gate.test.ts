import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeSource,
  radiusFromClassAndStyle,
  paddingFromClass,
} from '../corner-concentricity';

/**
 * The corner-concentricity gate. The rule, the instrument choice and the limits are documented
 * on `src/lib/corner-concentricity.ts` — read that first.
 *
 * The unit tests below come first on purpose. A repo-wide scan that resolves nothing reports a
 * clean repo, so the resolver has to be shown to WORK before its silence means anything.
 */

describe('the resolver itself (so the scan below can be trusted)', () => {
  it('reads radius from plain classes', () => {
    expect(radiusFromClassAndStyle('flex rounded-lg p-2', '').px).toBe(12);
    expect(radiusFromClassAndStyle('rounded-md', '').px).toBe(10);
    expect(radiusFromClassAndStyle('rounded-none', '').px).toBe(0);
  });

  it('reads radius out of a TEMPLATE LITERAL with conditionals — the shape this repo actually uses', () => {
    const cls = "{`h-16 flex rounded-lg ${active ? 'bg-primary' : 'bg-secondary'} border`}";
    expect(radiusFromClassAndStyle(cls, '').px).toBe(12);
  });

  it('reads an inline var(--radius), which is 90 files in this repo', () => {
    expect(radiusFromClassAndStyle('', "{{ borderRadius: 'var(--radius)' }}").px).toBe(12);
    expect(radiusFromClassAndStyle('', "{{ borderRadius: '8px' }}").px).toBe(8);
  });

  it('EXCLUDES rounded-full rather than calling it unknown', () => {
    const r = radiusFromClassAndStyle('w-8 h-4 rounded-full', '');
    expect(r.px).toBeNull();
    expect(r.source).toBe('rounded-full');
  });

  it('does not let a bare `rounded` shadow a specific token', () => {
    expect(radiusFromClassAndStyle('rounded-xl', '').px).toBe(16);
    expect(radiusFromClassAndStyle('rounded', '').px).toBe(12);
  });

  it('resolves padding, and takes the SMALLER axis', () => {
    expect(paddingFromClass('p-3')).toBe(13.5);
    expect(paddingFromClass('px-4 py-2')).toBe(9);
    expect(paddingFromClass('flex gap-2')).toBeNull();
    // `px-3` must not be read as `p-3`.
    expect(paddingFromClass('px-3')).toBe(13.5);
    expect(paddingFromClass('flex')).toBeNull();
  });

  it('FINDS a planted violation — the positive control', () => {
    const src = `
      export const A = () => (
        <div className="rounded-lg p-2">
          <button className="rounded-lg">press</button>
        </div>
      );
    `;
    const r = analyzeSource('planted.tsx', src);
    expect(r.pairsChecked).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expectedChildRadiusPx).toBe(3);
    expect(r.violations[0].childRadiusPx).toBe(12);
  });

  it('PASSES the corrected version of that same markup — the negative control', () => {
    const src = `
      export const A = () => (
        <div className="rounded-lg p-2">
          <button style={{ borderRadius: 'max(0px, calc(var(--radius) - 0.5rem))' }}>press</button>
        </div>
      );
    `;
    const r = analyzeSource('fixed.tsx', src);
    // The derived form does not resolve to a number, so it drops out of the pair rather than
    // being asserted against — which is the honest outcome: a derived radius is correct BY
    // CONSTRUCTION and there is nothing left for a static check to get wrong.
    expect(r.violations).toHaveLength(0);
  });

  it('does not flag when the gap already EXCEEDS the radius — the child clears the arc', () => {
    const src = `
      export const A = () => (
        <div className="rounded-lg p-4">
          <button className="rounded-lg">press</button>
        </div>
      );
    `;
    expect(analyzeSource('clear.tsx', src).violations).toHaveLength(0);
  });

  it('does not flag a parent with NO padding — a flush child may share the radius', () => {
    const src = `
      export const A = () => (
        <div className="rounded-lg">
          <img className="rounded-lg" />
        </div>
      );
    `;
    expect(analyzeSource('flush.tsx', src).violations).toHaveLength(0);
  });
});

const SRC = join(process.cwd(), 'src');

function scanRepo() {
  const files = globSync('**/*.tsx', { cwd: SRC })
    .filter(f => !f.includes('__tests__'))
    .map(f => join(SRC, f));

  let elementsExamined = 0;
  let pairsChecked = 0;
  const violations = [];

  for (const file of files) {
    const r = analyzeSource(file.replace(process.cwd(), '').replace(/\\/g, '/'), readFileSync(file, 'utf8'));
    elementsExamined += r.elementsExamined;
    pairsChecked += r.pairsChecked;
    violations.push(...r.violations);
  }
  return { files: files.length, elementsExamined, pairsChecked, violations };
}

describe('corner concentricity across every panel in src/', () => {
  it('actually parsed the repo (a zero scan must never read as clean)', () => {
    const { files, elementsExamined, pairsChecked } = scanRepo();
    expect(files).toBeGreaterThan(100);
    expect(elementsExamined).toBeGreaterThan(1000);
    // If this ever drops to 0, the resolver has gone blind and every result below is meaningless.
    expect(pairsChecked).toBeGreaterThan(0);
  });

  it('has no rounded child whose radius exceeds its padded parent minus the gap', () => {
    const { violations } = scanRepo();
    const report = violations
      .map(v =>
        `  ${v.file}:${v.line}  <${v.parentTag}> (r=${v.parentRadiusPx}px, pad=${v.gapPx}px) > <${v.childTag}> r=${v.childRadiusPx}px\n` +
        `    expected r_inner = max(0, ${v.parentRadiusPx} - ${v.gapPx}) = ${v.expectedChildRadiusPx}px\n` +
        `    ${v.snippet}`)
      .join('\n\n');

    expect(
      violations,
      violations.length === 0 ? '' :
        `\n\nr_inner must be max(0, r_outer - gap). A child sharing its padded parent's radius ` +
        `makes the two arcs pinch at the corner. Derive the inner radius instead of reusing the ` +
        `token: style={{ borderRadius: 'max(0px, calc(var(--radius) - <pad>))' }}, or use a ` +
        `smaller rounded-* step.\n\n${report}\n`,
    ).toEqual([]);
  });
});
