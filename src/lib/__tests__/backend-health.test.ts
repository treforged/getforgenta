// Backend health: the notice that names WHY Forgenta cannot reach its back end (ask e618b2f0).
//
// Would-fail checks, each proven red by a planted mutation before this file was trusted:
// - treat a 401 as a failure and "a 4xx is the back end answering" fails — that mutant would
//   raise the alarm on every expired session;
// - drop the offline branch and both offline cases fail — that mutant tells someone on a plane
//   that "our servers are down";
// - name Cloudflare below `major` and "a minor Cloudflare incident is not blamed" fails — that
//   mutant blamed a Workers Builds incident for a Supabase hang on 2026-10-04.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyPath, createHealthFetch, diagnose, parseStatusSummary, STATUS_SOURCES,
  OFFLINE_HEADLINE, UNKNOWN_HEADLINE,
  type ProviderStatuses, type RequestOutcome, type StatusRead,
} from '../backend-health';
import { createBackendHealthStore, readStatusPage } from '../backend-health-store';

const ORIGIN = 'https://abc.supabase.co';
const ok = (indicator: 'none' | 'minor' | 'major' | 'critical', incidents: { name: string; impact?: string }[] = [], description = 'x'): StatusRead =>
  ({ ok: true, indicator, description, incidents: incidents.map(i => ({ name: i.name, impact: i.impact ?? indicator, components: [] })) });
const allNone: ProviderStatuses = { supabase: ok('none'), cloudflare: ok('none'), vercel: ok('none'), plaid: ok('none') };
const failed = { supabase: true, bank: false };

describe('parseStatusSummary', () => {
  it('reads the documented Statuspage shape and drops resolved incidents', () => {
    expect(parseStatusSummary({
      status: { indicator: 'minor', description: 'Partially Degraded Service' },
      incidents: [
        { name: 'Intermittent latency in Eastern US', status: 'identified', impact: 'minor', components: [{ name: 'API Gateway' }] },
        { name: 'Old thing', status: 'resolved', impact: 'major', components: [] },
      ],
    })).toEqual({
      ok: true, indicator: 'minor', description: 'Partially Degraded Service',
      incidents: [{ name: 'Intermittent latency in Eastern US', impact: 'minor', components: ['API Gateway'] }],
    });
  });

  it('accepts a page with NO incidents key — Plaid omits it when nothing is open', () => {
    expect(parseStatusSummary({ status: { indicator: 'none', description: 'All Systems Operational' }, components: [] }))
      .toEqual({ ok: true, indicator: 'none', description: 'All Systems Operational', incidents: [] });
  });

  it.each([
    ['null', null],
    ['an HTML error page parsed as a string', '<!DOCTYPE html>'],
    ['no status', { incidents: [] }],
    ['an unknown indicator', { status: { indicator: 'on-fire' } }],
    ['incidents that are not an array', { status: { indicator: 'major' }, incidents: { name: 'x' } }],
  ])('treats %s as UNREAD, never as an incident', (_label, json) => {
    expect(parseStatusSummary(json)).toEqual({ ok: false });
  });
});

describe('classifyPath', () => {
  it('watches auth and rest for hangs, and only the bank functions are "bank"', () => {
    expect(classifyPath('/auth/v1/token')).toEqual({ target: 'supabase', watchHang: true });
    expect(classifyPath('/rest/v1/profiles')).toEqual({ target: 'supabase', watchHang: true });
    expect(classifyPath('/functions/v1/plaid-sync')).toEqual({ target: 'bank', watchHang: false });
    expect(classifyPath('/functions/v1/financial-sync')).toEqual({ target: 'bank', watchHang: false });
    expect(classifyPath('/functions/v1/ai-advisor')).toEqual({ target: 'supabase', watchHang: false });
  });
});

