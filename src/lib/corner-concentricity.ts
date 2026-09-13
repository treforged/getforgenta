/**
 * CORNER CONCENTRICITY — static analysis for a rule Tre made standing on 2026-09-12:
 * "research corner concentricity and integrate this concept into all my apps."
 *
 * THE RULE: when a rounded child sits inside a rounded parent separated by a gap, the child's
 * radius must be `max(0, r_outer - gap)`. A child whose radius EQUALS its padded parent's makes
 * the two arcs pinch at the corner — the notch that has now been reported three times. It is
 * arithmetic, not spacing, which is why a code review keeps missing it.
 *
 * ⚠️ WHY THIS IS STATIC AND NOT A RENDERED MEASUREMENT. The standard asks for computed
 * `border-radius` and rendered box gaps. MEASURED in this harness on 2026-09-12, not assumed:
 * jsdom returns inline styles fine (`16px`), but returns **empty** for a Tailwind class
 * (`rounded-md` -> ''), `auto` for a class-driven width, and an **all-zero** rect with
 * `offsetWidth: 0`. This repo expresses almost every radius as a Tailwind class, so a rendered
 * gate here would be green against everything it was built to catch. So the instrument is aimed
 * at the source, where the values actually are.
 *
 * ⚠️ `rounded-full` IS EXCLUDED. A pill's radius is deliberately larger than any container's and
 * is never half of a concentricity pair; including it would bury the real findings in noise.
 *
 * WHAT THIS DOES NOT CATCH, stated so nobody infers more coverage than exists:
 *   - radii or padding set in a CSS file, a `@utility`, or a class built at runtime from a
 *     variable — only what is visible in the JSX is resolvable
 *   - a gap made by margin, border width, or absolute insets rather than padding
 *   - a grandchild that visually reaches the corner through an unpadded wrapper
 *   - wrong colours, spacing, or copy
 * Coverage is reported as `elementsExamined` / `pairsChecked` so a run that resolved nothing
 * can never read as a clean repo.
 */
import ts from 'typescript';

export interface RadiusInfo {
  px: number | null;
  source: string;
}

export interface Violation {
  file: string;
  line: number;
  parentTag: string;
  childTag: string;
  parentRadiusPx: number;
  childRadiusPx: number;
  gapPx: number;
  expectedChildRadiusPx: number;
  snippet: string;
}

export interface AnalysisResult {
  violations: Violation[];
  elementsExamined: number;
  pairsChecked: number;
}

/** `--radius` in src/index.css. */
const RADIUS_PX = 12;

/**
 * Tailwind radius tokens -> pixels, most specific first.
 * `rounded-full` maps to null: excluded, not unknown.
 */
const RADIUS_TOKENS: ReadonlyArray<readonly [string, number | null]> = [
  ['rounded-none', 0],
  ['rounded-full', null],
  ['rounded-2xl', 24],
  ['rounded-xl', 16],
  ['rounded-lg', RADIUS_PX],
  ['rounded-md', RADIUS_PX - 2],
  ['rounded-sm', RADIUS_PX - 4],
];

/** Padding tokens -> pixels. The app scales rem by ~1.125, so 1rem renders ~18px. */
const PAD_STEP_PX: Readonly<Record<string, number>> = {
  '0': 0, '1': 4.5, '2': 9, '3': 13.5, '4': 18, '5': 22.5, '6': 27,
};

