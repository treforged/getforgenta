import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseLookup, withAggregateRating, fetchStoreRating } from '../app-store-rating';

// The REAL index.html, so a reworded JSON-LD block breaks this test rather than the build.
const INDEX = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');

function jsonLd(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no JSON-LD');
  return JSON.parse(m[1]);
}

describe('parseLookup', () => {
  it('reads Apple\'s rating and rounds it to one decimal', () => {
    expect(parseLookup({ resultCount: 1, results: [{ averageUserRating: 4.666, userRatingCount: 12 }] }))
      .toEqual({ ratingValue: 4.7, ratingCount: 12 });
  });

  it.each([
    ['no results', { resultCount: 0, results: [] }],
    ['no ratings yet', { resultCount: 1, results: [{ averageUserRating: 0, userRatingCount: 0 }] }],
    ['rating out of range', { resultCount: 1, results: [{ averageUserRating: 7, userRatingCount: 3 }] }],
    ['a rating with zero ratings behind it', { resultCount: 1, results: [{ averageUserRating: 5, userRatingCount: 0 }] }],
    ['count missing', { resultCount: 1, results: [{ averageUserRating: 5 }] }],
    ['not an object', 'oops'],
  ])('returns null for %s', (_label, body) => {
    expect(parseLookup(body)).toBeNull();
  });
});

describe('withAggregateRating on the real index.html', () => {
  it('adds the rating as strings and keeps every other field', () => {
    const before = jsonLd(INDEX);
    const after = jsonLd(withAggregateRating(INDEX, { ratingValue: 5, ratingCount: 5 }));
    expect(after.aggregateRating).toEqual({
      '@type': 'AggregateRating', ratingValue: '5.0', ratingCount: '5', bestRating: '5', worstRating: '1',
    });
    const { aggregateRating: _drop, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it('leaves the page byte-identical when Apple could not be read', () => {
    expect(withAggregateRating(INDEX, null)).toBe(INDEX);
  });

  it('the source page carries no rating of its own', () => {
    expect(jsonLd(INDEX).aggregateRating).toBeUndefined();
  });

  it('throws when the JSON-LD block is gone, rather than shipping silently without it', () => {
    expect(() => withAggregateRating('<html></html>', { ratingValue: 5, ratingCount: 1 })).toThrow(/not found/);
  });

  it('does not read a $ in the page as a replacement pattern', () => {
    const html = '<script type="application/ld+json">{"@type":"SoftwareApplication","name":"$& $1"}</script>';
    expect(jsonLd(withAggregateRating(html, { ratingValue: 5, ratingCount: 1 })).name).toBe('$& $1');
  });
});

describe('fetchStoreRating', () => {
  it('returns null, never throws, when the network fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await expect(fetchStoreRating(failing)).resolves.toBeNull();
    warn.mockRestore();
  });

  it('returns null on a non-2xx answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = (() => Promise.resolve(new Response('x', { status: 503 }))) as unknown as typeof fetch;
    await expect(fetchStoreRating(bad)).resolves.toBeNull();
    warn.mockRestore();
  });

  it('reads a good answer', async () => {
    const ok = (() => Promise.resolve(new Response(JSON.stringify({
      resultCount: 1, results: [{ averageUserRating: 5, userRatingCount: 5 }],
    })))) as unknown as typeof fetch;
    await expect(fetchStoreRating(ok)).resolves.toEqual({ ratingValue: 5, ratingCount: 5 });
  });
});
