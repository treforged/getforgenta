/**
 * The email that carries the consent ask.
 *
 * Pure, so what a hundred founding members actually receive can be asserted in a
 * test rather than discovered after it is sent. Sending is not undoable: an
 * email with the wrong link, the wrong wording, or a link that lands in the app
 * cannot be recalled, and this is the one email in the product that carries a
 * legal obligation.
 *
 * THE SAME STRING GOES IN THE EMAIL, ON THE PAGE, AND INTO THE RECORD
 * (`og-consent-text.ts`, rule 2). Three near-identical wordings is how "what did
 * they actually see?" becomes unanswerable a year later. So this renders
 * `copy.body` VERBATIM and adds no persuasion of its own — no urgency, no
 * reworded summary above it, nothing that could be read as a different offer
 * from the one on the page they are about to land on.
 *
 * ⛔ THE LINK MUST BE THE WEB PAGE, never a deep link into the app. That is the
 * App Store anti-steering line (docs/og-cohort.md), and it is the single thing
 * about this email most likely to be "improved" into a regression.
 */

import type { ConsentCopy } from "./og-consent-text.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** `https://<functions host>/og-consent?t=<raw token>` — the page, never the app. */
export function consentLink(functionsBaseUrl: string, rawToken: string): string {
  return `${functionsBaseUrl.replace(/\/+$/, '')}/og-consent?t=${encodeURIComponent(rawToken)}`;
}

/**
 * Both the plain-text and HTML bodies. Plain text is not a courtesy here: some
 * mail clients render it instead, and a person who only ever sees the text part
 * must see the SAME terms, not a stub telling them to enable HTML.
 */
export function buildAskEmail(copy: ConsentCopy, link: string): { subject: string; html: string; text: string } {
  const paragraphs = copy.body.split('\n\n').map(p => p.trim()).filter(Boolean);

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f4f5;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="background:#0f172a;padding:24px 32px">
        <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.5px">Forgenta</span>
      </div>
      <div style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">${esc(copy.subject)}</h1>
        ${paragraphs.map(p =>
          `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;white-space:pre-line">${esc(p)}</p>`
        ).join('\n        ')}
        <a href="${esc(link)}" style="display:inline-block;margin-top:8px;background:#4f46e5;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px">Choose on the web</a>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b">Nothing happens until you choose. You can confirm or decline on that page, and declining changes nothing about your subscription.</p>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">If the button doesn't work, copy and paste this link:<br><span style="color:#64748b;word-break:break-all">${esc(link)}</span></p>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #f1f5f9">
        <p style="margin:0;font-size:12px;color:#94a3b8">You received this because you are one of the first 100 Forgenta subscribers. This link is personal to you — please don't forward it.</p>
      </div>
    </div>
  </body></html>`;

  const text = [
    copy.subject,
    '',
    copy.body,
    '',
    'Choose on the web:',
    link,
    '',
    'Nothing happens until you choose. Declining changes nothing about your subscription.',
    'This link is personal to you — please don\'t forward it.',
  ].join('\n');

  return { subject: copy.subject, html, text };
}
