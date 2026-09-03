/**
 * The exact words an OG is asked to agree to, versioned.
 *
 * THIS FILE IS THE EVIDENCE. `og_billing_consent` stores the text a person
 * actually saw plus its version and a SHA-256, rather than pointing at live
 * copy — because copy gets edited, and a record that references current text
 * would silently start claiming people agreed to something they never read.
 *
 * THREE RULES FOR CHANGING ANYTHING BELOW:
 *
 *  1. **Never edit a version in place.** Add a new one. An edit rewrites what
 *     everybody who already consented is recorded as having agreed to, which is
 *     the exact failure the stored-not-referenced design exists to prevent.
 *  2. **The same string goes in the email, on the page, and into the record.**
 *     Three near-identical wordings is how "what did they actually see?" becomes
 *     unanswerable. One constant, three renderers.
 *  3. **It names Stripe.** The general rule elsewhere is never to name the
 *     billing rail in user-facing copy; that rule is SUPERSEDED HERE, because
 *     consent to an unnamed thing is not consent. It stays out of marketing.
 *
 * ⛔ WHERE IT IS SHOWN: email, and a web page. Never in the app, and never
 * behind a link in the app — that is the App Store anti-steering line, and it
 * is what keeps this flow outside store payment rules. See docs/og-cohort.md.
 */

export interface ConsentCopy {
  version: string;
  /** Subject line for the email that carries the ask. */
  subject: string;
  /**
   * The full text of what is being agreed to. This exact string is stored on
   * the consent row; the page and the email render it verbatim.
   */
  body: string;
  /** What the button says. Stored as part of `action_taken`, so the record can
   *  state what was actually pressed rather than that "consent was given". */
  confirmLabel: string;
  declineLabel: string;
}

export const OG_CONSENT_V1: ConsentCopy = {
  version: 'og-stripe-move-v1',
  subject: 'Your free year as a Forgenta founding member',
  body: [
    'You are one of the first 100 people to subscribe to Forgenta, and your free year is ready.',
    '',
    'To give it to you, your subscription needs to move to Stripe billing. We cannot apply a free year to a subscription billed through the App Store or Google Play — only Stripe lets us do it.',
    '',
    'What this means:',
    '- Your Forgenta subscription will be billed by Stripe from now on.',
    '- It costs nothing for the next twelve months.',
    '- After twelve months it renews at the normal price, and you can cancel at any time before then.',
    '- Nothing changes about your account, your data, or what you can use.',
    '',
    'Important: after you confirm and the new billing is set up, cancel your existing App Store or Google Play subscription so you are not paying twice. Do not cancel it first — confirm here, and only then cancel, so you are never left without access.',
    '',
    'If you would rather not move, that is completely fine. Decline below and your subscription stays exactly as it is.',
  ].join('\n'),
  confirmLabel: 'Yes, move my billing to Stripe',
  declineLabel: 'No thanks, leave it as it is',
};

/** Every version ever shown, newest first. Nothing is ever removed: a consent
 *  row can reference a version that is no longer offered, and the record must
 *  still be readable. */
export const CONSENT_VERSIONS: readonly ConsentCopy[] = [OG_CONSENT_V1];

export const CURRENT_CONSENT = OG_CONSENT_V1;

export function consentByVersion(version: string): ConsentCopy | undefined {
  return CONSENT_VERSIONS.find(c => c.version === version);
}

/**
 * SHA-256 of the exact body, hex. Stored alongside the text so a later
 * accidental edit to a stored row is DETECTABLE rather than silent — the text
 * and its hash would stop agreeing.
 *
 * Uses Web Crypto, which exists in Deno, in browsers and in Node 18+, so the
 * same function produces the record on the server and can verify it anywhere.
 */
export async function consentHash(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type ConsentDecision = 'asked' | 'confirmed' | 'declined';

export interface ConsentRow {
  user_id: string;
  decision: ConsentDecision;
  consent_version: string;
  consent_text: string;
  consent_sha256: string;
  action_taken: string;
}

/**
 * Build the row to insert. Pure, so what gets recorded can be asserted in a
 * test rather than inspected after the fact.
 *
 * `action_taken` is WORDS, never a boolean. A year from now "they consented" is
 * a claim; "they pressed a button labelled 'Yes, move my billing to Stripe' on
 * a page stating X" is a record, and only one of those survives being
 * questioned.
 */
export async function buildConsentRow(
  userId: string,
  decision: ConsentDecision,
  copy: ConsentCopy,
  surface: 'email' | 'web',
): Promise<ConsentRow> {
  const action = decision === 'asked'
    ? `sent-consent-request-${surface}`
    : `pressed-${decision === 'confirmed' ? 'confirm' : 'decline'}-${surface}: "${
      decision === 'confirmed' ? copy.confirmLabel : copy.declineLabel
    }"`;

  return {
    user_id: userId,
    decision,
    consent_version: copy.version,
    consent_text: copy.body,
    consent_sha256: await consentHash(copy.body),
    action_taken: action,
  };
}
