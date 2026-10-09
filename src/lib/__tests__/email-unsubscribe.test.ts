// One-click unsubscribe (proposal C). The link is a credential that can only unsubscribe its own
// owner, so the rules worth asserting are: it verifies only with the right secret and the right id,
// a missing secret never authorises, a GET never unsubscribes, and RFC 8058 headers are present.
// Would-fail checks: verify without comparing the MAC and "a link for another user" fails; treat an
// unset secret as "" and "unset secret" fails; let GET write and "a GET only shows the page" fails.
import { describe, it, expect } from 'vitest';
import {
  signUnsubscribe, verifyUnsubscribe, unsubscribeUrl, listUnsubscribeHeaders, unsubscribeActionFor,
  confirmPageHtml, invalidLinkHtml,
} from '../../../supabase/functions/_shared/email-unsubscribe';

const SECRET = 'test-secret-not-real';
const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-2222-4333-8444-555555555555';

describe('unsubscribe link', () => {
  it('round-trips for its own user', async () => {
    const t = await signUnsubscribe(A, SECRET);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyUnsubscribe(A, t, SECRET)).toBe(A);
  });

  it('a link for one user does not unsubscribe another', async () => {
    const t = await signUnsubscribe(A, SECRET);
    expect(await verifyUnsubscribe(B, t, SECRET)).toBeNull();
  });

  it('a different secret refuses it', async () => {
    const t = await signUnsubscribe(A, SECRET);
    expect(await verifyUnsubscribe(A, t, 'other-secret')).toBeNull();
  });

  it('an unset or empty secret never authorises, and signing refuses it', async () => {
    const t = await signUnsubscribe(A, SECRET);
    expect(await verifyUnsubscribe(A, t, undefined)).toBeNull();
    expect(await verifyUnsubscribe(A, t, '')).toBeNull();
    await expect(signUnsubscribe(A, '')).rejects.toThrow();
  });

  it('refuses malformed ids and tokens before hashing', async () => {
    expect(await verifyUnsubscribe('not-a-uuid', 'a'.repeat(64), SECRET)).toBeNull();
    expect(await verifyUnsubscribe(A, 'zz', SECRET)).toBeNull();
    expect(await verifyUnsubscribe(null, null, SECRET)).toBeNull();
  });

  it('builds the link and the RFC 8058 one-click headers', async () => {
    const url = await unsubscribeUrl('https://example.invalid/functions/v1/', A, SECRET);
    expect(url).toMatch(/^https:\/\/example\.invalid\/functions\/v1\/email-unsubscribe\?u=[0-9a-f-]{36}&t=[0-9a-f]{64}$/);
    const h = listUnsubscribeHeaders(url, 'help@example.invalid');
    expect(h['List-Unsubscribe']).toBe(`<${url}>, <mailto:help@example.invalid?subject=unsubscribe>`);
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('what a request may do', () => {
  it('a GET only shows the page; only a POST unsubscribes', () => {
    expect(unsubscribeActionFor('GET')).toBe('confirm_page');
    expect(unsubscribeActionFor('HEAD')).toBe('confirm_page');
    expect(unsubscribeActionFor('POST')).toBe('unsubscribe');
    expect(unsubscribeActionFor('DELETE')).toBe('not_allowed');
  });

  it('the confirm page posts back to its own link, escaped', () => {
    const html = confirmPageHtml('https://x.invalid/u?a=1&b="2"');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="https://x.invalid/u?a=1&amp;b=&quot;2&quot;"');
  });

  it('a bad link still offers a way out', () => {
    expect(invalidLinkHtml('help@example.invalid')).toContain('mailto:help@example.invalid?subject=unsubscribe');
  });
});
