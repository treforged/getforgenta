// FOLLOWERS LIVE ON ONE TAB, AND NOTHING ELSE SURFACES THEM.
//
// Tre, 2026-09-16 23:07: "friends should be followers and following just like instagram. it
// should only be on that tab." Two halves bind, and this file gates the SECOND one: no follow
// control and no follower count anywhere except the Account tab.
//
// WHY A GATE RATHER THAN A CODE REVIEW. The first half is structural - the `follows` table is an
// asymmetric (follower_id, followee_id) pair, and it cannot quietly stop being one. The SCOPING
// half has no structure holding it up at all: any page can import `FollowersPanel` or call
// `useFollows` and render a count, and nothing anywhere would go red. A scoping rule with no gate
// decays one reasonable-looking screen at a time.
//
// ⚠️ THE SURFACES ARE DERIVED, NEVER HAND-NAMED. A hand-typed list of three components is blind
// to the fourth that somebody adds next week - which is the exact defect this repo has recorded
// three separate times (a console-parity list, a watcher inventory, a preflight stage list). So a
// "follow surface" is defined by what a file actually USES: any component under
// `src/components/` that references the follow hooks.
//
// WHAT THIS DOES NOT COVER, said plainly so nobody trusts it past its reach:
//   - It is a SOURCE scan. It cannot see a mount built at runtime from a variable component, and
//     it cannot see anything about how the control LOOKS. `npm run check:followers` is what
//     presses it in a real browser; `one-switch.test.ts` is what keeps it the app's one switch.
//   - It says nothing about the mutual-vs-asymmetric ACCESS rule, which lives in the database.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = join(process.cwd(), 'src', 'pages');
const COMPONENTS_DIR = join(process.cwd(), 'src', 'components');

/** The hooks that ARE the follow feature. A file touching either of these is a follow surface. */
const FOLLOW_HOOKS = ['useFollows', 'useAccountVisibility'];

/** The one page allowed to surface any of it. */
const THE_ONE_TAB = 'Account.tsx';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const isSource = (f: string) =>
  (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('__tests__');

/** Components that use the follow hooks - derived from their own imports, not from a list. */
function followComponents(): string[] {
  return walk(COMPONENTS_DIR)
    .filter(isSource)
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return FOLLOW_HOOKS.some((h) => src.includes(`/hooks/${h}'`));
    })
    .map((f) => f.split(/[\\/]/).pop()!.replace(/\.tsx?$/, ''));
}

describe('the follow feature is scoped to one tab', () => {
  it('POSITIVE CONTROL: the derivation really finds the follow components', () => {
    // A zero from a broken derivation and a zero from a clean codebase are the same zero, and the
    // absence assertions below are all satisfied perfectly by finding nothing at all.
    const found = followComponents();
    expect(found.length, 'derived no follow components - the hook-import match broke').toBeGreaterThan(0);
    expect(found, 'FollowersPanel is the panel this rule is about').toContain('FollowersPanel');
  });

  it('POSITIVE CONTROL: the one allowed tab really does mount one', () => {
    // Without this, "no other page mounts it" is also satisfied by the feature being deleted.
    const account = readFileSync(join(PAGES_DIR, THE_ONE_TAB), 'utf8');
    const mounted = followComponents().filter((c) => new RegExp(`<${c}\\b`).test(account));
    expect(mounted.length, `${THE_ONE_TAB} mounts no follow surface - the feature has gone missing`)
      .toBeGreaterThan(0);
  });

  it('no OTHER page mounts a follow surface', () => {
    const comps = followComponents();
    const offenders: string[] = [];

    for (const file of walk(PAGES_DIR).filter(isSource)) {
      const name = file.split(/[\\/]/).pop()!;
      if (name === THE_ONE_TAB) continue;
      const src = readFileSync(file, 'utf8');
      for (const c of comps) {
        if (new RegExp(`<${c}\\b`).test(src)) offenders.push(`${name} mounts <${c} />`);
      }
    }

    expect(offenders, `follow UI escaped the Account tab:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('no OTHER page calls the follow hooks directly', () => {
    // Mounting a component is not the only way to surface a count. Calling the hook and rendering
    // `followers.length` on a dashboard is the cheaper and likelier version of this mistake.
    const offenders: string[] = [];

    for (const file of walk(PAGES_DIR).filter(isSource)) {
      const name = file.split(/[\\/]/).pop()!;
      if (name === THE_ONE_TAB) continue;
      const src = readFileSync(file, 'utf8');
      for (const h of FOLLOW_HOOKS) {
        if (src.includes(`/hooks/${h}'`)) offenders.push(`${name} imports ${h}`);
      }
    }

    expect(offenders, `follow data escaped the Account tab:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
