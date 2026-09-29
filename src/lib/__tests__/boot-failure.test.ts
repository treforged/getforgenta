import { describe, it, expect, vi } from 'vitest';
import {
  BOOT_FAILURE_KEY, CHUNK_RELOAD_KEY, handleChunkLoadFailure, reportPriorBootFailure, takeBootFailure,
} from '../boot-failure';

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const REC = { reason: 'timeout 12000ms', at: '2026-09-29T16:40:00.000Z', path: '/dashboard' };

describe('handleChunkLoadFailure', () => {
  it('reloads the FIRST time and does not fail loud', () => {
    const s = memStore(); const reload = vi.fn(); const loud = vi.fn();
    expect(handleChunkLoadFailure(s, reload, loud, 'x')).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(loud).not.toHaveBeenCalled();
    expect(s.m.get(CHUNK_RELOAD_KEY)).toBe('1');
  });

  it('fails LOUD the second time in the same tab session and does not reload again', () => {
    const s = memStore({ [CHUNK_RELOAD_KEY]: '1' }); const reload = vi.fn(); const loud = vi.fn();
    expect(handleChunkLoadFailure(s, reload, loud, 'Dashboard-abc.js')).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
    expect(loud).toHaveBeenCalledWith('chunk Dashboard-abc.js');
  });

  it('fails loud rather than risk a reload loop when session storage throws', () => {
    const s = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
    const reload = vi.fn(); const loud = vi.fn();
    expect(handleChunkLoadFailure(s, reload, loud, 'x')).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('takeBootFailure', () => {
  it('reads and CLEARS a valid record', () => {
    const s = memStore({ [BOOT_FAILURE_KEY]: JSON.stringify(REC) });
    expect(takeBootFailure(s)).toEqual(REC);
    expect(s.m.has(BOOT_FAILURE_KEY)).toBe(false);
  });
  it('returns null for absent and for malformed', () => {
    expect(takeBootFailure(memStore())).toBeNull();
    expect(takeBootFailure(memStore({ [BOOT_FAILURE_KEY]: '{not json' }))).toBeNull();
    expect(takeBootFailure(memStore({ [BOOT_FAILURE_KEY]: '{"reason":5}' }))).toBeNull();
  });
});

describe('reportPriorBootFailure', () => {
  it('sends a recorded failure and clears it', async () => {
    const s = memStore({ [BOOT_FAILURE_KEY]: JSON.stringify(REC) });
    const send = vi.fn(async () => true);
    expect(await reportPriorBootFailure(s, send)).toBe('sent');
    expect(send).toHaveBeenCalledWith(REC);
    expect(s.m.has(BOOT_FAILURE_KEY)).toBe(false);
  });
  it('KEEPS the record when the send fails (no session), so it is reported next time', async () => {
    const s = memStore({ [BOOT_FAILURE_KEY]: JSON.stringify(REC) });
    expect(await reportPriorBootFailure(s, async () => false)).toBe('kept');
    expect(JSON.parse(s.m.get(BOOT_FAILURE_KEY) as string)).toEqual(REC);
  });
  it('keeps it when the send throws', async () => {
    const s = memStore({ [BOOT_FAILURE_KEY]: JSON.stringify(REC) });
    expect(await reportPriorBootFailure(s, async () => { throw new Error('net'); })).toBe('kept');
  });
  it('does nothing when there is no record', async () => {
    const send = vi.fn(async () => true);
    expect(await reportPriorBootFailure(memStore(), send)).toBe('none');
    expect(send).not.toHaveBeenCalled();
  });
});
