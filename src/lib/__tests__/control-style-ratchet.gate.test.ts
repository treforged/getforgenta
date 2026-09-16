// THE NUMBER OF DISTINCT CONTROL STYLES MAY GO DOWN. IT MAY NOT GO UP.
//
// Tre, 2026-09-13: "consider design of other apps when thinking about our design always. and
// consistency across tabs." The standing rule (rules/common/control-conventions.md) says the
// deliverable for that is CONSOLIDATION and that THE COUNT IS THE ACCEPTANCE EVIDENCE. This file
// is that count, held as a ceiling.
//
// WHY A RATCHET AND NOT A REWRITE, stated plainly because the restraint is deliberate.
// Measured 2026-09-16: 87 text inputs across 36 distinct SURFACE signatures. That number sounds
// like 36 designs and is not - almost every one is `bg-secondary border border-border ...
// text-foreground` varying only in padding and text size, which are legitimate size variants. So
// the app has roughly ONE control with three sizes and some drift, not thirty-six controls.
// Rewriting 87 call sites across the money pages to chase a prettier number would be a large
// regression risk for a cosmetic gain. A ceiling costs nothing, stops the drift TODAY, and lets
// the consolidation happen in slices whenever a file is being touched anyway.
//
// ⚠️ THE ACCESSIBILITY HALF WAS THE PART THAT ACTUALLY HARMED USERS AND IT IS ALREADY FIXED -
// see `focus-visible.gate.test.ts`. Two controls shipped with no visible focus state at all
// because the shared pattern was copied by hand instead of imported. That is what this drift
// costs when it costs something; the rest is tidiness.
//
// ⚠️ DISCOVERY IS BY ELEMENT, NEVER BY THE SHARED CONSTANT. A hand-rolled control is exactly the
// one that does not import `FIELD_INPUT`, so finding candidates by that marker would count only
// among the already-correct - the blind spot measured on the one-switch gate on 2026-09-14.
//
// HOW TO LOWER THE CEILING: consolidate some call sites, re-run, and set the constant to the new
// number in the same commit. Never raise it. If a genuinely new KIND of control is needed, that is
// a conversation, not a bumped number.
//
// WHAT THIS DOES NOT CATCH: whether the styles that remain are GOOD, whether they are legible,
// controls built at runtime, controls outside `src/`, and any styling not expressed as a
// className. It counts variety; it does not judge it.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/** Brace-aware, so a `>` inside `onChange={e => ...}` cannot end the tag early. */
function openTags(src: string, tag: string): { tag: string; lineNo: number }[] {
  const out: { tag: string; lineNo: number }[] = [];
  const re = new RegExp('<' + tag + '(?=[\\s/>])', 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let q: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q && src.charCodeAt(i - 1) !== 92) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ tag: src.slice(m.index, i + 1), lineNo: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

function classOf(tag: string): string | null {
  const m = tag.match(/className=(?:"([^"]*)"|'([^']*)'|\{`([\s\S]*?)`\}|\{([A-Za-z_$][\w$]*)\})/);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? `VAR:${m[4]}`).replace(/\s+/g, ' ').trim();
}

/**
 * Layout is legitimately per-site - a field in a narrow cell is not a different control from one
 * in a wide row. The SURFACE (background, border, padding, type scale, focus) is what must not
 * drift, so layout utilities are stripped before the signature is taken. Sorted, so token ORDER
 * is not mistaken for a difference.
 */
const LAYOUT = /^(w-|h-|min-w-|max-w-|min-h-|mt-|mb-|ml-|mr-|mx-|my-|flex-1|flex$|shrink|grow|block|inline|sm:|md:|lg:|text-left|text-right|text-center|truncate|uppercase|tracking-|col-|row-|order-|self-|justify-|items-|gap-)/;
function surfaceOf(cls: string): string {
  return cls.split(' ').filter((t) => t && !LAYOUT.test(t)).sort().join(' ');
}

const TEXTY = /^(?:text|email|password|search|url|tel|number)$/;

function signatures(kind: 'input' | 'select'): { elements: number; surfaces: Set<string> } {
  const files = globSync('src/**/*.tsx').filter((f) => !f.includes('__tests__'));
  const surfaces = new Set<string>();
  let elements = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (const { tag, lineNo } of openTags(src, kind)) {
      if (/^\s*\*/.test(lines[lineNo - 1] ?? '')) continue;   // prose in a JSDoc block
      if (kind === 'input') {
        const type = tag.match(/type=["']([a-z-]+)["']/)?.[1] ?? 'text';
        if (!TEXTY.test(type)) continue;
      }
      const cls = classOf(tag);
      if (cls === null) continue;
      elements++;
      surfaces.add(surfaceOf(cls));
    }
  }
  return { elements, surfaces };
}

/* THE CEILINGS. Measured 2026-09-16, after the UsernameClaim consolidation. LOWER THESE, NEVER
 * RAISE THEM. The element floors sit just under today's counts so that a resolver which stops
 * matching fails loudly instead of reporting a beautifully consistent zero. */
const CEILING = { input: 36, select: 18 };
const FLOOR = { input: 80, select: 40 };

describe('the resolver works before its numbers mean anything', () => {
  it('reads a tag whose handler contains `=>`', () => {
    const src = `<select value={v} onChange={e => setV(e.target.value)} className="a b">x</select>`;
    expect(classOf(openTags(src, 'select')[0].tag)).toBe('a b');
  });

  it('treats layout differences as the SAME surface, and surface differences as DIFFERENT', () => {
    expect(surfaceOf('w-full bg-secondary border')).toBe(surfaceOf('flex-1 sm:w-20 bg-secondary border'));
    expect(surfaceOf('bg-secondary border')).not.toBe(surfaceOf('bg-card border'));
  });

  it('is order-insensitive - token order is not a design difference', () => {
    expect(surfaceOf('border bg-secondary px-2')).toBe(surfaceOf('px-2 border bg-secondary'));
  });

  it('POSITIVE CONTROL: a genuinely new surface raises the count', () => {
    const base = new Set(['bg-secondary border', 'bg-card border']);
    const withNew = new Set([...base, surfaceOf('bg-destructive border-4 ring-8')]);
    expect(withNew.size).toBe(base.size + 1);
  });
});

describe.each(['input', 'select'] as const)('%s style variety may not grow', (kind) => {
  const { elements, surfaces } = signatures(kind);

  it(`examined a NON-EMPTY inventory (found ${elements} elements)`, () => {
    expect(elements).toBeGreaterThanOrEqual(FLOOR[kind]);
  });

  it(`has at most ${CEILING[kind]} distinct surface styles (found ${surfaces.size})`, () => {
    expect(
      surfaces.size,
      `Distinct ${kind} surface styles rose to ${surfaces.size}, ceiling is ${CEILING[kind]}. ` +
      'Reuse an existing style or a constant from src/components/shared/field-classes.ts. ' +
      'If you consolidated and the number FELL, lower the ceiling in this file in the same commit.',
    ).toBeLessThanOrEqual(CEILING[kind]);
  });
});
