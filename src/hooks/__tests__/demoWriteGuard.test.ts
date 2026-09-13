/**
 * NO WRITE PATH MAY ESCAPE DEMO MODE.
 *
 * ⚠️ THIS GATE EXISTS BECAUSE ELEVEN OF THEM DID, AND THE READ SIDE MADE IT INVISIBLE.
 * Measured 2026-09-13: every mutation in the car-builds family (`useCarBuilds`,
 * `useCarBuildPhases`, `useCarBuildItems`, `useCarMaintenanceLogs`) guarded only
 * `isPartnerView || !user`. Their QUERIES serve demo FIXTURES, so a signed-in visitor in demo saw
 * fabricated builds — and a press wrote to their REAL account. `add` is the one that actually
 * corrupts: it inserts with `user_id: user.id` and no fixture id to miss, so adding a build, a
 * phase, an item or a maintenance log while "just looking at the demo" created REAL rows. The
 * update paths are the quieter failure: they target a fixture id that matches no real row, affect
 * nothing, and toast success.
 *
 * ⚠️ AND IT IS A SOURCE SCAN ON PURPOSE. Rendering 57 mutations through a provider to press each
 * one is not a test anybody maintains, and jsdom would tell us nothing extra — the property being
 * asserted is textual: the guard is present in the body. Stating the instrument rather than
 * implying this proves runtime behaviour.
 *
 * WHAT IT DOES NOT CATCH, said plainly: a guard that is present but wrong (the right words in the
 * wrong order, or a condition that can never be true), a write performed outside this file, and
 * anything reaching Supabase directly from a component. It catches the whole class that actually
 * occurred — somebody adding a hook family and copying the neighbouring guard, which omitted demo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = resolve(__dirname, '../useSupabaseData.ts');

interface Mutation {
  /** The exported hook the mutation sits inside, for a failure message that names the culprit. */
  owner: string;
  line: number;
  body: string;
}

function mutations(): Mutation[] {
  const src = readFileSync(SOURCE, 'utf8');
  const lines = src.split('\n');

  // Which exported hook each line belongs to.
  const ownerAt: string[] = [];
  let current = '(module scope)';
  for (const line of lines) {
    const m = /^export function (\w+)/.exec(line);
    if (m) current = m[1];
    ownerAt.push(current);
  }

  const out: Mutation[] = [];
  const starts: number[] = [];
  const re = /useMutation\(/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(src)) !== null) starts.push(hit.index);

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : src.length;
    const line = src.slice(0, from).split('\n').length;
    out.push({ owner: ownerAt[line - 1] ?? '(unknown)', line, body: src.slice(from, to) });
  }
  return out;
}

describe('every mutation in useSupabaseData refuses to write in demo mode', () => {
  const all = mutations();

  it('⚠️ FINDS A MEANINGFUL NUMBER OF MUTATIONS — a scan that matches nothing passes vacuously', () => {
    // The count that made this gate necessary was 57. A parser change that silently matched zero
    // would otherwise report a perfectly clean file, which is the shape this repo keeps cataloguing.
    expect(all.length).toBeGreaterThan(40);
  });

  it('names `isDemo` in every single one', () => {
    const unguarded = all.filter(m => !m.body.includes('isDemo')).map(m => `${m.owner} (line ${m.line})`);
    expect(unguarded, `these write paths do not mention isDemo:\n  ${unguarded.join('\n  ')}`).toEqual([]);
  });

  it('⚠️ THE CAR-BUILDS FAMILY SPECIFICALLY, because that is the family that was open', () => {
    // Named rather than left to the sweep above: if somebody re-adds these hooks from an older
    // copy, the general case and this case fail together and the message says which feature.
    const carHooks = ['useCarBuilds', 'useCarBuildPhases', 'useCarBuildItems', 'useCarMaintenanceLogs'];
    for (const hook of carHooks) {
      const owned = all.filter(m => m.owner === hook);
      expect(owned.length, `${hook} has no mutations — has it been renamed?`).toBeGreaterThan(0);
      for (const m of owned) {
        expect(m.body, `${hook} line ${m.line} can write in demo mode`).toContain('isDemo');
      }
    }
  });
});
