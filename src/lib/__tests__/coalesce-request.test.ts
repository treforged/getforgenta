import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { coalesce, inFlightCount, resetCoalescer } from '../coalesce-request';

/**
 * The behaviour that matters here is as much what this does NOT do as what it does.
 * It removes duplicate CONCURRENT work; it must never remove freshness, because one of its
 * callers is a security check. The "acts as a coalescer, NOT a cache" test below is the one
 * that would catch a future 'optimisation' into a real cache.
 */

/** A promise plus its resolver, so a test can hold a request open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => resetCoalescer());
afterEach(() => resetCoalescer());

describe('coalesce', () => {
  it('collapses concurrent calls into ONE factory invocation', async () => {
    const d = deferred<string>();
    const factory = vi.fn(() => d.promise);

    const a = coalesce('profile:u1', factory);
    const b = coalesce('profile:u1', factory);
    const c = coalesce('profile:u1', factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(inFlightCount()).toBe(1);

    d.resolve('row');
    expect(await Promise.all([a, b, c])).toEqual(['row', 'row', 'row']);
  });

  it('keeps DIFFERENT keys independent', async () => {
    const factory = vi.fn(async (v: string) => v);
    const a = coalesce('profile:u1', () => factory('one'));
    const b = coalesce('profile:u2', () => factory('two'));

    expect(inFlightCount()).toBe(2);
    expect(await a).toBe('one');
    expect(await b).toBe('two');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('acts as a COALESCER, NOT a cache — a later call re-fetches', async () => {
    let n = 0;
    const factory = vi.fn(async () => ++n);

    expect(await coalesce('k', factory)).toBe(1);
    expect(inFlightCount()).toBe(0); // entry released on settle

    // THE ASSERTION THAT MATTERS: the second call must hit the factory again. If this ever
    // returns 1, something turned this into a cache and `isDeviceTrusted` can go stale.
    expect(await coalesce('k', factory)).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('delivers a rejection to EVERY waiter, and raises no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const d = deferred<string>();
    const a = coalesce('bad', () => d.promise);
    const b = coalesce('bad', () => d.promise);

    d.reject(new Error('network down'));

    await expect(a).rejects.toThrow('network down');
    await expect(b).rejects.toThrow('network down');

    // Let any floating rejection surface before asserting none did.
    await new Promise(r => setTimeout(r, 10));
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('does not POISON a key after a rejection', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce('second works');

    await expect(coalesce('k', factory)).rejects.toThrow('first fails');
    expect(inFlightCount()).toBe(0);
    expect(await coalesce('k', factory)).toBe('second works');
  });

  it('turns a SYNCHRONOUS throw into a rejection and leaves the key free', async () => {
    const boom = () => { throw new Error('sync boom'); };

    await expect(coalesce('k', boom as () => Promise<never>)).rejects.toThrow('sync boom');
    expect(inFlightCount()).toBe(0);

    expect(await coalesce('k', async () => 'fine')).toBe('fine');
  });
});