describe('diagnose', () => {
  it('says nothing when no request has failed, even with a provider incident open', () => {
    expect(diagnose({ online: true, statuses: { ...allNone, supabase: ok('major', [{ name: 'Outage' }]) }, failure: { supabase: false, bank: false } })).toBeNull();
  });

  it('offline by navigator: "You\'re offline", even with no failure yet', () => {
    const d = diagnose({ online: false, statuses: {}, failure: { supabase: false, bank: false } });
    expect(d?.kind).toBe('offline');
    expect(d?.headline).toBe("You're offline");
  });

  it('offline when EVERY status host also failed: the device reaches nothing', () => {
    const d = diagnose({ online: true, statuses: { supabase: { ok: false }, cloudflare: { ok: false }, vercel: { ok: false }, plaid: { ok: false } }, failure: failed });
    expect(d?.kind).toBe('offline');
    expect(d?.headline).toBe(OFFLINE_HEADLINE);
  });

  it('three failed status reads and one good one is NOT offline — it is unknown', () => {
    const d = diagnose({ online: true, statuses: { supabase: { ok: false }, cloudflare: { ok: false }, vercel: { ok: false }, plaid: ok('none') }, failure: failed });
    expect(d?.headline).toBe(UNKNOWN_HEADLINE);
  });

  it('names Supabase and its incident', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, supabase: ok('minor', [{ name: 'Intermittent latency in Eastern US' }]) }, failure: failed });
    expect(d).toMatchObject({ kind: 'provider', provider: 'supabase' });
    expect(d?.headline).toBe('Supabase, our database provider, is having an outage: Intermittent latency in Eastern US');
  });

  it('falls back to the page description when the indicator is up but no incident is listed', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, supabase: ok('minor', [], 'Partially Degraded Service') }, failure: failed });
    expect(d?.headline).toBe('Supabase, our database provider, is having an outage: Partially Degraded Service');
  });

  it('names the most severe open incident', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, supabase: ok('major', [{ name: 'Small', impact: 'minor' }, { name: 'Big', impact: 'major' }]) }, failure: failed });
    expect(d?.headline).toBe('Supabase, our database provider, is having an outage: Big');
  });

  it('names Cloudflare at major', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, cloudflare: ok('major', [{ name: 'Global network degradation' }]) }, failure: failed });
    expect(d?.headline).toBe('Cloudflare, our network provider, is having an outage: Global network degradation');
  });

  it('a minor Cloudflare incident is not blamed (measured: Workers Builds, 2026-10-04)', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, cloudflare: ok('minor', [{ name: 'Issues with Workers Build failing to start' }]) }, failure: failed });
    expect(d?.headline).toBe(UNKNOWN_HEADLINE);
  });

  it('names Vercel at major', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, vercel: ok('critical', [{ name: 'Edge network outage' }]) }, failure: failed });
    expect(d?.headline).toBe('Vercel, our hosting provider, is having an outage: Edge network outage');
  });

  it('Supabase is named FIRST when several providers report', () => {
    const d = diagnose({ online: true, statuses: { supabase: ok('minor', [{ name: 'S' }]), cloudflare: ok('critical', [{ name: 'C' }]), vercel: ok('major', [{ name: 'V' }]), plaid: ok('major', [{ name: 'P' }]) }, failure: failed });
    expect(d?.headline).toBe('Supabase, our database provider, is having an outage: S');
  });

  it('no provider incident: the generic sentence, no guessed cause', () => {
    const d = diagnose({ online: true, statuses: allNone, failure: failed });
    expect(d?.kind).toBe('unknown');
    expect(d?.headline).toBe("Forgenta can't reach its servers right now.");
  });

  it('status pages not read yet: the generic sentence', () => {
    expect(diagnose({ online: true, statuses: {}, failure: failed })?.headline).toBe(UNKNOWN_HEADLINE);
  });

  // ⚠️ Measured live on getforgenta.com, 2026-10-04 20:10Z: for ~2 s after the hang was detected the
  // banner said "None of our providers report a problem" while status.supabase.com was reporting the
  // very incident - nothing had been READ yet. "None report a problem" needs all four pages read clean.
  it('before any status page answers, it never claims the providers are fine', () => {
    const d = diagnose({ online: true, statuses: {}, failure: failed });
    expect(d?.detail).not.toMatch(/None of our providers/);
    expect(d?.detail).toMatch(/Checking/);
  });

  it('only when all four pages were read clean does it say none report a problem', () => {
    expect(diagnose({ online: true, statuses: allNone, failure: failed })?.detail).toMatch(/None of our providers report a problem/);
    const partial = diagnose({ online: true, statuses: { ...allNone, supabase: { ok: false } }, failure: failed });
    expect(partial?.detail).not.toMatch(/None of our providers/);
  });

  it('a failed status read is never an incident', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, supabase: { ok: false } }, failure: failed });
    expect(d?.headline).toBe(UNKNOWN_HEADLINE);
  });

  it('a bank failure with a Plaid incident: the quieter Plaid notice', () => {
    const d = diagnose({ online: true, statuses: { ...allNone, plaid: ok('minor', [{ name: 'Delayed transactions for Chase' }]) }, failure: { supabase: false, bank: true } });
    expect(d).toMatchObject({ kind: 'plaid', provider: 'plaid' });
    expect(d?.headline).toBe('Bank sync is delayed: Plaid reports Delayed transactions for Chase');
  });

  it('a bank failure with Plaid healthy says nothing — Plaid alone never claims Forgenta is down', () => {
    expect(diagnose({ online: true, statuses: allNone, failure: { supabase: false, bank: true } })).toBeNull();
  });
});

