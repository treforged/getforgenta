/**
 * THE COPY MUST NOT OUT-DRIFT THE ENFORCEMENT.
 *
 * On 2026-09-18 the paywall advertised "Up to 3 linked accounts" and "manual-only on free"
 * while the server enforced 10 and 1. The figures had been TYPED in five places, so nothing
 * anywhere could notice they disagreed.
 *
 * ⚠️ THE SERVER IS THE AUTHORITY. This asserts the CLIENT constants in `src/lib/plan-limits.ts`
 * still equal what `supabase/functions/` actually enforces. The client cannot import Deno modules,
 * so a shared constant is not available across that boundary - an assertion is.
 *
 * ⚠️ THE EDGE-FUNCTION LIST IS DERIVED, NOT HAND-NAMED. A hand-named list is blind to the provider
 * route nobody added to it, which is this repo's most-recorded gate failure. Every `index.ts` under
 * `supabase/functions/` is scanned, and ZERO FOUND IS A FAILURE rather than a pass - "no ceilings
 * found" and "all ceilings agree" must never look the same.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FREE_LINK_LIMIT, PREMIUM_MAX_LINKED, bankLinkCeilingFor } from '../plan-limits';

const ROOT = process.cwd();
const FUNCTIONS = resolve(ROOT, 'supabase/functions');

/** Every `const MAX_LINKED = <n>` under supabase/functions, as [route, value] pairs. */
function serverCeilings(): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const entry of readdirSync(FUNCTIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(FUNCTIONS, entry.name, 'index.ts');
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/const\s+MAX_LINKED\s*=\s*(\d+)/g)) {
      out.push([entry.name, Number(m[1])]);
    }
  }
  return out;
}

describe('the instrument can find what it is looking for', () => {
  it('CONTROL: finds at least one server ceiling - zero means the scan is broken', () => {
    // Without this, a renamed constant or a moved directory makes every assertion below vacuous.
    expect(serverCeilings().length).toBeGreaterThan(0);
  });

  it('CONTROL: the server entitlement module is readable and declares the free limit', () => {
    const src = readFileSync(resolve(FUNCTIONS, '_shared/bank-link-entitlement.ts'), 'utf8');
    expect(src).toMatch(/export const FREE_LINK_LIMIT\s*=\s*\d+/);
  });
});

describe('client plan limits agree with what the server enforces', () => {
  it('the free ceiling matches bank-link-entitlement.ts', () => {
    const src = readFileSync(resolve(FUNCTIONS, '_shared/bank-link-entitlement.ts'), 'utf8');
    const m = src.match(/export const FREE_LINK_LIMIT\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(FREE_LINK_LIMIT);
  });

  it('EVERY provider route agrees with the premium ceiling', () => {
    const found = serverCeilings();
    for (const [route, value] of found) {
      expect(value, `supabase/functions/${route}/index.ts declares MAX_LINKED = ${value}`)
        .toBe(PREMIUM_MAX_LINKED);
    }
  });

  it('bankLinkCeilingFor returns the two limits and nothing else', () => {
    expect(bankLinkCeilingFor(true)).toBe(PREMIUM_MAX_LINKED);
    expect(bankLinkCeilingFor(false)).toBe(FREE_LINK_LIMIT);
    expect(PREMIUM_MAX_LINKED).toBeGreaterThan(FREE_LINK_LIMIT);
  });
});

describe('the paywall copy is derived from those limits, not typed', () => {
  const UPSELL = readFileSync(resolve(ROOT, 'src/components/onboarding/PremiumUpsellStep.tsx'), 'utf8');

  it('interpolates the constants instead of naming a number', () => {
    expect(UPSELL).toContain('${PREMIUM_MAX_LINKED} linked accounts');
    expect(UPSELL).toContain('${FREE_LINK_LIMIT} on free');
  });

  it('no longer claims 3 accounts, or that free is manual-only', () => {
    const copy = UPSELL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(copy).not.toContain('Up to 3 linked accounts');
    expect(copy.toLowerCase()).not.toContain('manual-only on free');
  });

  it('CONTROL: the read really is the upsell file', () => {
    expect(UPSELL).toContain('PremiumUpsellStep');
    expect(UPSELL.length).toBeGreaterThan(1_000);
  });
});
