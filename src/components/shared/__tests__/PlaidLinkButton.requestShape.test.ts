// EVERY REQUEST FOR A PLAID LINK TOKEN MUST CARRY redirect_uri.
//
// This is a source-shape test rather than a rendering one, and that is deliberate: the defect it
// guards was not behavioural, it was a MISSING FIELD IN A REQUEST BODY. Rendering the component
// would need auth, Capacitor, Supabase and a live fetch mocked before it could observe the one
// thing that matters, and none of that machinery makes the assertion any truer.
//
// THE BUG IT EXISTS FOR (2026-09-02, three weeks live): PlaidLinkButton has TWO call sites to
// plaid-create-link-token. The web one always sent `redirect_uri`. The hosted/native one - the
// only path that sets `hosted: true`, and therefore the ONLY path Plaid REQUIRES the field on -
// never did. Plaid rejects that combination outright:
//
//   "redirect_uri and hosted_link.completion_redirect_uri must be set when
//    hosted_link.is_mobile_app is set to true"
//
// So every native tap failed before a token was ever created, and because the two call sites look
// alike at a glance, reading the file did not reveal it. Setting the env var could not fix it and
// neither could redeploying: the field was simply not in the body.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'PlaidLinkButton.tsx'),
  'utf8',
);

/** The `body: JSON.stringify({ ... })` of every fetch to the link-token function. */
function linkTokenRequestBodies(src: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const call = src.indexOf('plaid-create-link-token', from);
    if (call === -1) break;
    from = call + 1;
    const bodyAt = src.indexOf('body: JSON.stringify({', call);
    // Only count real fetches: a mention in a comment has no body within reach of it.
    if (bodyAt === -1 || bodyAt - call > 400) continue;
    const open = src.indexOf('{', bodyAt + 'body: JSON.stringify('.length - 1);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    bodies.push(src.slice(open, end + 1));
  }
  return bodies;
}

describe('PlaidLinkButton — link-token request shape', () => {
  const bodies = linkTokenRequestBodies(SOURCE);

  it('finds both call sites, so this test cannot silently inspect nothing', () => {
    // A parser that matches zero bodies would make every assertion below vacuously true. That is
    // the failure mode this repo has been bitten by, so it is checked rather than assumed.
    expect(bodies.length).toBe(2);
  });

  it('EVERY request sends redirect_uri, including the hosted one', () => {
    for (const body of bodies) {
      expect(body).toContain('redirect_uri');
    }
  });

  it('the hosted request in particular sends it', () => {
    const hosted = bodies.filter(b => /hosted:\s*true/.test(b));
    expect(hosted).toHaveLength(1);
    expect(hosted[0]).toContain('redirect_uri');
    expect(hosted[0]).toContain('OAUTH_REDIRECT_URI');
  });

  it('reads the redirect URI from the env var rather than hardcoding a URL', () => {
    // It has to match the Plaid dashboard's Allowed redirect URIs character-for-character, so it
    // belongs in configuration, not in two places in this file.
    expect(SOURCE).toContain('import.meta.env.VITE_PLAID_OAUTH_REDIRECT_URI');
    for (const body of bodies) {
      expect(body).not.toMatch(/https:\/\/[a-z]/);
    }
  });
});
