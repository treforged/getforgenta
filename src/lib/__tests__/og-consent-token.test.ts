// The consent link is a CREDENTIAL — pressing a button behind it moves somebody's billing — so
// the rules that decide whether one is honoured are asserted here rather than reasoned about.
//
// Would-fail checks: drop the `used_at` check and "a forwarded link cannot be replayed" fails,
// which is the one that lets a third party flip somebody's answer; drop the expiry check and
// "an old link is dead" fails, which leaves a credential live in an inbox forever; make an
// unknown token report differently from a wrong one and "does not say which guesses are closer"
// fails.

import { describe, it, expect } from 'vitest';
import {
  generateConsentToken, hashConsentToken, consentTokenExpiry, verifyConsentToken,
  tokenFailureMessage, CONSENT_TOKEN_TTL_DAYS,
} from '../../../supabase/functions/_shared/og-consent-token';
import type { ConsentTokenRow } from '../../../supabase/functions/_shared/og-consent-token';

const NOW = new Date('2027-09-03T12:00:00Z');

const row = (over: Partial<ConsentTokenRow> = {}): ConsentTokenRow => ({
  user_id: 'user-1',
  consent_version: 'og-stripe-move-v1',
  expires_at: '2027-10-03T12:00:00Z',
  used_at: null,
  ...over,
});

describe('consent token generation', () => {
  it('is 256 bits of CSPRNG output, hex', () => {
    const t = generateConsentToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateConsentToken()));
    expect(seen.size).toBe(200);
  });

  it('hashes stably, and the hash is not the token', async () => {
    const t = generateConsentToken();
    const h = await hashConsentToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(t);
    expect(await hashConsentToken(t)).toBe(h);
  });

  it('gives different tokens different hashes', async () => {
    expect(await hashConsentToken('a')).not.toBe(await hashConsentToken('b'));
  });
});

describe('consentTokenExpiry', () => {
  it('is the configured number of days out', () => {
    const issued = new Date(2027, 8, 3, 12, 0, 0);
    const exp = consentTokenExpiry(issued);
    const days = Math.round((exp.getTime() - issued.getTime()) / 86400000);
    expect(days).toBe(CONSENT_TOKEN_TTL_DAYS);
  });

  it('uses calendar arithmetic, so it survives a DST boundary', () => {
    // Issued a week before US DST ends. Millisecond arithmetic would land an hour off and, at
    // the wrong time of day, a whole calendar day off — the exact bug this repo just fixed in
    // the forecast engine.
    const issued = new Date(2026, 9, 25, 0, 30, 0); // 25 Oct 2026, 00:30 local
    const exp = consentTokenExpiry(issued, 14);
    expect(exp.getDate()).toBe(8);
    expect(exp.getMonth()).toBe(10); // November
    expect(exp.getHours()).toBe(0);
    expect(exp.getMinutes()).toBe(30);
  });
});

describe('verifyConsentToken', () => {
  it('honours a live, unused link', () => {
    const v = verifyConsentToken(row(), NOW);
    expect(v).toEqual({ ok: true, user_id: 'user-1', consent_version: 'og-stripe-move-v1' });
  });

  it('A FORWARDED LINK CANNOT BE REPLAYED — a used token is refused', () => {
    const v = verifyConsentToken(row({ used_at: '2027-09-02T00:00:00Z' }), NOW);
    expect(v).toEqual({ ok: false, reason: 'already_used' });
  });

  it('an expired link is dead — an email lives in an inbox forever, a credential must not', () => {
    const v = verifyConsentToken(row({ expires_at: '2027-09-03T11:59:59Z' }), NOW);
    expect(v).toEqual({ ok: false, reason: 'expired' });
  });

  it('treats the expiry instant itself as expired, not as live', () => {
    const v = verifyConsentToken(row({ expires_at: NOW.toISOString() }), NOW);
    expect(v).toEqual({ ok: false, reason: 'expired' });
  });

  it('does not say which guesses are closer — an unknown token is just unknown', () => {
    expect(verifyConsentToken(null, NOW)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('tells someone who already answered that they answered, not that they missed it', () => {
    // Both are refusals and the security outcome is identical; the human one is not.
    const v = verifyConsentToken(row({ used_at: '2027-09-02T00:00:00Z', expires_at: '2027-09-01T00:00:00Z' }), NOW);
    expect(v).toEqual({ ok: false, reason: 'already_used' });
  });
});

describe('tokenFailureMessage', () => {
  it('always says the subscription is unchanged, so a dead link is not alarming', () => {
    for (const r of ['expired', 'unknown'] as const) {
      expect(tokenFailureMessage(r)).toContain('Nothing has changed about your subscription');
    }
  });

  it('offers a way forward rather than a dead end', () => {
    for (const r of ['expired', 'unknown', 'already_used'] as const) {
      expect(tokenFailureMessage(r).toLowerCase()).toContain('reply to the email');
    }
  });

  it('never leaks whether the token existed', () => {
    expect(tokenFailureMessage('unknown')).not.toMatch(/not found|no such|unknown token/i);
  });
});
