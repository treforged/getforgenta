/**
 * 5874c945 - THE PRIVACY POLICY NAMES THE EMAIL AND PUSH PROCESSORS THE CODE ACTUALLY CALLS.
 *
 * Found 2026-09-30 in a compliance pass: every Resend send (invites, billing consent, newsletter,
 * confirmation reminders) and every push (APNs, FCM) passed personal data to a processor the policy
 * never named. Same shape as Legal.analyticsDisclosure.test.ts: a policy sentence and the code it
 * describes drift silently, because nothing normally reads them together.
 *
 * DERIVED, NOT HAND-NAMED: each processor is required ONLY when the code calls its host, so the
 * gate goes red if a new processor is wired in without a sentence, and would not demand a sentence
 * for one the code stops using. A source scan - it says nothing about the deployed page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const legal = stripComments(readFileSync(resolve(here, '../Legal.tsx'), 'utf8'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return /__tests__|node_modules/.test(n) ? [] : walk(p);
    return /\.ts$/.test(n) ? [p] : [];
  });
}
const functionsSrc = walk(resolve(here, '../../../supabase/functions')).map(p => readFileSync(p, 'utf8')).join('\n');

const PROCESSORS = [
  { host: 'api.resend.com', named: /Resend/ },
  // \s+ because JSX prose wraps: "Apple Push Notification" and "service" sit on two lines.
  { host: 'api.push.apple.com', named: /Apple\s+Push\s+Notification\s+service/ },
  { host: 'fcm.googleapis.com', named: /Firebase\s+Cloud\s+Messaging/ },
];

describe('the privacy policy names every email and push processor the code calls', () => {
  it('positive control: the scan reads the function sources and finds each host', () => {
    // A broken walk would read nothing, and "nothing called" would require nothing named.
    for (const p of PROCESSORS) expect(functionsSrc.includes(p.host), `${p.host} not found in supabase/functions`).toBe(true);
  });

  for (const p of PROCESSORS) {
    it(`${p.host} is called, so the policy names it`, () => {
      if (functionsSrc.includes(p.host)) expect(legal).toMatch(p.named);
    });
  }
});
