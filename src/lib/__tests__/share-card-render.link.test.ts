// @vitest-environment jsdom
// A shared card must carry a link someone can TAP, tagged so the arrival is attributable.
//
// Until 2026-09-30 the card printed "getforgenta.com" into the image and both share calls sent no
// URL: the native sheet got only the image file, the web share got only `files`. A friend could see
// the name and could not follow it, and nothing could count arrivals from a share. These tests assert
// on what the share SHEET receives, on both paths, and then parse that link with the same function
// the app uses on arrival - so "a working link" means the app itself reads it as a share arrival.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attributionFromSearch } from '../attribution';

const native = vi.hoisted(() => ({ on: false, shareArgs: [] as unknown[] }));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: async () => ({ uri: 'file:///cache/forgenta-debt-free.png' }) },
  Directory: { Cache: 'CACHE' },
}));
vi.mock('@capacitor/share', () => ({
  Share: { share: async (args: unknown) => { native.shareArgs.push(args); return {}; } },
}));

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

function linkIn(text: unknown): URL {
  const m = String(text ?? '').match(/https:\/\/\S+/);
  if (!m) throw new Error(`no link in share text: ${String(text)}`);
  return new URL(m[0]);
}

beforeEach(() => {
  native.on = false;
  native.shareArgs = [];
});

describe('share card carries a tappable, attributable link', () => {
  it('native share sheet receives the image AND the tagged link', async () => {
    native.on = true;
    const { shareCardImage } = await import('../share-card-render');
    expect(await shareCardImage(PNG)).toBe('shared');
    expect(native.shareArgs).toHaveLength(1);
    const args = native.shareArgs[0] as { url: string; text: string };
    expect(args.url).toBe('file:///cache/forgenta-debt-free.png'); // the image still goes
    const link = linkIn(args.text);
    expect(link.hostname).toBe('getforgenta.com');
    expect(attributionFromSearch(link.search)).toEqual({ source: 'share_card', medium: 'app', campaign: 'debt_free_date' });
  });

  it('web share receives the image AND the tagged link', async () => {
    const calls: ShareData[] = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async (d: ShareData) => { calls.push(d); }, configurable: true });
    const { shareCardImage } = await import('../share-card-render');
    expect(await shareCardImage(PNG)).toBe('shared');
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toHaveLength(1);
    const link = linkIn(calls[0].text);
    expect(attributionFromSearch(link.search)).toEqual({ source: 'share_card', medium: 'app', campaign: 'debt_free_date' });
  });
});
