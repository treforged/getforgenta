// IF A TRACKER IS MOUNTED, THE PRIVACY POLICY NAMES ITS VENDOR. BOTH WAYS.
//
// ⚠️ THIS IS THE DEFECT THIS REPO ALREADY SHIPPED ONCE, IN THE OTHER DIRECTION. Until 2026-09-13
// the policy read "We do not use third-party analytics trackers" while `src/lib/analytics.ts`
// loaded GA4 and sent two events. A privacy policy for a financial app said the opposite of what
// the code did, and nothing noticed because a sentence is not a test.
//
// ⚠️ THE MIRROR IS JUST AS BAD AND FAR EASIER TO SHIP: revert the tracker, forget the sentence,
// and the policy now names a processor that receives nothing. Nobody reads that as urgent, which
// is exactly why it survives. So this asserts the BICONDITIONAL, not "the sentence exists".
//
// ⚠️ BOTH SIDES ARE DERIVED FROM THE SOURCE. A coupling test that hardcodes one side enforces
// nothing — it just restates the author's belief about what the code does on the day they wrote
// it. Here the mount is read out of `App.tsx` and the disclosure out of `Legal.tsx`, so removing
// either one moves this test.
//
// WHAT THIS DOES NOT CATCH, said plainly: whether the vendor actually RECEIVES anything (a
// network fact), whether the sentence is legally sufficient (a human judgement), and any tracker
// added by a third-party script rather than a mounted component.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const app = read('App.tsx');
const policy = read('pages', 'Legal.tsx');

/** One row per analytics vendor: how its mount is spotted, and the name the policy must use. */
const VENDORS = [
  { vendor: 'Vercel', mountedBy: /<VercelAnalytics\s*\/>/, namedAs: /Vercel Analytics/ },
  { vendor: 'Google', mountedBy: /<Analytics\s*\/>/, namedAs: /Google Analytics/ },
] as const;

describe('every mounted analytics vendor is named in the privacy policy', () => {
  it('read both files and found real content', () => {
    // Zero examined is "nothing was compared", never a pass — a moved file must not read as clean.
    expect(app.length).toBeGreaterThan(500);
    expect(policy.length).toBeGreaterThan(500);
  });

  for (const { vendor, mountedBy, namedAs } of VENDORS) {
    it(`${vendor}: mounted <-> disclosed`, () => {
      const mounted = mountedBy.test(app);
      // The policy wraps lines, so collapse whitespace before matching a two-word vendor name.
      const disclosed = namedAs.test(policy.replace(/\s+/g, ' '));
      expect(
        disclosed,
        mounted
          ? `${vendor} analytics is MOUNTED in App.tsx but the privacy policy does not name it.`
          : `${vendor} analytics is NOT mounted but the privacy policy still names it — the policy describes a processor that receives nothing.`,
      ).toBe(mounted);
    });
  }

  it('the opt-out section covers every mounted vendor', () => {
    // Section 8a promises GPC/DNT suppresses analytics. A vendor mounted but absent there is a
    // promise the app cannot keep.
    const flat = policy.replace(/\s+/g, ' ');
    const section = flat.slice(flat.indexOf('Global Privacy Control (GPC) signal'));
    for (const { vendor, mountedBy, namedAs } of VENDORS) {
      if (!mountedBy.test(app)) continue;
      expect(namedAs.test(section), `Section 8a does not name ${vendor}`).toBe(true);
    }
  });
});
