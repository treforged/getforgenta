import { describe, it, expect, beforeEach } from 'vitest';
import {
  ATTRIBUTION_KEY,
  attributionFromSearch,
  captureAttribution,
  readAttribution,
  hasAttribution,
  attributionColumnsForSignup,
} from '@/lib/attribution';
import { referralCodeFromSearch } from '@/lib/referral';

/** A storage double, so nothing here depends on jsdom's localStorage surviving between files. */
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    dump: () => Object.fromEntries(map),
  };
}

describe('attributionFromSearch', () => {
  it('reads the three utm parameters', () => {
    const a = attributionFromSearch('?utm_source=instagram&utm_medium=bio&utm_campaign=link_in_bio');
    expect(a).toEqual({ source: 'instagram', medium: 'bio', campaign: 'link_in_bio' });
  });

  it('lowercases and trims, so InstaGram and instagram are one campaign', () => {
    expect(attributionFromSearch('?utm_source=%20InstaGram%20').source).toBe('instagram');
  });

  it('drops anything that is not a short plain token', () => {
    // These arrive from a query string anybody can type and end up in the database.
    for (const bad of ['<script>', 'a b', "o'brien", 'x'.repeat(65), '-leading', '']) {
      expect(attributionFromSearch(`?utm_source=${encodeURIComponent(bad)}`).source, bad).toBeNull();
    }
  });

  it('a URL with no utm parameters attributes nothing', () => {
    expect(hasAttribution(attributionFromSearch('?foo=bar'))).toBe(false);
  });
});

describe('capture is first-touch-wins', () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => { storage = makeStorage(); });

  it('stores the first campaign', () => {
    captureAttribution('?utm_source=instagram&utm_campaign=one', 1000, storage);
    expect(readAttribution(storage)).toEqual({ source: 'instagram', medium: null, campaign: 'one' });
  });

  it('a LATER link cannot overwrite a pending attribution', () => {
    captureAttribution('?utm_source=instagram&utm_campaign=one', 1000, storage);
    captureAttribution('?utm_source=tiktok&utm_campaign=two', 2000, storage);
    // The campaign that introduced them is the one that earned the signup.
    expect(readAttribution(storage).source).toBe('instagram');
  });

  it('a URL offering nothing does not clear what is held', () => {
    captureAttribution('?utm_source=instagram', 1000, storage);
    captureAttribution('?foo=bar', 2000, storage);
    expect(readAttribution(storage).source).toBe('instagram');
  });

  it('survives storage that throws, rather than breaking the landing page', () => {
    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(() => captureAttribution('?utm_source=instagram', 1000, hostile)).not.toThrow();
    expect(readAttribution(hostile)).toEqual({ source: null, medium: null, campaign: null });
  });

  it('re-validates on the way OUT, because storage is writable by anything in this origin', () => {
    const tampered = makeStorage({ [ATTRIBUTION_KEY]: JSON.stringify({ source: '<script>', at: 1 }) });
    expect(readAttribution(tampered).source).toBeNull();
  });

  it('unparseable storage reads as no attribution rather than throwing', () => {
    expect(readAttribution(makeStorage({ [ATTRIBUTION_KEY]: 'not json' }))).toEqual({
      source: null, medium: null, campaign: null,
    });
  });
});

describe('THE KEY REGRESSION — capture and read must use the SAME key', () => {
  /**
   * ⚠️ THIS IS THE TEST THAT WOULD HAVE CAUGHT THE 2026-08-18 REFERRAL BUG, where the capture
   * wrote `forgenta:ref`, the read asked for `forged:ref`, and 46 profiles carried 0 referrers
   * with nothing anywhere going red. A rename that separates the two halves must fail here.
   */
  it('capture writes exactly the key read reads', () => {
    const storage = makeStorage();
    captureAttribution('?utm_source=instagram', 1000, storage);
    const written = Object.keys(storage.dump());
    expect(written).toEqual([ATTRIBUTION_KEY]);
    // POSITIVE CONTROL: proves the assertion above is about a key that was really written, not
    // about an empty object trivially matching an empty list.
    expect(written).toHaveLength(1);
    expect(readAttribution(storage).source).toBe('instagram');
  });
});

describe('attribution and referrals do not collide', () => {
  it('a campaign link is NOT read as a referral code', () => {
    // Reusing `ref` would have been discarded silently by its 8-hex validator while looking like
    // attribution existed. This pins the two apart.
    expect(referralCodeFromSearch('?utm_source=instagram&utm_campaign=link_in_bio')).toBeNull();
  });

  it('a referral link is NOT read as a campaign', () => {
    expect(hasAttribution(attributionFromSearch('?ref=a1b2c3d4'))).toBe(false);
  });

  it('both can travel on one URL without either eating the other', () => {
    const search = '?ref=a1b2c3d4&utm_source=instagram&utm_campaign=link_in_bio';
    expect(referralCodeFromSearch(search)).toBe('a1b2c3d4');
    expect(attributionFromSearch(search)).toEqual({
      source: 'instagram', medium: null, campaign: 'link_in_bio',
    });
  });
});

describe('attributionColumnsForSignup', () => {
  it('writes NO columns when there is nothing to attribute', () => {
    // Spreading {} leaves an existing value alone; three explicit nulls would erase it.
    expect(attributionColumnsForSignup({ source: null, medium: null, campaign: null })).toEqual({});
  });

  it('omits the fields that are absent rather than nulling them', () => {
    expect(attributionColumnsForSignup({ source: 'instagram', medium: null, campaign: 'x' })).toEqual({
      acquisition_source: 'instagram',
      acquisition_campaign: 'x',
    });
  });
});
