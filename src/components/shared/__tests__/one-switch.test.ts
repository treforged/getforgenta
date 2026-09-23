// THERE IS EXACTLY ONE ON/OFF SWITCH IN THIS APP.
//
// Tre, 2026-09-13: *"make the sharing toggles more like a switch... consider design of other apps
// when thinking about our design always. and consistency across tabs."*
//
// ⚠️ THE CONSOLIDATION WAS RECORDED AS DONE AND WAS NOT DONE. On 2026-09-13 the shared
// `ToggleSwitch` was created and `NotificationSettings.knob.test.tsx` was updated to say "the
// others now use it". TWO hand-rolled copies survived it — `ConsentBanner.tsx` and `Legal.tsx` —
// and both were still there on 2026-09-14. A handoff section is a CLAIM, not a fact.
//
// ⚠️ SO THIS GATE COUNTS; IT DOES NOT TRUST. And it DERIVES the file list by walking `src/`
// rather than naming the files it knows about — a dependency list named by hand passes the file
// nobody added to it, which is the same defect one level up.
//
// WHY IT MATTERS MORE THAN TIDINESS: the surviving copies used a flat `bg-muted` OFF track with no
// border, where the shared switch uses `bg-secondary border border-border`. Off read as
// un-highlighted rather than OFF — on COOKIE CONSENT controls. And the `Legal.tsx` copy carried no
// `aria-label` at all, so a screen reader announced an unnamed switch on the privacy page.
//
// ⚠️ THE PATTERN IS BUILT AT RUNTIME, NOT WRITTEN AS A LITERAL. Spelled out, this file matched
// ITSELF and failed on its own first run. The tempting fix — exclude `__tests__` — would let a
// real hand-rolled switch hide in a test directory, and a guard whose own code trips it teaches
// the next person to loosen the guard. Concatenation removes the literal instead.
//
// ⚠️ THE BLIND SPOT THIS FILE DECLARED WAS REAL, AND IT WAS HIDING SIX SWITCHES — closed
// 2026-09-14. The header used to end by admitting it could not see "a switch built without the
// switch role at all". That is not a hypothetical: three in `ForecastAssumptionsPanel.tsx` and
// three in `Settings.tsx` had NO role, NO `aria-checked`, NO `aria-label` and no `type="button"`,
// so a screen reader announced six plain buttons with no state — and this gate reported ONE
// implementation, truthfully, the whole time. **A gate that can only find the controls which
// already did the right thing will always report that everything did the right thing.**
//
// So it now counts switch-shaped MARKUP as well as the declared role. Two of the six also
// hardcoded a `bg-white` knob, which stayed white in dark mode.
//
// WHAT IT STILL DOES NOT CATCH, said plainly: a switch inside a third-party component, one whose
// classes arrive entirely from a variable, and anything about how either state actually LOOKS —
// that needs a rendered frame. The geometry contract is guarded separately in
// `NotificationSettings.knob.test.tsx`.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');

/** Every .tsx/.ts under src/, walked — never enumerated. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Built by concatenation so this file does not match itself — see the header. */
const SWITCH_ROLE = new RegExp('role="' + 'switch"');

/**
 * A switch KNOB: absolutely positioned, pill-shaped, and it MOVES — all three inside the SAME
 * `className`, which is what makes this specific rather than merely suggestive.
 *
 * ⚠️ SCOPED PER ATTRIBUTE ON PURPOSE, and both looser versions were tried first. Bounding each
 * pattern with a "not a quote" class cannot cross the quote in `${on ? 'translate-x-4' : '...'}`,
 * so it failed to match even the CANONICAL switch and reported a clean tree while detecting
 * nothing. Matching per FILE instead then flagged `AiAdvisor.tsx`, whose `translate-x-full` is a
 * sliding DRAWER with an unrelated `rounded-full` elsewhere in the file — and a gate that is wrong
 * on ordinary work is one somebody switches off on the day it matters. A drawer is `fixed`, not
 * `absolute`, and carries no `rounded-full` in the same attribute, so this excludes it by
 * construction rather than by an exception list.
 */
const KNOB_CLASS_ABSOLUTE = /absolute[\s\S]{0,200}?rounded-full[\s\S]{0,200}?translate-x-/;
/**
 * ⚠️ AND A KNOB THAT IS NOT ABSOLUTE. Debt Payoff's pause-savings toggle drew its knob as
 * `inline-block ... rounded-full ... translate-x-5` inside a flex track, so the absolute-only
 * pattern never saw it - found 2026-09-23 by walk-press-every-control.mjs, not by this gate. A
 * NUMERIC or arbitrary translate (`translate-x-5`, `translate-x-[18px]`) is required, so a sliding
 * drawer's `translate-x-full` still does not count.
 */
const KNOB_CLASS_INLINE = /rounded-full[\s\S]{0,200}?translate-x-(\d|\[)/;
const KNOB_CLASS = { test: (c: string) => KNOB_CLASS_ABSOLUTE.test(c) || KNOB_CLASS_INLINE.test(c) };

/** Every `className` in a file, so a match means "one attribute did all three". */
function classNames(body: string): string[] {
  return [...body.matchAll(/className=(?:\{`([\s\S]*?)`\}|"([^"]*)")/g)].map(m => m[1] ?? m[2] ?? '');
}

function hasSwitchMarkup(body: string): boolean {
  return classNames(body).some(c => KNOB_CLASS.test(c));
}

/** The one file allowed to declare a switch. */
const CANONICAL = join('components', 'shared', 'ToggleSwitch.tsx');

describe('the app has exactly one switch implementation', () => {
  it('examined a non-trivial number of source files', () => {
    // ⚠️ Zero examined is "nothing was compared", never a pass. A broken walk and a clean tree
    // must not look the same.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('declares the switch role in ToggleSwitch.tsx and NOWHERE else', () => {
    const declaring = FILES
      .filter((f) => SWITCH_ROLE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    // The canonical one must be present — otherwise this gate would pass on a tree with no
    // switches at all, which is the green-against-nothing shape.
    expect(declaring, 'the shared switch must exist').toContain(CANONICAL.split(sep).join(sep));

    const extras = declaring.filter((f) => f !== CANONICAL.split(sep).join(sep));
    expect(
      extras,
      `${extras.length} hand-rolled switch(es) outside the shared component. Use <ToggleSwitch> instead: ${extras.join(', ')}`,
    ).toEqual([]);
  });

  it('⚠️ has switch-shaped MARKUP nowhere else either — the gap this file used to declare', () => {
    const canonical = CANONICAL.split(sep).join(sep);
    const drawing = FILES
      .filter((f) => hasSwitchMarkup(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    // Positive control. Without it a broken pattern reports an empty list and reads as clean —
    // which is exactly what the first version of this check did.
    expect(drawing, 'the shared switch must draw a knob').toContain(canonical);

    const extras = drawing.filter((f) => f !== canonical);
    expect(
      extras,
      `${extras.length} file(s) draw a switch by hand. Use <ToggleSwitch>: ${extras.join(', ')}`,
    ).toEqual([]);
  });

  it('the canonical knob is theme-aware — never a hardcoded white', () => {
    const body = readFileSync(join(SRC, CANONICAL), 'utf8');
    // Two of the six hand-rolled copies used bg-white, so the knob stayed white in dark mode.
    expect(body).toContain('bg-background');
    expect(body).not.toContain('bg-white');
  });
});
