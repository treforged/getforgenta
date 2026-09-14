/**
 * THE PRIVACY POLICY MUST NOT CONTRADICT THE CODE, OR ITSELF.
 *
 * Found 2026-09-13 while scoping a request to add Vercel Web Analytics. Section 2 of the published
 * policy said, in a financial app:
 *
 *     "We do not use third-party analytics trackers."
 *
 * while `src/lib/analytics.ts` loads Google Analytics 4 and sends a `sign_up` event — and it is
 * CALLED: `Analytics.tsx` -> `initGA`, `AuthContext` -> `maybeTrackOAuthSignUp`, `Auth.tsx` ->
 * `trackSignUp`. Section 8a of the SAME page already described the GA / GPC / Do-Not-Track
 * behaviour correctly, so the policy contradicted itself and the absolute half was the untrue one.
 *
 * ⚠️ THIS IS A SOURCE SCAN AND THAT IS THE HONEST INSTRUMENT HERE. The claim is about what a
 * published sentence says and whether a module has callers — both textual facts. It does NOT prove
 * the deployed site behaves as described, and it cannot: `initGA` is a no-op without
 * `VITE_GA_MEASUREMENT_ID`, and Cloudflare's challenge blocks reading the production bundle.
 *
 * The tie between the two halves is the point. A policy sentence and the code it describes drift
 * silently, because nothing normally reads them together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n');

/**
 * ⚠️ COMMENTS STRIPPED BEFORE SCANNING, because my first version of this gate FAILED ON ITSELF.
 * The fix's own comment quotes the removed sentence verbatim so the next reader knows what was
 * wrong, and the scan then matched the file that quotes the thing it is looking for. The claim is
 * about the copy a USER READS, so the instrument has to look at that and nothing else.
 */
const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const legal = stripComments(read('../Legal.tsx'));
const analyticsLib = read('../../lib/analytics.ts');

/** Files that would have to call it for GA to actually run. */
const CALLER_FILES = [
  '../../components/shared/Analytics.tsx',
  '../../contexts/AuthContext.tsx',
  '../Auth.tsx',
];

describe('the analytics disclosure matches the analytics code', () => {
  it('⚠️ GOOGLE ANALYTICS IS STILL WIRED — the premise the wording depends on', () => {
    // If somebody REMOVES GA, this fails first and tells the next reader that the policy wording
    // below should be revisited, rather than leaving an overstatement in its place. A disclosure
    // can be wrong in both directions.
    expect(analyticsLib).toContain('googletagmanager.com/gtag/js');
    const callers = CALLER_FILES.filter(f => /from '@\/lib\/analytics'/.test(read(f)));
    expect(callers, 'analytics.ts has no callers - is GA still in use?').toEqual(CALLER_FILES);
  });

  it('⚠️ DOES NOT CLAIM "no third-party analytics trackers" WHILE LOADING ONE', () => {
    expect(legal).not.toMatch(/do not use third-party analytics trackers/i);
  });

  it('names Google Analytics in the section that lists what is collected', () => {
    expect(legal).toMatch(/Usage data:[\s\S]{0,400}Google Analytics/);
  });

  it('ties it to consent and to the opt-out signals, rather than stating it flatly', () => {
    const usage = legal.slice(legal.indexOf('Usage data:'), legal.indexOf('Payment data:'));
    expect(usage).toMatch(/only if you accept analytics cookies/i);
    expect(usage).toMatch(/Global Privacy Control|Do Not Track/i);
  });

  it('⚠️ KEEPS SECTION 8a, which is where the behaviour is explained in full', () => {
    // The correction must not become the only mention: the detailed section is what a reader who
    // wants to know exactly when GA loads actually needs.
    expect(legal).toMatch(/Do Not Track &amp; Global Privacy Control|Do Not Track & Global Privacy Control/);
    expect(legal).toMatch(/we do not load Google Analytics/);
  });
});
