// THE DEMO FIXTURE IS A MARKETING ASSET, AND THIS IS THE GUARD ON IT.
//
// Tre's real accounts are not marketing material, so this fixture is the ONLY thing that can be
// filmed or screenshotted — every reel, every App Store image, every post. Before 2026-09-03 it
// had zero balance tranches, so `promoExpiryWarnings` returned nothing and the strongest sentence
// the app produces was unreachable from the demo and existed only on Tre's real cards.
//
// WITHOUT THIS TEST THE FIXTURE DEGRADES SILENTLY. A later edit that drops the tranche, rounds a
// balance or shifts the promo date past its usefulness would leave published images making claims
// the engine no longer computes, and nothing would go red. That is the failure class this repo
// has hit all day, aimed at material that is already public.
//
// The bar is `tre-forged-marketing/docs/DEMO-FIXTURE-SPEC.md`, six conditions, all six required.
// EVERY FIGURE HERE IS COMPUTED BY THE ENGINE FROM THE COMMITTED FIXTURE. Nothing is written to
// make a sentence read well — a tuned fixture is a fabricated demo, and it would repeat in every
// asset forever rather than once.

import { describe, it, expect } from 'vitest';
import { demoAccounts } from '../demo-data';
import { promoExpiryWarnings } from '../balance-tranches';
import { formatCurrency } from '../calculations';

const AS_OF = '2026-09-03';

function repriceLines(): { hook: string; full: string; balance: number; extra: number }[] {
  const out: { hook: string; full: string; balance: number; extra: number }[] = [];
  for (const c of demoAccounts.filter(a => a.account_type === 'credit_card')) {
    const tranches = (c as unknown as { balance_tranches?: unknown[] }).balance_tranches ?? [];
    for (const w of promoExpiryWarnings(tranches as never, Number(c.apr ?? 0), AS_OF)) {
      const when = new Date(w.promoEndDate + 'T00:00:00')
        .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const hook = `${formatCurrency(w.balance, false)} at ${w.promoApr}% reprices to ${w.standardApr}%`;
      out.push({
        hook,
        full: `${hook} on ${when} (+${formatCurrency(w.extraMonthlyInterest, false)}/mo) — `
          + `clearing it first needs ${formatCurrency(w.requiredMonthlyPaydown, false)}/mo for ${w.monthsRemaining} months`,
        balance: w.balance,
        extra: w.extraMonthlyInterest,
      });
    }
  }
  return out;
}

describe('the demo fixture can produce a filmable line', () => {
  it('PRODUCES AT LEAST ONE REPRICE LINE — the whole point', () => {
    // This is the assertion that was failing silently before it existed: zero tranches meant zero
    // warnings meant nothing to film.
    expect(repriceLines().length).toBeGreaterThan(0);
  });

  it('F1 — carries two distinct figures, one money and one rate', () => {
    const l = repriceLines()[0].full;
    expect(l).toMatch(/\$[\d,]+/);
    expect(l).toMatch(/\d+(\.\d+)?%/);
  });

  it('F2 — names a specific future date, not "soon"', () => {
    expect(repriceLines()[0].full).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });

  it('F3 — uses a change verb, not a state verb', () => {
    expect(repriceLines()[0].full).toContain('reprices');
  });

  it('F4 — carries a figure nobody computes in their head', () => {
    // The monthly consequence is the differential times the balance over twelve. A person holding
    // the statement cannot get it in ten seconds, which is what separates this from a label.
    expect(repriceLines()[0].full).toMatch(/\(\+\$\d+\/mo\)/);
  });

  it('F5 — the hook fits the frame: 12 words and 70 characters', () => {
    const { hook } = repriceLines()[0];
    expect(hook.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(hook.length).toBeLessThanOrEqual(70);
  });

  it('F6 — leaves a fresh figure for the punch', () => {
    const { hook, full } = repriceLines()[0];
    const punch = full.slice(hook.length);
    expect(punch).toMatch(/needs \$[\d,]+\/mo/);
  });
});

describe('the fixture stays inside the marketing band', () => {
  it('individual promo balance is $1,200-$5,500 — relatable, not somebody else\'s problem', () => {
    for (const l of repriceLines()) {
      expect(l.balance).toBeGreaterThanOrEqual(1200);
      expect(l.balance).toBeLessThanOrEqual(5500);
    }
  });

  it('the monthly consequence is $40-$150 — a phone bill, a unit people feel', () => {
    for (const l of repriceLines()) {
      expect(l.extra).toBeGreaterThanOrEqual(40);
      expect(l.extra).toBeLessThanOrEqual(150);
    }
  });

  it('total card debt is $4,000-$12,000', () => {
    const total = demoAccounts.filter(a => a.account_type === 'credit_card')
      .reduce((s, a) => s + Number(a.balance ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(4000);
    expect(total).toBeLessThanOrEqual(12000);
  });

  it('NO REAL CARD OR BANK NAMES — this is published material', () => {
    // A real issuer's mark in a fabricated financial screenshot reads as endorsement, and fails
    // the "obviously synthetic" half of the bar.
    const REAL = /chase|discover|amex|american express|capital one|citi|wells fargo|barclay|robinhood|apple card|visa|mastercard/i;
    for (const a of demoAccounts) {
      expect(REAL.test(String(a.name)), `account name "${a.name}"`).toBe(false);
      expect(REAL.test(String(a.institution ?? '')), `institution "${a.institution}"`).toBe(false);
    }
  });

  it('no promo balance sits near one of Tre\'s real ones', () => {
    // A published screenshot must not partially disclose the position the fixture exists to
    // protect. His promo tranches on 2026-09-03: 3562, 2845, 899, 828, 299.
    const HIS = [3562, 2845, 899, 828, 299];
    for (const l of repriceLines()) {
      for (const h of HIS) {
        expect(Math.abs(l.balance - h), `fixture ${l.balance} vs real ${h}`).toBeGreaterThan(200);
      }
    }
  });
});
