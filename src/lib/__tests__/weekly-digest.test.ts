// The weekly email to app users (proposal C). The rule that matters most: NOTHING IS SENT unless the
// request opts in with ?dry_run=0, and even then not without the unsubscribe secret and postal
// address. Would-fail checks: flip isDryRun's default and "missing / empty / mistyped" fails; drop the
// unsubscribed filter and both "never sent" tests fail; show a stale figure and "left out" fails;
// remove the postal line and the footer test fails. All data below is invented.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isDryRun, sendBlockers, runDigest, buildUserDigest, freshSafeToSpend, parseFeed, formatCents,
  MAX_RECIPIENTS_PER_RUN, type DigestDeps, type DigestRecipient, type Post,
} from '../../../supabase/functions/_shared/weekly-digest';

const NOW = new Date('2026-10-12T15:00:00Z');
const ADDRESS = '1 Example Street, Nowhere, ZZ 00000';

const rec = (over: Partial<DigestRecipient> = {}): DigestRecipient => ({
  user_id: '11111111-2222-4333-8444-555555555555',
  email: 'person@example.invalid',
  display_name: 'Pat Example',
  timezone: 'America/New_York',
  unsubscribed: false,
  has_income: true,
  entries_7d: 0,
  sts_amount_cents: 12345,
  sts_payday: '2026-10-16',
  sts_computed_at: '2026-10-12T02:00:00Z',
  ...over,
});

const post: Post = { title: 'A post', link: 'https://blog.example.invalid/p', description: '', pubDate: new Date('2026-10-10T12:00:00Z') };

function deps(over: Partial<DigestDeps> = {}) {
  const send = vi.fn(async (emails: unknown[]) => emails.length);
  const d: DigestDeps = {
    now: NOW,
    appUrl: 'https://app.example.invalid',
    postalAddress: ADDRESS,
    unsubscribeMailto: 'help@example.invalid',
    loadRecipients: async () => [rec()],
    loadSubscriberEmails: async () => [],
    loadPosts: async () => [post],
    unsubscribeUrlFor: async (id) => `https://fn.example.invalid/email-unsubscribe?u=${id}&t=x`,
    send,
    ...over,
  };
  return { d, send };
}

describe('dry run is the default', () => {
  it('missing, empty or mistyped dry_run is a dry run; only "0" sends', () => {
    expect(isDryRun(new URL('https://x.invalid/f'))).toBe(true);
    expect(isDryRun(new URL('https://x.invalid/f?dry_run='))).toBe(true);
    expect(isDryRun(new URL('https://x.invalid/f?dry_run=false'))).toBe(true);
    expect(isDryRun(new URL('https://x.invalid/f?dryrun=0'))).toBe(true);
    expect(isDryRun(new URL('https://x.invalid/f?dry_run=0'))).toBe(false);
  });

  it('a dry run never calls send and never signs a link', async () => {
    const unsubscribeUrlFor = vi.fn(async () => 'x');
    const { d, send } = deps({ unsubscribeUrlFor });
    const r = await runDigest(d, { dryRun: true, blockers: [] });
    expect(send).not.toHaveBeenCalled();
    expect(unsubscribeUrlFor).not.toHaveBeenCalled();
    expect(r).toMatchObject({ dry_run: true, status: 'ok', would_send: 1, sent: 0, with_safe_to_spend: 1 });
  });

  it('a real send refuses while config is missing, and says what', async () => {
    expect(sendBlockers({ RESEND_API_KEY: 'k' })).toEqual(['EMAIL_UNSUBSCRIBE_SECRET', 'EMAIL_POSTAL_ADDRESS']);
    expect(sendBlockers({ RESEND_API_KEY: 'k', EMAIL_UNSUBSCRIBE_SECRET: 's', EMAIL_POSTAL_ADDRESS: '  ' })).toEqual(['EMAIL_POSTAL_ADDRESS']);
    const { d, send } = deps();
    const r = await runDigest(d, { dryRun: false, blockers: ['EMAIL_POSTAL_ADDRESS'] });
    expect(send).not.toHaveBeenCalled();
    expect(r.status).toBe('blocked');
  });

  it('refuses a runaway recipient list instead of mailing it', async () => {
    const many = Array.from({ length: MAX_RECIPIENTS_PER_RUN + 1 }, (_, i) =>
      rec({ user_id: `id-${i}`, email: `p${i}@example.invalid` }));
    const { d, send } = deps({ loadRecipients: async () => many });
    const r = await runDigest(d, { dryRun: false, blockers: [] });
    expect(r.status).toBe('too_many');
    expect(send).not.toHaveBeenCalled();
  });

  it('the result carries counts, never an address', async () => {
    const { d } = deps();
    const r = await runDigest(d, { dryRun: true, blockers: [] });
    expect(JSON.stringify(r)).not.toContain('@');
  });
});

