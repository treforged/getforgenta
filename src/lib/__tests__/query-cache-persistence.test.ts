// 86bccda4 — the last-known data survives a cold launch. These pin the round trip, and the half
// that matters more: what is NEVER written (another person's data, demo data, routing state) and
// what is thrown away (another user's copy, an old copy, a corrupt copy).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  PERSIST_KEY, PERSIST_MAX_AGE_MS, restorePersistedQueries, startQueryPersistence, clearPersistedQueries,
} from '@/lib/query-cache-persistence';

const ME = 'user-me';
const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
};
const flush = () => vi.advanceTimersByTime(1000);

afterEach(() => vi.useRealTimers());

describe('query cache persistence', () => {
  it('round-trips the signed-in user’s own queries, and they arrive STALE so they refetch', () => {
    vi.useFakeTimers();
    const store = memory();
    const a = new QueryClient();
    const stop = startQueryPersistence(a, ME, { storage: store, now: () => 1_000 });
    a.setQueryData(['accounts', ME], [{ id: 'acc1', balance: 120 }]);
    flush();
    stop();
    expect(store.raw.has(PERSIST_KEY)).toBe(true);

    const savedAt = a.getQueryState(['accounts', ME])!.dataUpdatedAt;
    vi.advanceTimersByTime(60 * 60 * 1000); // the next launch, an hour later

    const b = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    expect(restorePersistedQueries(b, ME, 2_000, store)).toBe(1);
    expect(b.getQueryData(['accounts', ME])).toEqual([{ id: 'acc1', balance: 120 }]);
    // It carries its ORIGINAL timestamp, so it is stale on arrival: a launch shows it and then
    // refetches it, rather than treating an hour-old balance as fresh.
    expect(b.getQueryState(['accounts', ME])!.dataUpdatedAt).toBe(savedAt);
    expect(Date.now() - b.getQueryState(['accounts', ME])!.dataUpdatedAt).toBeGreaterThan(30_000);
  });

  it('NEVER writes another person’s data, demo data, or routing state', () => {
    vi.useFakeTimers();
    const store = memory();
    const qc = new QueryClient();
    const stop = startQueryPersistence(qc, ME, { storage: store });
    qc.setQueryData(['accounts', 'partner-id'], [{ id: 'theirs' }]);
    qc.setQueryData(['accounts', 'demo'], [{ id: 'demo' }]);
    qc.setQueryData(['profile', ME], { display_name: 'x' });
    qc.setQueryData(['onboarding-completed', ME], true);
    qc.setQueryData(['goals', ME], [{ id: 'mine' }]);
    flush();
    stop();
    const saved = JSON.parse(store.raw.get(PERSIST_KEY)!);
    expect(saved.state.queries.map((q: { queryKey: unknown[] }) => q.queryKey)).toEqual([['profile', ME], ['goals', ME]]);
  });

  it.each([
    ['another user’s copy', { userId: 'someone-else', savedAt: 1_000 }, 2_000],
    ['a copy older than the max age', { userId: ME, savedAt: 1_000 }, 1_000 + PERSIST_MAX_AGE_MS + 1],
    ['a copy dated in the future', { userId: ME, savedAt: 5_000 }, 1_000],
  ])('discards %s and restores nothing', (_, meta, now) => {
    const store = memory();
    store.setItem(PERSIST_KEY, JSON.stringify({ ...meta, state: { mutations: [], queries: [{ queryKey: ['x', ME], queryHash: '["x"]', state: { data: 1, dataUpdatedAt: 1, status: 'success' } }] } }));
    const qc = new QueryClient();
    expect(restorePersistedQueries(qc, ME, now, store)).toBe(0);
    expect(store.raw.has(PERSIST_KEY)).toBe(false);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('discards a corrupt copy instead of throwing', () => {
    const store = memory();
    store.setItem(PERSIST_KEY, '{not json');
    expect(restorePersistedQueries(new QueryClient(), ME, 1, store)).toBe(0);
    expect(store.raw.has(PERSIST_KEY)).toBe(false);
  });

  it('restores nothing without a user', () => {
    const store = memory();
    store.setItem(PERSIST_KEY, JSON.stringify({ userId: ME, savedAt: 1, state: { mutations: [], queries: [] } }));
    expect(restorePersistedQueries(new QueryClient(), null, 2, store)).toBe(0);
  });

  it('a full storage never throws into the app', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const stop = startQueryPersistence(qc, ME, { storage: { setItem: () => { throw new Error('QuotaExceededError'); } } });
    qc.setQueryData(['accounts', ME], [1]);
    expect(() => flush()).not.toThrow();
    stop();
  });

  it('stopping cancels a pending write, and sign-out deletes the copy', () => {
    vi.useFakeTimers();
    const store = memory();
    const qc = new QueryClient();
    const stop = startQueryPersistence(qc, ME, { storage: store });
    qc.setQueryData(['accounts', ME], [1]);
    stop();
    flush();
    expect(store.raw.has(PERSIST_KEY)).toBe(false);

    store.setItem(PERSIST_KEY, 'anything');
    clearPersistedQueries(store);
    expect(store.raw.has(PERSIST_KEY)).toBe(false);
  });
});
