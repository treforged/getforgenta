// PLAID WEBHOOK REGISTRATION - the rules that decide which real users' Plaid items get re-pointed.
// The load-bearing cases are the refusals: an apply with no explicit scope must NEVER widen to all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAID_WEBHOOK_PATH, plaidWebhookUrl, cronSecretMatches, parseRegisterRequest, selectTargets,
  needsUpdate, type Candidate,
} from '../../../supabase/functions/_shared/plaid-webhook-register';

describe('plaidWebhookUrl', () => {
  it('appends the path and strips trailing slashes', () => {
    expect(plaidWebhookUrl('https://x.supabase.co')).toBe('https://x.supabase.co' + PLAID_WEBHOOK_PATH);
    expect(plaidWebhookUrl('https://x.supabase.co//')).toBe('https://x.supabase.co/functions/v1/plaid-webhook');
  });
  it('refuses a non-https base', () => {
    expect(() => plaidWebhookUrl('http://x.supabase.co')).toThrow('supabaseUrl must be https');
  });
});

describe('cronSecretMatches', () => {
  it('a missing or empty expected secret authorises nothing, not even an empty header', () => {
    expect(cronSecretMatches('', undefined)).toBe(false);
    expect(cronSecretMatches('', '')).toBe(false);
    expect(cronSecretMatches('abc', '')).toBe(false);
  });
  it('matches only the exact secret', () => {
    expect(cronSecretMatches('s3cret', 's3cret')).toBe(true);
    expect(cronSecretMatches('s3cres', 's3cret')).toBe(false);
    expect(cronSecretMatches('s3cret!', 's3cret')).toBe(false);
    expect(cronSecretMatches(null, 's3cret')).toBe(false);
  });
});

describe('parseRegisterRequest', () => {
  it('defaults to a dry run over every item', () => {
    for (const body of [undefined, null, {}, [], 'apply', 7]) {
      expect(parseRegisterRequest(body)).toEqual({ ok: true, req: { apply: false, itemIds: 'all' } });
    }
  });
  it('apply is the boolean true only', () => {
    expect(parseRegisterRequest({ apply: 'true', all: true })).toEqual({ ok: true, req: { apply: false, itemIds: 'all' } });
    expect(parseRegisterRequest({ apply: 1, item_ids: ['a'] })).toEqual({ ok: true, req: { apply: false, itemIds: ['a'] } });
  });
  it('an apply with no scope is REFUSED, never widened to all', () => {
    expect(parseRegisterRequest({ apply: true })).toEqual({ ok: false, error: 'apply needs item_ids or all:true' });
    expect(parseRegisterRequest({ apply: true, all: 'yes' })).toEqual({ ok: false, error: 'apply needs item_ids or all:true' });
    // The wrong key name must not read as "no list" and then as "all".
    expect(parseRegisterRequest({ apply: true, itemIds: ['a'] })).toEqual({ ok: false, error: 'apply needs item_ids or all:true' });
  });
  it('the two explicit scopes apply', () => {
    expect(parseRegisterRequest({ apply: true, all: true })).toEqual({ ok: true, req: { apply: true, itemIds: 'all' } });
    expect(parseRegisterRequest({ apply: true, item_ids: ['a', 'b', 'a'] })).toEqual({ ok: true, req: { apply: true, itemIds: ['a', 'b'] } });
  });
  it('rejects a malformed or ambiguous scope', () => {
    const bad = 'item_ids must be a non-empty array of strings';
    expect(parseRegisterRequest({ item_ids: [] })).toEqual({ ok: false, error: bad });
    expect(parseRegisterRequest({ item_ids: ['a', ''] })).toEqual({ ok: false, error: bad });
    expect(parseRegisterRequest({ item_ids: 'a' })).toEqual({ ok: false, error: bad });
    expect(parseRegisterRequest({ item_ids: ['a', 3] })).toEqual({ ok: false, error: bad });
    expect(parseRegisterRequest({ item_ids: ['a'], all: true })).toEqual({ ok: false, error: 'give item_ids or all, not both' });
  });
});

describe('selectTargets', () => {
  const c = (item_id: string): Candidate => ({ connection_id: `c-${item_id}`, user_id: 'u', item_id, connection_status: 'active' });
  const candidates = Object.freeze([c('i1'), c('i2'), c('i3')]);

  it('all returns every candidate in order', () => {
    expect(selectTargets(candidates, { apply: false, itemIds: 'all' })).toEqual({ targets: [c('i1'), c('i2'), c('i3')], missing: [] });
  });
  it('a list returns only those, in LIST order, and names what it could not find', () => {
    expect(selectTargets(candidates, { apply: true, itemIds: ['i3', 'nope', 'i1'] }))
      .toEqual({ targets: [c('i3'), c('i1')], missing: ['nope'] });
  });
  it('one requested item selects exactly one', () => {
    expect(selectTargets(candidates, { apply: true, itemIds: ['i2'] }).targets).toHaveLength(1);
  });
});

describe('needsUpdate', () => {
  it('only when the current webhook differs', () => {
    expect(needsUpdate(null, 'u')).toBe(true);
    expect(needsUpdate('', 'u')).toBe(true);
    expect(needsUpdate('old', 'u')).toBe(true);
    expect(needsUpdate('u', 'u')).toBe(false);
  });
});

describe('the wiring (source PROXY - the deployed behaviour needs Plaid to observe)', () => {
  const src = (fn: string) => readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', fn, 'index.ts'), 'utf8')
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('new link tokens carry the webhook, derived from SUPABASE_URL', () => {
    expect(src('plaid-create-link-token')).toMatch(/webhook:\s*plaidWebhookUrl\(Deno\.env\.get\("SUPABASE_URL"\)!\)/);
  });
  it('the register action checks the secret BEFORE it reads the body or any row', () => {
    const s = src('plaid-webhook-register');
    const guard = s.indexOf('cronSecretMatches(req.headers');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(s.indexOf('req.json('));
    expect(guard).toBeLessThan(s.indexOf('.from("financial_connections")'));
  });
  it('the response never carries an access token', () => {
    const s = src('plaid-webhook-register');
    const replyBlock = s.slice(s.lastIndexOf('return reply({'));
    expect(replyBlock).not.toMatch(/access_token/);
    expect(s).not.toMatch(/results\.push\(\{[^}]*access_token/);
  });
});
