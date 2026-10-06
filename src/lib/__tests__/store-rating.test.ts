import { describe, it, expect, vi } from 'vitest';
import { parseAppStoreLookup, fetchAppStoreRating, formatAverage } from '../store-rating';

// The shape Apple returned on 2026-10-06 for id 6762540239, trimmed to the fields read.
const LIVE = { resultCount: 1, results: [{ averageUserRating: 5, userRatingCount: 5 }] };

describe('parseAppStoreLookup - real numbers or nothing', () => {
  it('reads the live shape', () => {
    expect(parseAppStoreLookup(LIVE)).toEqual({ average: 5, count: 5 });
  });
  it.each([
    ['no results', { results: [] }],
    ['null body', null],
    ['zero ratings', { results: [{ averageUserRating: 4.5, userRatingCount: 0 }] }],
    ['missing count', { results: [{ averageUserRating: 4.5 }] }],
    ['average out of range', { results: [{ averageUserRating: 7, userRatingCount: 3 }] }],
    ['string average', { results: [{ averageUserRating: '5', userRatingCount: 3 }] }],
  ])('%s -> null (no rating shown)', (_name, body) => {
    expect(parseAppStoreLookup(body)).toBeNull();
  });
});

describe('fetchAppStoreRating - never throws', () => {
  it('returns the rating on 200', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => LIVE });
    await expect(fetchAppStoreRating(f as never)).resolves.toEqual({ average: 5, count: 5 });
  });
  it('returns null on a non-200 and on a network error', async () => {
    await expect(fetchAppStoreRating(vi.fn().mockResolvedValue({ ok: false }) as never)).resolves.toBeNull();
    await expect(fetchAppStoreRating(vi.fn().mockRejectedValue(new Error('offline')) as never)).resolves.toBeNull();
  });
});

describe('formatAverage', () => {
  it('prints one decimal', () => {
    expect(formatAverage(5)).toBe('5.0');
    expect(formatAverage(4.66)).toBe('4.7');
  });
});
