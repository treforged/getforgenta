import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AKOYA_ENABLED } from '../akoya-enabled';

/**
 * THE FIDELITY-VIA-AKOYA OFFER IS OFF, AND EVERY ROUTE TO IT IS COVERED.
 *
 * Tre, 2026-09-17: "remove Connect Fidelity via Akoya btw since i never bought it. i cant even
 * do it sense its an expensive pay up front". Disabled rather than deleted - deleting would
 * touch 21 files, two deployed edge functions, a route in-flight OAuth redirects land on, and
 * two legal sentences. See `akoya-enabled.ts` for the measurements behind that choice.
 *
 * ⚠️ THE GUARD IS INSIDE THE COMPONENTS, NOT AT THE CALL SITES, and this gate enforces that.
 * A per-call-site guard is a hand-named list: it is blind to the call site nobody added to it,
 * which is the recurring failure in this repo. Guarding the component covers every present and
 * future caller by construction, so what must be asserted is that each component checks the
 * flag - not that some list of callers does.
 *
 * ⚠️ AND THE CONTROL THAT MATTERS IS NOT "IS IT HIDDEN" BUT "IS ANYTHING LEFT". An onboarding
 * step that renders nothing is the dead-screen shape this repo has already paid for, so the
 * bank step is asserted to KEEP its primary control. An absence-only suite is satisfied
 * perfectly by the feature being entirely broken.
 *
 * WHAT THIS DOES NOT PROVE: that nothing renders in a browser (that needs a rendered walk), and
 * nothing about the deployed edge functions, which are untouched and still reachable by anyone
 * calling them directly. This hides the OFFER, it does not decommission the SERVICE - and the
 * distinction matters, because the credentials are measurably still configured in production.
 */

const REPO = join(__dirname, '..', '..', '..');
const SRC = join(REPO, 'src');

const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * The components a user could reach the offer through, DERIVED by finding every file that
 * renders an Akoya control, rather than typed. If a third one is added tomorrow it joins this
 * list automatically and must carry the guard too.
 */
const AKOYA_COMPONENTS = walk(SRC)
  .map((f) => relative(REPO, f).replace(/\\/g, '/'))
  .filter((rel) => /components\/shared\/Akoya\w+\.tsx$/.test(rel));

describe('akoya disabled - positive controls', () => {
  it('the sweep reached the tree and found the Akoya components', () => {
    expect(walk(SRC).length).toBeGreaterThan(200);
    // Two today: the button and the fallback prompt. A count, so one going missing is a failure
    // rather than a quietly smaller inventory.
    expect(AKOYA_COMPONENTS).toHaveLength(2);
  });

  it('Akoya is genuinely still PRESENT in the tree - this is a disable, not a delete', () => {
    // If this ever reads 0 the feature was deleted after all, and the reasoning in
    // akoya-enabled.ts about legal text and in-flight redirects needs revisiting rather than
    // this gate quietly passing over an empty codebase.
    const mentions = walk(SRC).filter((f) => /akoya/i.test(readFileSync(f, 'utf8'))).length;
    expect(mentions).toBeGreaterThan(5);
  });
});

describe('akoya disabled - the offer is off', () => {
  it('the flag is OFF', () => {
    expect(AKOYA_ENABLED).toBe(false);
  });

  it('every Akoya component checks the flag and bails', () => {
    const missing = AKOYA_COMPONENTS.filter((rel) => {
      const src = read(rel);
      return !/AKOYA_ENABLED/.test(src) || !/if\s*\(!AKOYA_ENABLED\)\s*return null;/.test(src);
    });
    expect(missing).toEqual([]);
  });

  /**
   * The guard must sit AFTER any hooks. An early return above `useState`/`useCallback` changes
   * the hook count between renders, which React treats as an error - so a guard that is correct
   * about the flag can still be wrong about where it lives.
   */
  it('the guard sits after the hooks, never above them', () => {
    for (const rel of AKOYA_COMPONENTS) {
      const lines = read(rel).split('\n');
      const guardAt = lines.findIndex((l) => /if\s*\(!AKOYA_ENABLED\)\s*return null;/.test(l));
      expect(guardAt, `${rel}: no guard found`).toBeGreaterThan(-1);
      const hookAfterGuard = lines
        .slice(guardAt)
        .findIndex((l) => /\b(useState|useEffect|useCallback|useMemo|useRef)\s*\(/.test(l));
      expect(hookAfterGuard, `${rel}: a hook is called AFTER the guard`).toBe(-1);
    }
  });
});

describe('akoya disabled - nothing was left empty', () => {
  /**
   * THE RISK THE ASK NAMED. `AkoyaFallbackPrompt` is mounted in the ONBOARDING bank step, and an
   * onboarding step that renders nothing is worse than one that offers a route nobody wants.
   * Measured: the prompt was always CONDITIONAL (null unless Plaid reports an unreachable
   * institution) and the step's primary control is Plaid either way.
   */
  /**
   * ⚠️ MATCHED AS A RENDERED ELEMENT, NOT AS A SUBSTRING, AND THAT CORRECTION IS THE POINT.
   * The first version asserted `toContain('PlaidLinkButton')`. Renaming the element to
   * `PlaidLinkButtonRemoved` - the exact dead-screen mutation this control exists to catch -
   * STILL CONTAINS that substring, so the control passed on the defect it was written for. It
   * was the one assertion in this file guarding the risk the ask actually named, and it could
   * not fail.
   */
  const RENDERS_PLAID = /<PlaidLinkButton[\s/>]/;

  it('the onboarding bank step keeps its primary control', () => {
    expect(read('src/components/onboarding/BankConnectStep.tsx')).toMatch(RENDERS_PLAID);
  });

  it('the Accounts page keeps its primary control', () => {
    expect(read('src/pages/Accounts.tsx')).toMatch(RENDERS_PLAID);
  });

  // The matcher itself, proven able to say no - otherwise the two assertions above are a
  // pattern nobody has checked can fail.
  it('CONTROL: the element matcher rejects a renamed element', () => {
    expect(RENDERS_PLAID.test('<PlaidLinkButton onSuccess={x} />')).toBe(true);
    expect(RENDERS_PLAID.test('<PlaidLinkButtonRemoved onSuccess={x} />')).toBe(false);
  });

  /**
   * The legal text is deliberately UNCHANGED, and that is asserted so a later tidy-up does not
   * quietly narrow a privacy promise. Saying a connection would be revoked stays true when the
   * offer is merely switched off, and any connection made before today still exists.
   */
  it('the deletion promise still names Akoya', () => {
    expect(read('src/components/legal/DeleteDataContent.tsx')).toMatch(/akoya/i);
  });
});
