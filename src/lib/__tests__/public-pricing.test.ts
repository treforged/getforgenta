// WARNING: what this protects. Two rules, and the first is a trap the sibling feature does NOT
// share.
//
//   1. Pricing defaults to SHOWN. `maintenance_public` defaults to hidden because nothing had ever
//      been shared; pricing has been on every shared build page since the feature existed, so an
//      absent or null flag must keep showing it. Copying the maintenance default here would
//      silently blank the prices on every link already sent to somebody.
//   2. The gate is applied at the FETCH, not at the render. A price that reaches the browser and is
//      merely not drawn is still published - it sits in the network tab of anyone with the link.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldPublishPricing } from '@/lib/public-pricing';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const fnSrc = read('../../../supabase/functions/public-build/index.ts');
const pageSrc = read('../../pages/BuildShare.tsx');

describe('the default direction, which is the opposite of the maintenance log', () => {
  it('shows pricing when the flag is absent, null or true', () => {
    expect(shouldPublishPricing({})).toBe(true);
    expect(shouldPublishPricing({ pricing_public: null })).toBe(true);
    expect(shouldPublishPricing({ pricing_public: true })).toBe(true);
  });

  // The only thing that hides it. Nothing else may be read as "the owner opted out".
  it('hides pricing only on an explicit false', () => {
    expect(shouldPublishPricing({ pricing_public: false })).toBe(false);
  });
});

describe('the Edge Function drops the column rather than sending it to be ignored', () => {
  it('selects price only on the public branch', () => {
    expect(fnSrc).toContain('"id, phase_id, build_id, name, brand, price, link, completed, sort_order"');
    expect(fnSrc).toContain('"id, phase_id, build_id, name, brand, link, completed, sort_order"');
  });

  it('reads the flag with the show-by-default rule, not === true', () => {
    expect(fnSrc).toContain('build.pricing_public !== false');
    expect(fnSrc).not.toContain('pricing_public === true');
  });

  it('strips the owner-only flag from the build object it returns', () => {
    expect(fnSrc).toContain('pricing_public: _pricingFlag');
  });

  it('reports the flag once, on its own', () => {
    expect(fnSrc).toContain('pricingPublic,');
  });
});

describe('the share page hides the derived figures too, not just the line items', () => {
  // Leaving the total while hiding the items publishes the number the owner held back - and with
  // the item list still visible, a total plus one known part price starts giving the rest away.
  it('gates the build total', () => {
    expect(pageSrc).toContain('{pricingPublic && (<>');
  });

  it('gates the phase total', () => {
    expect(pageSrc).toContain('!pricingPublic ? null : phTotal');
  });

  it('gates the per-item price', () => {
    expect(pageSrc).toContain('{pricingPublic && (');
  });

  it('reads the flag off the payload rather than re-deriving it', () => {
    expect(pageSrc).toContain('pricingPublic } = data;');
  });
});
