// Ask 98cbf494: overlapping debugLog calls must not drop each other's lines. Each write is a
// read-modify-write of one Preferences key, so without the queue the last set wins.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const tick = () => new Promise(r => setTimeout(r, 0));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    // A yield between get and set is what a real bridge call does; it lets calls interleave.
    get: async ({ key }: { key: string }) => { await tick(); return { value: store.get(key) ?? null }; },
    set: async ({ key, value }: { key: string; value: string }) => { await tick(); store.set(key, value); },
  },
}));

import { debugLog } from '../debugLog';

describe('debugLog', () => {
  beforeEach(() => store.clear());

  it('keeps every line when three calls overlap', async () => {
    await Promise.all([debugLog('FACEID_OK'), debugLog('UNLOCK_PERSISTED'), debugLog('UNLOCK_PAINTED')]);
    const events = (store.get('forged:debug_log') ?? '').split('\n').map(l => l.split('|')[1]);
    expect(events).toEqual(['JS:FACEID_OK', 'JS:UNLOCK_PERSISTED', 'JS:UNLOCK_PAINTED']);
  });

  it('still runs later writes after one fails', async () => {
    store.set('forged:debug_log', 'not|parsed');
    await debugLog('A');
    await debugLog('B');
    expect(store.get('forged:debug_log')?.split('\n')).toHaveLength(3);
  });
});
