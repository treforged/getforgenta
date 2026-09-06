// THE BADGE MUST NEVER SAY THE WRONG PERSON, AND MUST NEVER INVENT ONE.
//
// ⚠️ WHY THIS EXISTS. Until 2026-09-06 nothing in the chrome answered "whose money is this" —
// no avatar, no account indicator, no initials component anywhere in `src/` (verified by grep).
// In partner view the app renders somebody else's finances with identical layout and formatting,
// so the only distinguishing signal was a banner a person had to notice.
//
// The load-bearing case is the LAST one: a partner with no display name must still read as NOT
// YOU. A fallback that says "You" there would be the exact failure this control exists to stop.

import { describe, it, expect } from 'vitest';
import { resolveIdentity, initialsFrom } from '@/lib/identity-badge';

describe('initialsFrom', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFrom('TreVon Hines')).toBe('TH');
  });

  it('gives ONE letter for a single-word name, not a truncation', () => {
    // "Tr" reads as a chopped word rather than as initials.
    expect(initialsFrom('Tre')).toBe('T');
  });

  it('ignores extra whitespace rather than producing a blank initial', () => {
    expect(initialsFrom('  Ada   Lovelace  ')).toBe('AL');
  });

  it('returns empty for nothing, rather than a placeholder', () => {
    expect(initialsFrom('   ')).toBe('');
  });
});

describe('resolveIdentity', () => {
  const base = { isDemo: false, isPartnerView: false };

  it('names the signed-in person when a display name exists', () => {
    const r = resolveIdentity({ ...base, displayName: 'TreVon Hines', email: 'tre@treforged.com' });
    expect(r.label).toBe('TreVon Hines');
    expect(r.initials).toBe('TH');
    expect(r.kind).toBe('own');
    expect(r.known).toBe(true);
  });

  it('⚠️ NEVER turns an email into a name', () => {
    // An address is not a name. Presenting "tre" as somebody's name is a guess read as a fact.
    const r = resolveIdentity({ ...base, displayName: null, email: 'tre@treforged.com' });
    expect(r.label).toBe('You');
    expect(r.known).toBe(false);
    expect(r.label).not.toMatch(/tre/i);
    // The first character IS honest — the person chose it — so it survives as an initial only.
    expect(r.initials).toBe('T');
  });

  it('shows no initial at all when there is nothing honest to build one from', () => {
    const r = resolveIdentity({ ...base, displayName: '  ', email: null });
    expect(r.initials).toBe('');
    expect(r.known).toBe(false);
  });

  it('names the partner, not the signed-in user, in partner view', () => {
    const r = resolveIdentity({
      isDemo: false, isPartnerView: true, partnerLabel: 'Jaimmie', displayName: 'TreVon Hines',
    });
    expect(r.label).toBe('Jaimmie');
    expect(r.initials).toBe('J');
    expect(r.kind).toBe('partner');
    expect(r.title).toBe("Viewing Jaimmie's account");
  });

  it('⚠️ AN UNNAMED PARTNER STILL READS AS NOT-YOU — the case this control exists for', () => {
    // A partner who never set a display name must not fall back to the signed-in user's own
    // identity. That would show somebody else's money under your own name.
    const r = resolveIdentity({
      isDemo: false, isPartnerView: true, partnerLabel: null, displayName: 'TreVon Hines',
    });
    expect(r.kind).toBe('partner');
    expect(r.label).toBe('Partner');
    expect(r.label).not.toBe('TreVon Hines');
    expect(r.label).not.toBe('You');
    expect(r.known).toBe(false);
  });

  it('demo wins over every other reading', () => {
    const r = resolveIdentity({
      isDemo: true, isPartnerView: true, partnerLabel: 'Jaimmie', displayName: 'TreVon Hines',
    });
    expect(r.kind).toBe('demo');
    expect(r.label).toBe('Demo');
  });

  it('always produces a spoken title, whatever the inputs', () => {
    // The two-letter badge cannot say the relationship; the accessible name has to.
    const cases = [
      { isDemo: true, isPartnerView: false },
      { isDemo: false, isPartnerView: true, partnerLabel: null },
      { isDemo: false, isPartnerView: false, displayName: null, email: null },
    ];
    for (const c of cases) expect(resolveIdentity(c).title.length).toBeGreaterThan(10);
  });
});
