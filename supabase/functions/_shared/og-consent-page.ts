/**
 * The consent page's HTML, as pure functions.
 *
 * Split out of the request handler for one reason: SO IT CAN BE TESTED. The
 * failure this repo pays for repeatedly is a control that was described and
 * never pressed — `forged-glass` shipped a licence panel whose Accept and
 * Decline buttons both threw the first time a human touched them, and every
 * check made on it had printed what the buttons SAID. A page that decides
 * somebody's billing does not get to be checked that way.
 *
 * What the tests assert about the output here: both buttons exist, both are
 * POST (a GET must never record consent — mail scanners follow links), the
 * wording rendered is the version the link was issued for, and every
 * interpolated value is escaped.
 */

import type { ConsentCopy } from "./og-consent-text.ts";

/** Everything interpolated into the page goes through this. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin:0; padding:2rem 1rem; font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;
         background:#faf9f7; color:#1c1b19; }
  @media (prefers-color-scheme: dark) { body { background:#141413; color:#f2f0ed; } }
  main { max-width:38rem; margin:0 auto; }
  h1 { font-size:1.5rem; line-height:1.3; margin:0 0 1rem; }
  pre { white-space:pre-wrap; font:inherit; margin:0 0 1.5rem; }
  .actions { display:flex; flex-wrap:wrap; gap:.75rem; margin-top:1.5rem; }
  button { font:inherit; padding:.75rem 1.25rem; border-radius:.5rem; border:1px solid currentColor;
           cursor:pointer; background:transparent; color:inherit; }
  button.primary { background:#1c1b19; color:#faf9f7; border-color:#1c1b19; }
  @media (prefers-color-scheme: dark) { button.primary { background:#f2f0ed; color:#141413; border-color:#f2f0ed; } }
  form { display:inline; }`;

export function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- A consent link is a credential; keep the page out of indexes. -->
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>${STYLE}</style></head>
<body><main>${inner}</main></body></html>`;
}

/** A plain message page — a dead link, a recorded answer, an error. */
export function noticePage(title: string, message: string): string {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`);
}

/**
 * The ask itself.
 *
 * `action` carries the token back, and BOTH buttons are POST. That is the whole
 * of "consent is never inferred from clicking a link in an email": opening the
 * page is a GET and records nothing; only a pressed button submits.
 */
export function consentPage(copy: ConsentCopy, path: string, token: string): string {
  const action = `${esc(path)}?t=${esc(token)}`;
  const button = (decision: 'confirmed' | 'declined', label: string, primary: boolean) =>
    `<form method="POST" action="${action}">`
    + `<input type="hidden" name="decision" value="${decision}">`
    + `<button${primary ? ' class="primary"' : ''} type="submit">${esc(label)}</button>`
    + `</form>`;

  return shell(copy.subject, `
      <h1>${esc(copy.subject)}</h1>
      <pre>${esc(copy.body)}</pre>
      <div class="actions">
        ${button('confirmed', copy.confirmLabel, true)}
        ${button('declined', copy.declineLabel, false)}
      </div>`);
}

/** What they are told after pressing. */
export function outcomeMessage(decision: 'confirmed' | 'declined'): { title: string; message: string } {
  return decision === 'confirmed'
    ? {
      title: 'Thank you — that is recorded',
      // The cancel-SECOND instruction is repeated here and not only in the email,
      // because this is the moment it becomes true and the email is now scrolled
      // away. Getting the order wrong costs them access or costs them money.
      message: 'Your free year is being set up. We will email you as soon as it is active — and '
        + 'only then should you cancel your App Store or Google Play subscription, so you are '
        + 'never left without access.',
    }
    : {
      title: 'That is recorded',
      message: 'Nothing changes. Your subscription stays exactly as it is, and you do not need '
        + 'to do anything else.',
    };
}
