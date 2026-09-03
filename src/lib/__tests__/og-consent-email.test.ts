// @vitest-environment jsdom
//
// What a hundred founding members actually receive, asserted before it is sent. Sending is not
// undoable — an email with the wrong link or the wrong terms cannot be recalled, and this is the
// one email in the product that carries a legal obligation.
//
// Would-fail checks: point the link at a deep link into the app and "never sends them into the
// app" fails, which is the App Store anti-steering line; summarise the terms instead of rendering
// copy.body and "the same words as the page and the record" fails, which is how "what did they
// actually see?" becomes unanswerable; drop the text part and "a text-only client sees the same
// terms" fails.

import { describe, it, expect } from 'vitest';
import { buildAskEmail, consentLink, esc } from '../../../supabase/functions/_shared/og-consent-email';
import { OG_CONSENT_V1 } from '../../../supabase/functions/_shared/og-consent-text';

const BASE = 'https://mdtosrbfkextcaezuclh.functions.supabase.co';
const TOKEN = 'b'.repeat(64);
const LINK = consentLink(BASE, TOKEN);

describe('consentLink', () => {
  it('points at the WEB consent page, carrying the token', () => {
    expect(LINK).toBe(`${BASE}/og-consent?t=${TOKEN}`);
  });

  it('NEVER SENDS THEM INTO THE APP — no custom scheme, no deep link', () => {
    // The anti-steering line: the ask is email, the confirmation is web. A link into the app is
    // the single most likely "improvement" that would break it.
    expect(LINK.startsWith('https://')).toBe(true);
    expect(LINK).not.toMatch(/forgenta:\/\/|capacitor:\/\/|intent:\/\//);
  });

  it('tolerates a base URL with a trailing slash rather than emitting a double slash', () => {
    expect(consentLink(`${BASE}/`, TOKEN)).toBe(`${BASE}/og-consent?t=${TOKEN}`);
  });

  it('percent-encodes the token instead of pasting it raw into a query string', () => {
    expect(consentLink(BASE, 'a b&c')).toBe(`${BASE}/og-consent?t=a%20b%26c`);
  });
});

describe('the ask email', () => {
  const mail = buildAskEmail(OG_CONSENT_V1, LINK);
  const doc = new DOMParser().parseFromString(mail.html, 'text/html');
  const rendered = doc.body.textContent ?? '';

  it('carries the SAME WORDS as the page and the record, not a summary', () => {
    // og-consent-text.ts rule 2: one constant, three renderers.
    for (const para of OG_CONSENT_V1.body.split('\n\n').map(p => p.trim()).filter(Boolean)) {
      expect(rendered).toContain(para);
    }
  });

  it('names Stripe, the twelve months, and the cancel-SECOND instruction', () => {
    // Consent to an unnamed thing is not consent; and the cancel order is what stops them
    // either losing access or paying twice.
    expect(rendered).toContain('Stripe');
    expect(rendered).toContain('twelve months');
    expect(rendered).toContain('Do not cancel it first');
  });

  it('offers the link as a real anchor AND as pasteable text', () => {
    const hrefs = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toContain(LINK);
    expect(rendered).toContain(LINK);
  });

  it('sends them to exactly one place — no competing links to click', () => {
    const hrefs = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(new Set(hrefs)).toEqual(new Set([LINK]));
  });

  it('says declining is free of consequence, so the ask does not read as pressure', () => {
    expect(rendered.toLowerCase()).toContain('declining changes nothing about your subscription');
    expect(rendered.toLowerCase()).toContain('nothing happens until you choose');
  });

  it('warns that the link is personal — it is a credential', () => {
    expect(rendered.toLowerCase()).toContain("don't forward it");
  });

  it('A TEXT-ONLY CLIENT SEES THE SAME TERMS, not a stub', () => {
    expect(mail.text).toContain(OG_CONSENT_V1.body);
    expect(mail.text).toContain(LINK);
    expect(mail.text.toLowerCase()).not.toContain('enable html');
  });

  it('uses the copy version\'s own subject, so the record and the inbox agree', () => {
    expect(mail.subject).toBe(OG_CONSENT_V1.subject);
  });

  it('escapes injected markup rather than rendering it', () => {
    const nasty = { ...OG_CONSENT_V1, subject: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' };
    const d = new DOMParser().parseFromString(buildAskEmail(nasty, LINK).html, 'text/html');
    expect(d.querySelectorAll('script')).toHaveLength(0);
    expect(d.querySelectorAll('img')).toHaveLength(0);
  });

  it('escapes a link crafted to break out of the href attribute', () => {
    const d = new DOMParser().parseFromString(
      buildAskEmail(OG_CONSENT_V1, '" onmouseover="alert(1)').html, 'text/html',
    );
    expect(d.querySelector('a')?.getAttribute('onmouseover')).toBeNull();
  });

  it('escapes the five characters that matter', () => {
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