describe('createHealthFetch', () => {
  let outcomes: RequestOutcome[];
  beforeEach(() => { outcomes = []; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const make = (base: typeof fetch) => createHealthFetch({ baseFetch: base, origin: ORIGIN, report: o => outcomes.push(o), hangMs: 10_000 });

  it('a 4xx is the back end answering: reported as ok, and the response is returned untouched', async () => {
    const res = new Response('{}', { status: 401 });
    const f = make(vi.fn().mockResolvedValue(res));
    expect(await f(`${ORIGIN}/auth/v1/user`)).toBe(res);
    expect(outcomes).toEqual([{ target: 'supabase', ok: true }]);
  });

  it('a 5xx and a 52x are failures', async () => {
    const f = make(vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 522 })));
    await f(`${ORIGIN}/rest/v1/x`);
    await f(`${ORIGIN}/rest/v1/x`);
    expect(outcomes).toEqual([{ target: 'supabase', ok: false, reason: 'server' }, { target: 'supabase', ok: false, reason: 'server' }]);
  });

  it('a network error is a failure, and still rejects to the caller', async () => {
    const f = make(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(f(`${ORIGIN}/rest/v1/x`)).rejects.toThrow('Failed to fetch');
    expect(outcomes).toEqual([{ target: 'supabase', ok: false, reason: 'network' }]);
  });

  it('a request the caller aborted is NOT a failure', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = make(vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    await expect(f(`${ORIGIN}/rest/v1/x`, { signal: ctrl.signal })).rejects.toThrow();
    expect(outcomes).toEqual([]);
  });

  it('a HANG becomes a failure at 10s, without aborting it; its late answer then clears', async () => {
    let answer!: (r: Response) => void;
    const base = vi.fn().mockImplementation(() => new Promise<Response>(r => { answer = r; }));
    const pending = make(base)(`${ORIGIN}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcomes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcomes).toEqual([{ target: 'supabase', ok: false, reason: 'timeout' }]);
    expect((base.mock.calls[0][1] as RequestInit).signal).toBeUndefined(); // nothing was attached to cancel it
    answer(new Response('{}', { status: 200 }));
    await pending;
    expect(outcomes.at(-1)).toEqual({ target: 'supabase', ok: true });
  });

  it('an edge function is not timed out (bank sync legitimately runs long)', async () => {
    make(vi.fn().mockImplementation(() => new Promise(() => {})))(`${ORIGIN}/functions/v1/plaid-sync`);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcomes).toEqual([]);
  });

  it('a bank function 5xx reports target "bank"', async () => {
    await make(vi.fn().mockResolvedValue(new Response('', { status: 502 })))(`${ORIGIN}/functions/v1/plaid-sync`, { method: 'POST' });
    expect(outcomes).toEqual([{ target: 'bank', ok: false, reason: 'server' }]);
  });

  it('other origins pass straight through, unobserved', async () => {
    const res = new Response('', { status: 500 });
    const base = vi.fn().mockResolvedValue(res);
    expect(await make(base)('https://api.stripe.com/v1/x')).toBe(res);
    expect(outcomes).toEqual([]);
  });

  it('a Request object is classified by its own URL', async () => {
    await make(vi.fn().mockResolvedValue(new Response('', { status: 500 })))(new Request(`${ORIGIN}/rest/v1/x`));
    expect(outcomes).toEqual([{ target: 'supabase', ok: false, reason: 'server' }]);
  });
});

describe('backend health store', () => {
  const statusFor = (map: Partial<Record<string, StatusRead>>) => vi.fn(async (url: string) => map[url] ?? ok('none'));

  it('stays silent until a real request fails, then diagnoses from the status pages, and a success clears it', async () => {
    const readStatus = statusFor({ [STATUS_SOURCES.supabase.url]: ok('minor', [{ name: 'Intermittent latency in Eastern US' }]) });
    const store = createBackendHealthStore({ readStatus });
    expect(store.getSnapshot().diagnosis).toBeNull();
    expect(readStatus).not.toHaveBeenCalled();

    store.report({ target: 'supabase', ok: false, reason: 'timeout' });
    expect(store.getSnapshot().diagnosis?.headline).toBe(UNKNOWN_HEADLINE); // before the status read lands
    await vi.waitFor(() => expect(store.getSnapshot().checking).toBe(false));
    expect(store.getSnapshot().diagnosis?.headline).toBe('Supabase, our database provider, is having an outage: Intermittent latency in Eastern US');
    expect(readStatus).toHaveBeenCalledTimes(4);

    store.report({ target: 'supabase', ok: true });
    expect(store.getSnapshot().diagnosis).toBeNull();
  });

  it('caches status reads for 60s and re-reads after', async () => {
    let t = 0;
    const readStatus = statusFor({});
    const store = createBackendHealthStore({ readStatus, now: () => t });
    store.report({ target: 'supabase', ok: false, reason: 'network' });
    await vi.waitFor(() => expect(store.getSnapshot().checking).toBe(false));
    store.report({ target: 'supabase', ok: true });
    t = 59_000;
    store.report({ target: 'supabase', ok: false, reason: 'network' });
    await vi.waitFor(() => expect(store.getSnapshot().checking).toBe(false));
    expect(readStatus).toHaveBeenCalledTimes(4);
    store.report({ target: 'supabase', ok: true });
    t = 61_000;
    store.report({ target: 'supabase', ok: false, reason: 'network' });
    await vi.waitFor(() => expect(store.getSnapshot().checking).toBe(false));
    expect(readStatus).toHaveBeenCalledTimes(8);
  });

  it('going offline shows offline at once; recheck re-reads statuses and sends the probe', async () => {
    const readStatus = statusFor({});
    const probeRequest = vi.fn().mockResolvedValue(undefined);
    const store = createBackendHealthStore({ readStatus, probeRequest });
    store.setOnline(false);
    expect(store.getSnapshot().diagnosis?.headline).toBe("You're offline");
    store.setOnline(true);
    expect(store.getSnapshot().diagnosis).toBeNull();
    await store.recheck();
    expect(probeRequest).toHaveBeenCalledTimes(1);
    expect(readStatus).toHaveBeenCalledTimes(4);
  });

  it('a snapshot is stable between changes (useSyncExternalStore needs identity)', () => {
    const store = createBackendHealthStore({ readStatus: statusFor({}) });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe('readStatusPage', () => {
  it('a timeout, a non-200 and bad JSON are all UNREAD', async () => {
    vi.useFakeTimers();
    try {
      const hang = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const p = readStatusPage('https://status.example/x', hang as unknown as typeof fetch, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await p).toEqual({ ok: false });
    } finally { vi.useRealTimers(); }
    expect(await readStatusPage('u', vi.fn().mockResolvedValue(new Response('', { status: 500 })))).toEqual({ ok: false });
    expect(await readStatusPage('u', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })))).toEqual({ ok: false });
    expect(await readStatusPage('u', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: { indicator: 'none', description: 'ok' } }), { status: 200 }))))
      .toEqual({ ok: true, indicator: 'none', description: 'ok', incidents: [] });
  });

  it('sends no credentials and no referrer to the status host', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await readStatusPage('u', f);
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});

describe('production CSP', () => {
  // The dev server sends no CSP, so a localhost walk cannot see a blocked status read. Production
  // (and the phone, which loads getforgenta.com) can — and a blocked read is "unknown" for ever.
  it('vercel.json connect-src allows every status host the app reads', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
    const csp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy')?.value ?? '';
    const connect = (/connect-src ([^;]+)/.exec(csp)?.[1] ?? '').split(/\s+/);
    expect(connect.length).toBeGreaterThan(1); // positive control: the directive was found at all
    for (const { url } of Object.values(STATUS_SOURCES)) expect(connect).toContain(new URL(url).origin);
  });
});
