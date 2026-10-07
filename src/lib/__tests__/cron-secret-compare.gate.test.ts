import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Every edge function that reads CRON_SECRET must check it with cronSecretMatches (constant-time, and an
// unset secret never authorises), never with `!==` / `===` (security review db1d6813, 2026-10-07).
// The helper's own behaviour is owned by plaid-webhook-register.test.ts.
const FN = path.resolve(__dirname, '../../../supabase/functions');

const readers = readdirSync(FN)
  .filter((d) => !d.startsWith('_') && existsSync(path.join(FN, d, 'index.ts')))
  .map((d) => ({ name: d, src: readFileSync(path.join(FN, d, 'index.ts'), 'utf-8') }))
  .filter((f) => /Deno\.env\.get\(\s*["']CRON_SECRET["']\s*\)/.test(f.src));

describe('cron functions compare the secret in constant time', () => {
  it('the scan finds the cron functions (positive control)', () => {
    expect(readers.length).toBeGreaterThanOrEqual(10);
    expect(readers.map((r) => r.name)).toContain('plaid-sync-all');
  });

  it('every CRON_SECRET reader calls cronSecretMatches', () => {
    expect(readers.filter((r) => !/cronSecretMatches\(/.test(r.src)).map((r) => r.name)).toEqual([]);
  });

  it('no function compares a secret with a plain equality', () => {
    expect(readers.filter((r) => /secret\s*[!=]==?\s*expected|expected\s*[!=]==?\s*secret/.test(r.src)).map((r) => r.name)).toEqual([]);
  });
});

// The same rule for the three non-cron secrets (security reel DcGb7DjPH_m #1, ask 3e970880, 2026-10-07):
// grant-promo-premium compared the SERVICE-ROLE key with `!==`, reddit-scout and revenuecat-webhook their
// webhook secrets. A plain `!==` exits at the first differing character, so response time leaks the prefix.
const NAMED: Array<{ name: string; plain: RegExp }> = [
  { name: 'grant-promo-premium', plain: /providedKey\s*[!=]==?\s*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY\s*[!=]==?\s*providedKey/ },
  { name: 'reddit-scout', plain: /secret\s*[!=]==?\s*REDDIT_SCOUT_SECRET|REDDIT_SCOUT_SECRET\s*[!=]==?\s*secret/ },
  { name: 'revenuecat-webhook', plain: /providedSecret\s*[!=]==?\s*secret\b|\bsecret\s*[!=]==?\s*providedSecret/ },
];

describe('webhook and service-role secrets are compared in constant time', () => {
  for (const { name, plain } of NAMED) {
    const src = readFileSync(path.join(FN, name, 'index.ts'), 'utf-8');
    it(`${name} calls cronSecretMatches`, () => {
      expect(src).toMatch(/cronSecretMatches\(/);
    });
    it(`${name} has no plain equality on its secret`, () => {
      expect(plain.test(src)).toBe(false);
    });
  }
});
