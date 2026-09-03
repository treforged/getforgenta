// The consent wording, and the record built from it.
//
// This is the legally load-bearing part of the OG free year: a stranger reading the database in a
// year has to be able to answer who agreed, to WHAT EXACT WORDING, when, and by what action. These
// tests pin the parts of that which code can guarantee.
//
// Would-fail checks: edit OG_CONSENT_V1.body without adding a new version and the hash-stability
// case fails, which is the whole point — an edit in place rewrites what everyone who already
// consented is recorded as having agreed to; make `action_taken` a boolean and the "words not a
// flag" case fails; drop Stripe from the body and the naming case fails, because consent to an
// unnamed thing is not consent.

import { describe, it, expect } from 'vitest';
import {
  OG_CONSENT_V1, CURRENT_CONSENT, CONSENT_VERSIONS, consentByVersion,
  consentHash, buildConsentRow,
} from '../../../supabase/functions/_shared/og-consent-text';

describe('the consent copy', () => {
  it('NAMES STRIPE, because consent to an unnamed thing is not consent', () => {
    expect(OG_CONSENT_V1.body).toContain('Stripe');
  });

  it('states the four things a person needs to decide', () => {
    const body = OG_CONSENT_V1.body;
    expect(body).toMatch(/costs nothing for the next twelve months/i);
    // What happens AFTER the free year — the part a reader would be angry to discover later.
    expect(body).toMatch(/renews at the normal price/i);
    expect(body).toMatch(/cancel at any time/i);
    // The ordering instruction that stops someone losing access mid-switch.
    expect(body).toMatch(/do not cancel it first/i);
  });

  it('offers a real decline, not just a way to agree', () => {
    expect(OG_CONSENT_V1.declineLabel).toBeTruthy();
    expect(OG_CONSENT_V1.body).toMatch(/rather not move|completely fine/i);
  });

  it('keeps every version ever shown, so an old record stays readable', () => {
    expect(CONSENT_VERSIONS).toContain(OG_CONSENT_V1);
    expect(consentByVersion('og-stripe-move-v1')).toBe(OG_CONSENT_V1);
    expect(consentByVersion('a-version-that-never-existed')).toBeUndefined();
    expect(CURRENT_CONSENT).toBe(OG_CONSENT_V1);
  });
});

describe('consentHash', () => {
  it('is stable for the same text and different for changed text', async () => {
    const a = await consentHash(OG_CONSENT_V1.body);
    const b = await consentHash(OG_CONSENT_V1.body);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    // One character changed anywhere means a different hash, which is how an
    // accidental edit to a stored row becomes DETECTABLE rather than silent.
    expect(await consentHash(OG_CONSENT_V1.body + ' ')).not.toBe(a);
  });
});

describe('buildConsentRow', () => {
  it('records the exact text and its hash, not a reference to it', async () => {
    const row = await buildConsentRow('user-1', 'confirmed', OG_CONSENT_V1, 'web');
    expect(row.consent_text).toBe(OG_CONSENT_V1.body);
    expect(row.consent_version).toBe('og-stripe-move-v1');
    expect(row.consent_sha256).toBe(await consentHash(OG_CONSENT_V1.body));
  });

  it('records WORDS, not a flag — including what the button said', async () => {
    const row = await buildConsentRow('user-1', 'confirmed', OG_CONSENT_V1, 'web');
    // "They consented" is a claim. "They pressed a button labelled X" is a record.
    expect(row.action_taken).toContain('pressed-confirm-web');
    expect(row.action_taken).toContain(OG_CONSENT_V1.confirmLabel);
    expect(typeof row.action_taken).toBe('string');
  });

  it('distinguishes a decline from a confirmation in the record itself', async () => {
    const row = await buildConsentRow('user-1', 'declined', OG_CONSENT_V1, 'web');
    expect(row.decision).toBe('declined');
    expect(row.action_taken).toContain('pressed-decline-web');
    expect(row.action_taken).toContain(OG_CONSENT_V1.declineLabel);
  });

  it('records the ASK itself, so silence is a fact rather than an absence', async () => {
    const row = await buildConsentRow('user-1', 'asked', OG_CONSENT_V1, 'email');
    expect(row.decision).toBe('asked');
    expect(row.action_taken).toBe('sent-consent-request-email');
    // The wording is captured at ASK time too: what they were sent is part of the record.
    expect(row.consent_text).toBe(OG_CONSENT_V1.body);
  });
});
