// @vitest-environment jsdom
//
// THE BUTTONS ARE PRESSED HERE, not described.
//
// This file exists because of `forged-glass`: a licence panel shipped whose Accept and Decline
// buttons BOTH threw the first time a human touched them, and every check made on it had passed —
// because those checks printed what the controls said and never pressed one. This page decides
// whether somebody's billing moves, so it is parsed as real DOM and the controls are submitted.
//
// Would-fail checks: make either button a GET and "consent is never inferred from a link click"
// fails, which is the rule that stops a mail scanner from agreeing on someone's behalf; drop the
// escaping and the injection test fails; render CURRENT_CONSENT instead of the issued version and
// "shows the wording the link was sent with" fails, which is how somebody confirms text they were
// never shown.

import { describe, it, expect } from 'vitest';
import { consentPage, noticePage, outcomeMessage, esc } from '../../../supabase/functions/_shared/og-consent-page';
import { OG_CONSENT_V1 } from '../../../supabase/functions/_shared/og-consent-text';
import type { ConsentCopy } from '../../../supabase/functions/_shared/og-consent-text';

const TOKEN = 'a'.repeat(64);
const PATH = '/og-consent';

function render(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** What the browser would actually send when this button is pressed. */
function press(doc: Document, label: string): { method: string; action: string; decision: string } {
  const button = Array.from(doc.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button labelled "${label}" — the control is missing, not just mislabelled`);
  const form = button.closest('form');
  if (!form) throw new Error(`the "${label}" button is not inside a form, so pressing it does nothing`);
  const decision = form.querySelector<HTMLInputElement>('input[name="decision"]');
  return {
    method: (form.getAttribute('method') ?? 'get').toUpperCase(),
    action: form.getAttribute('action') ?? '',
    decision: decision?.value ?? '',
  };
}

describe('the consent page', () => {
  const doc = render(consentPage(OG_CONSENT_V1, PATH, TOKEN));

  it('offers BOTH choices — declining must be as available as agreeing', () => {
    const labels = Array.from(doc.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toContain(OG_CONSENT_V1.confirmLabel);
    expect(labels).toContain(OG_CONSENT_V1.declineLabel);
    expect(labels).toHaveLength(2);
  });

  it('PRESSING CONFIRM submits a POST carrying "confirmed" and the token', () => {
    const sent = press(doc, OG_CONSENT_V1.confirmLabel);
    expect(sent.method).toBe('POST');
    expect(sent.decision).toBe('confirmed');
    expect(sent.action).toContain(`t=${TOKEN}`);
  });

  it('PRESSING DECLINE submits a POST carrying "declined"', () => {
    const sent = press(doc, OG_CONSENT_V1.declineLabel);
    expect(sent.method).toBe('POST');
    expect(sent.decision).toBe('declined');
  });

  it('NEITHER BUTTON IS A GET — consent is never inferred from following a link', () => {
    // Mail scanners and link-preview bots issue GETs. If a button were one, they would agree on
    // the person's behalf and the record would be a lie.
    const forms = Array.from(doc.querySelectorAll('form'));
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect((f.getAttribute('method') ?? 'get').toUpperCase()).toBe('POST');
    }
  });

  it('shows the exact wording the link was sent with, in full', () => {
    const body = doc.querySelector('pre')?.textContent ?? '';
    expect(body).toBe(OG_CONSENT_V1.body);
    // The parts that carry the obligation, spelled out rather than implied.
    expect(body).toContain('Stripe');
    expect(body).toContain('twelve months');
    expect(body).toContain('cancel your existing App Store or Google Play subscription');
  });

  it('renders an OLD version when that is what the link was issued for', () => {
    const older: ConsentCopy = {
      ...OG_CONSENT_V1,
      version: 'og-stripe-move-v0',
      body: 'The words they were actually sent.',
      confirmLabel: 'Old confirm',
      declineLabel: 'Old decline',
    };
    const d = render(consentPage(older, PATH, TOKEN));
    expect(d.querySelector('pre')?.textContent).toBe('The words they were actually sent.');
    expect(press(d, 'Old confirm').decision).toBe('confirmed');
  });

  it('keeps itself out of search indexes — the URL is a credential', () => {
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
  });
});

describe('escaping', () => {
  it('does not execute injected markup from the copy', () => {
    const nasty: ConsentCopy = {
      ...OG_CONSENT_V1,
      subject: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(1)>',
      confirmLabel: '"><script>alert(2)</script>',
    };
    const html = consentPage(nasty, PATH, TOKEN);
    const d = render(html);
    expect(d.querySelectorAll('script')).toHaveLength(0);
    expect(d.querySelectorAll('img')).toHaveLength(0);
    // The text still reaches the reader — escaped, not dropped.
    expect(d.querySelector('pre')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('escapes a token that tries to break out of the action attribute', () => {
    const d = render(consentPage(OG_CONSENT_V1, PATH, '" onmouseover="alert(1)'));
    const forms = Array.from(d.querySelectorAll('form'));
    for (const f of forms) {
      expect(f.getAttribute('onmouseover')).toBeNull();
    }
  });

  it('escapes the five characters that matter', () => {
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('what they are told afterwards', () => {
  it('tells a confirmer to cancel the store subscription ONLY AFTER it is active', () => {
    // The order is the whole point: cancel first and they lose access; never cancel and they pay
    // twice. Repeated on this page because the email is scrolled away by now.
    const { message } = outcomeMessage('confirmed');
    expect(message).toContain('only then should you cancel');
    expect(message).toContain('never left without access');
  });

  it('reassures a decliner that nothing changes', () => {
    const { message } = outcomeMessage('declined');
    expect(message).toContain('Nothing changes');
    expect(message).not.toContain('cancel');
  });

  it('renders a notice with no buttons at all — a dead link offers nothing to press', () => {
    const d = render(noticePage('Forgenta', 'This link has expired.'));
    expect(d.querySelectorAll('button')).toHaveLength(0);
    expect(d.querySelectorAll('form')).toHaveLength(0);
    expect(d.body.textContent).toContain('This link has expired.');
  });
});
