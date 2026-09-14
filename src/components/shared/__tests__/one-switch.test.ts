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
// WHAT THIS DOES NOT CATCH, said plainly: a switch built without the switch role at all (which
// would be an accessibility defect this gate cannot see), a switch inside a third-party component,
// and anything about how either state actually LOOKS — that needs a rendered frame. The geometry
// contract is guarded separately in `NotificationSettings.knob.test.tsx`.

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
});