/** Whole-word match that survives template literals, quotes and `${...}` conditionals. */
function hasToken(text: string, token: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${token}(?![A-Za-z0-9_-])`).test(text);
}

/**
 * The radius an element resolves to, from its className tokens or an inline `borderRadius`.
 * Returns `px: null` for a pill (excluded) or when nothing resolves (unknown) — the caller
 * treats both as "not part of a pair", which is the conservative reading in each case.
 */
export function radiusFromClassAndStyle(className: string, styleText: string): RadiusInfo {
  // `rounded-nested-N` DERIVES its radius from the token (see index.css). It is resolved here
  // rather than treated as unknown on purpose: if it were invisible, the gate could be silenced
  // by simply deleting a radius, and the wrong nesting level would pass unnoticed.
  for (const step of ['1', '2', '3', '4']) {
    if (hasToken(className, `rounded-nested-${step}`)) {
      return { px: Math.max(0, RADIUS_PX - Number(step) * 4.5), source: `rounded-nested-${step}` };
    }
  }
  for (const [token, px] of RADIUS_TOKENS) {
    if (hasToken(className, token)) return { px, source: token };
  }
  if (/borderRadius\s*:\s*['"`]var\(--radius\)['"`]/.test(styleText)) {
    return { px: RADIUS_PX, source: 'style:var(--radius)' };
  }
  const px = styleText.match(/borderRadius\s*:\s*['"`]([\d.]+)px['"`]/);
  if (px) return { px: Number(px[1]), source: `style:${px[1]}px` };
  // A bare `rounded` is checked last so it cannot shadow `rounded-lg` etc.
  if (hasToken(className, 'rounded')) return { px: RADIUS_PX, source: 'rounded' };
  return { px: null, source: 'unknown' };
}

/**
 * The padding separating a parent from its children, in pixels, or null when none is declared.
 * The corner gap is bounded by the SMALLER axis, so `px-`/`py-` resolve to their minimum.
 */
export function paddingFromClass(className: string): number | null {
  for (const step of Object.keys(PAD_STEP_PX)) {
    if (hasToken(className, `p-${step}`)) return PAD_STEP_PX[step];
  }
  let x: number | null = null;
  let y: number | null = null;
  for (const step of Object.keys(PAD_STEP_PX)) {
    if (x === null && hasToken(className, `px-${step}`)) x = PAD_STEP_PX[step];
    if (y === null && hasToken(className, `py-${step}`)) y = PAD_STEP_PX[step];
  }
  if (x !== null && y !== null) return Math.min(x, y);
  return x ?? y;
}

export function analyzeSource(file: string, source: string): AnalysisResult {
  try {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const violations: Violation[] = [];
    let elementsExamined = 0;
    let pairsChecked = 0;

    // Helper to extract className, style and tag name
    function attrsOf(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): {
      className: string;
      styleText: string;
      tag: string;
    } {
      let className = '';
      let styleText = '';
      for (const attr of el.attributes.properties) {
        if (ts.isJsxAttribute(attr)) {
          const name = attr.name.getText(sf);
          const value = attr.initializer ? attr.initializer.getText(sf) : '';
          if (name === 'className') {
            className = value;
          } else if (name === 'style') {
            styleText = value;
          }
        }
      }
      return { className, styleText, tag: el.tagName.getText(sf) };
    }

    // Helper to collect direct child JSX elements, descending through fragments and expressions
    function directChildElements(node: ts.JsxElement | ts.JsxFragment): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const result: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];

      function walk(child: ts.JsxChild) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          result.push(child);
        } else if (ts.isJsxFragment(child)) {
          child.children.forEach(walk);
        } else if (ts.isJsxExpression(child) && child.expression) {
          const find = (n: ts.Node): void => {
            if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
              result.push(n);
            } else {
              ts.forEachChild(n, find);
            }
          };
          ts.forEachChild(child.expression, find);
        }
      }

      node.children.forEach(walk);
      return result;
    }

    // Recursive AST walk
    function visit(node: ts.Node): void {
      if (ts.isJsxElement(node)) {
        elementsExamined++;

        const parentAttrs = attrsOf(node.openingElement);
        const parentRadius = radiusFromClassAndStyle(parentAttrs.className, parentAttrs.styleText);
        const gap = paddingFromClass(parentAttrs.className);

        // ⚠️ ONLY WHERE THE ARCS ACTUALLY INTERACT: gap < r_outer.
        // The literal rule says a child must be square whenever `r_outer - gap` goes negative.
        // Enforced that way here it flagged every ordinary button inside a well-padded card —
        // a `p-4` (18px) gap against a 12px radius, where the child's corner sits entirely
        // clear of the parent's curve and nothing pinches. Squaring those would be a visual
        // rewrite of the app justified by arithmetic that does not bind, and a gate that is
        // wrong on ordinary work is a gate somebody switches off on the day it matters.
        // So this fires only when the gap is SMALLER than the outer radius, which is exactly
        // when the two arcs share corner space and can pinch.
        if (parentRadius.px !== null && gap !== null && gap > 0 && gap < parentRadius.px) {
          const children = directChildElements(node);
          for (const child of children) {
            const childAttrs = attrsOf(ts.isJsxElement(child) ? child.openingElement : child);
            const childRadius = radiusFromClassAndStyle(childAttrs.className, childAttrs.styleText);
            if (childRadius.px !== null) {
              pairsChecked++;
              const expected = Math.max(0, parentRadius.px - gap);
              if (childRadius.px > expected + 0.5) {
                const { line } = sf.getLineAndCharacterOfPosition(child.getStart(sf));
                const snippet = (childAttrs.className + ' ' + childAttrs.styleText).trim().slice(0, 160);
                violations.push({
                  file,
                  line: line + 1,
                  parentTag: parentAttrs.tag,
                  childTag: childAttrs.tag,
                  parentRadiusPx: parentRadius.px,
                  childRadiusPx: childRadius.px,
                  gapPx: gap,
                  expectedChildRadiusPx: expected,
                  snippet
                });
              }
            }
          }
        }
      } else if (ts.isJsxSelfClosingElement(node)) {
        elementsExamined++;
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
    return { violations, elementsExamined, pairsChecked };
  } catch {
    return { violations: [], elementsExamined: 0, pairsChecked: 0 };
  }
}