describe('who gets it', () => {
  it('an unsubscribed user is never sent anything, on either list', async () => {
    const off = rec({ user_id: 'off', email: 'Off@Example.invalid', unsubscribed: true });
    const { d, send } = deps({
      loadRecipients: async () => [rec(), off],
      loadSubscriberEmails: async () => ['off@example.invalid', 'reader@example.invalid', 'PERSON@example.invalid'],
    });
    const r = await runDigest(d, { dryRun: false, blockers: [] });
    const sentTo = (send.mock.calls[0][0] as { to: string }[]).map((e) => e.to.toLowerCase());
    expect(sentTo).toEqual(['person@example.invalid', 'reader@example.invalid']);
    expect(r).toMatchObject({ app_users: 1, unsubscribed_skipped: 1, subscribers: 1, sent: 2 });
  });

  it('newsletter-only readers get nothing in a week with no posts; app users still do', async () => {
    const { d, send } = deps({ loadPosts: async () => [], loadSubscriberEmails: async () => ['reader@example.invalid'] });
    await runDigest(d, { dryRun: false, blockers: [] });
    expect((send.mock.calls[0][0] as unknown[]).length).toBe(1);
  });

  it('every user email carries one-click headers', async () => {
    const { d, send } = deps();
    await runDigest(d, { dryRun: false, blockers: [] });
    const e = (send.mock.calls[0][0] as { headers: Record<string, string> }[])[0];
    expect(e.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(e.headers['List-Unsubscribe']).toMatch(/^<https:\/\/fn\.example\.invalid\/email-unsubscribe/);
  });
});

describe('the per-user body', () => {
  const ctx = (posts: Post[] = []) => ({
    appUrl: 'https://app.example.invalid', now: NOW, posts,
    footer: { reason: 'Because.', unsubscribeUrl: 'https://u.invalid/x', unsubscribeMailto: 'help@example.invalid', postalAddress: ADDRESS },
  });

  it('shows a fresh Safe to Spend figure with its date', () => {
    const { text } = buildUserDigest(rec(), ctx());
    expect(text).toContain(`Safe to spend until Fri, Oct 16: ${formatCents(12345)} (as of Oct 11).`);
    expect(formatCents(12345)).toBe('$123.45');
  });

  it('leaves a stale figure out, and one whose payday has passed', () => {
    expect(freshSafeToSpend(rec({ sts_computed_at: '2026-10-08T14:00:00Z' }), NOW)).toBeNull();
    expect(freshSafeToSpend(rec({ sts_payday: '2026-10-11' }), NOW)).toBeNull();
    expect(freshSafeToSpend(rec({ sts_amount_cents: null }), NOW)).toBeNull();
    const { text } = buildUserDigest(rec({ sts_computed_at: '2026-10-01T00:00:00Z' }), ctx());
    expect(text).not.toContain('$');
  });

  it('asks for one quick add when nothing was saved, and counts when something was', () => {
    expect(buildUserDigest(rec(), ctx()).text).toContain('/dashboard?quickadd=1');
    const busy = buildUserDigest(rec({ entries_7d: 3 }), ctx()).text;
    expect(busy).toContain('You saved 3 entries in the last 7 days.');
    expect(busy).not.toContain('quickadd');
  });

  it('asks for pay when there is none', () => {
    const { text } = buildUserDigest(rec({ has_income: false, sts_amount_cents: null }), ctx());
    expect(text).toContain('Add how much you get paid');
  });

  it('has the CAN-SPAM footer: why, one-click unsubscribe, sender and postal address', () => {
    const { text, html } = buildUserDigest(rec(), ctx());
    for (const s of ['Because.', 'Unsubscribe in one click: https://u.invalid/x', 'TRE Forged LLC', ADDRESS]) {
      expect(text).toContain(s);
    }
    expect(html).toContain(ADDRESS);
    expect(html).toContain('href="https://u.invalid/x"');
  });

  it('escapes a display name and keeps only its first word', () => {
    const { html, text } = buildUserDigest(rec({ display_name: '<b>Pat</b> Example' }), ctx());
    expect(text.startsWith('Hi bPatb,')).toBe(true);
    expect(html).not.toContain('<b>Pat');
  });

  it('adds blog posts only when there are any', () => {
    expect(buildUserDigest(rec(), ctx([post])).text).toContain('From the blog this week:');
    expect(buildUserDigest(rec(), ctx()).text).not.toContain('From the blog');
  });
});

describe('feed', () => {
  it('parses items and skips broken ones', () => {
    const xml = `<rss><item><title><![CDATA[T1]]></title><link>https://b.invalid/1</link><pubDate>Sat, 10 Oct 2026 12:00:00 GMT</pubDate></item><item><title>No date</title><link>https://b.invalid/2</link></item></rss>`;
    expect(parseFeed(xml).map((p) => p.title)).toEqual(['T1']);
  });
});

describe('the migration', () => {
  const sql = readFileSync('supabase/migrations/20261009_weekly_email_to_users.sql', 'utf8');
  it('is callable by service_role only', () => {
    expect(sql).toMatch(/revoke all on function public\.get_weekly_digest_recipients\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.get_weekly_digest_recipients\(\) to service_role;/);
  });
  it('confirmed real users only, and the nudge skips the unsubscribed', () => {
    expect(sql).toContain('u.email_confirmed_at is not null');
    expect(sql).toMatch(/\\.test\|\\.example\|\\.invalid/);
    expect(sql).toMatch(/p\.email_unsubscribed_at is not null\s*\)\s*and not exists \(\s*select 1 from public\.email_nudges/);
  });
});
