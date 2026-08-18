import { describe, it, expect } from 'vitest';
import {
  REFERRAL_KEY,
  REFERRAL_WINDOW_MS,
  isValidReferralCode,
  referralCodeFromSearch,
  captureReferral,
  readReferral,
  clearReferral,
  resolveReferrerForSignup,
} from '@/lib/referral';

/** A storage double. Real enough to catch key-name drift, which is the bug this file exists for. */
function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Storage that refuses every operation — private mode, quota exhausted, blocked by policy. */
const throwingStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

const NOW = 1_760_000_000_000;

describe('isValidReferralCode', () => {
  it('accepts the 8-hex shape the Settings link actually produces', () => {
    expect(isValidReferralCode('a1b2c3d4')).toBe(true);
    expect(isValidReferralCode('A1B2C3D4')).toBe(true);
  });

  it('rejects anything that is not that shape', () => {
    // The query string is attacker-controlled and the destination is a column other users
    // are matched against, so the door is the place to stop this.
    for (const bad of ['', 'a1b2c3d', 'a1b2c3d4e', 'zzzzzzzz', '../../etc', null, undefined, 12345678, {}]) {
      expect(isValidReferralCode(bad)).toBe(false);
    }
  });
});

describe('referralCodeFromSearch', () => {
  it('reads ?ref= and lowercases it', () => {
    expect(referralCodeFromSearch('?ref=A1B2C3D4')).toBe('a1b2c3d4');
    expect(referralCodeFromSearch(new URLSearchParams('ref=a1b2c3d4'))).toBe('a1b2c3d4');
  });

  it('returns null for a missing or malformed ref', () => {
    expect(referralCodeFromSearch('')).toBeNull();
    expect(referralCodeFromSearch('?utm_source=x')).toBeNull();
    expect(referralCodeFromSearch('?ref=not-a-code')).toBeNull();
  });
});

describe('capture → read: the round trip that was broken', () => {
  it('THE BUG: what capture writes is what read reads', () => {
    // This is the whole defect. The writer used 'forgenta:ref' and the reader used 'forged:ref',
    // so this round trip returned null for every referral ever clicked. Splitting the key in two
    // again fails right here.
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    expect(readReferral(NOW, storage)).toBe('a1b2c3d4');
  });

  it('stores under exactly one key, and it is the exported one', () => {
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    expect([...storage.map.keys()]).toEqual([REFERRAL_KEY]);
  });

  it('records the capture time alongside the code', () => {
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    expect(JSON.parse(storage.map.get(REFERRAL_KEY)!)).toEqual({ code: 'a1b2c3d4', at: NOW });
  });

  it('ignores a URL with no usable ref and leaves storage untouched', () => {
    const storage = makeStorage();
    expect(captureReferral('?ref=nope!', NOW, storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });
});

describe('first capture wins', () => {
  it('keeps the original referrer when a second link arrives', () => {
    // Anna introduced them; Ben cannot take the credit by getting one more URL loaded.
    const storage = makeStorage();
    captureReferral('?ref=aaaaaaaa', NOW, storage);
    const held = captureReferral('?ref=bbbbbbbb', NOW + 1000, storage);
    expect(held).toBe('aaaaaaaa');
    expect(readReferral(NOW + 1000, storage)).toBe('aaaaaaaa');
  });

  it('but replaces one that has already aged out', () => {
    const storage = makeStorage();
    captureReferral('?ref=aaaaaaaa', NOW, storage);
    const later = NOW + REFERRAL_WINDOW_MS + 1;
    expect(captureReferral('?ref=bbbbbbbb', later, storage)).toBe('bbbbbbbb');
    expect(readReferral(later, storage)).toBe('bbbbbbbb');
  });

  it('a bare visit does not disturb a code already held', () => {
    const storage = makeStorage();
    captureReferral('?ref=aaaaaaaa', NOW, storage);
    expect(captureReferral('', NOW + 5, storage)).toBe('aaaaaaaa');
    expect(readReferral(NOW + 5, storage)).toBe('aaaaaaaa');
  });
});

describe('the attribution window', () => {
  it('attributes right up to the boundary', () => {
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    expect(readReferral(NOW + REFERRAL_WINDOW_MS, storage)).toBe('a1b2c3d4');
  });

  it('stops attributing one millisecond past it', () => {
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    expect(readReferral(NOW + REFERRAL_WINDOW_MS + 1, storage)).toBeNull();
  });
});

describe('readReferral survives junk without throwing', () => {
  it.each([
    ['unparseable', 'not json'],
    ['not an object', '"a1b2c3d4"'],
    ['null', 'null'],
    ['missing timestamp', JSON.stringify({ code: 'a1b2c3d4' })],
    ['non-numeric timestamp', JSON.stringify({ code: 'a1b2c3d4', at: 'yesterday' })],
    ['malformed code', JSON.stringify({ code: 'DROP TABLE', at: NOW })],
  ])('returns null for a %s record', (_label, raw) => {
    expect(readReferral(NOW, makeStorage({ [REFERRAL_KEY]: raw }))).toBeNull();
  });

  it('does not delete what it could not read', () => {
    // A read that quietly deletes makes the stored value depend on who happened to look at it.
    const storage = makeStorage({ [REFERRAL_KEY]: 'not json' });
    readReferral(NOW, storage);
    expect(storage.map.has(REFERRAL_KEY)).toBe(true);
  });
});

describe('a broken storage never breaks the page', () => {
  it('capture, read and clear all swallow a throwing storage', () => {
    expect(() => captureReferral('?ref=a1b2c3d4', NOW, throwingStorage)).not.toThrow();
    expect(readReferral(NOW, throwingStorage)).toBeNull();
    expect(() => clearReferral(throwingStorage)).not.toThrow();
  });
});

describe('clearReferral', () => {
  it('forgets the code so it cannot attribute a second signup', () => {
    const storage = makeStorage();
    captureReferral('?ref=a1b2c3d4', NOW, storage);
    clearReferral(storage);
    expect(readReferral(NOW, storage)).toBeNull();
  });
});

describe('resolveReferrerForSignup', () => {
  it('attributes a genuine referrer', () => {
    expect(resolveReferrerForSignup('a1b2c3d4', 'ffffffff-0000-0000-0000-000000000000')).toBe('a1b2c3d4');
  });

  it('REFUSES self-referral — the first thing anyone tries', () => {
    // The shortest path to your own link is your own Settings page.
    expect(resolveReferrerForSignup('a1b2c3d4', 'a1b2c3d4-0000-0000-0000-000000000000')).toBeNull();
  });

  it('catches self-referral regardless of case', () => {
    expect(resolveReferrerForSignup('A1B2C3D4', 'a1b2c3d4-0000-0000-0000-000000000000')).toBeNull();
  });

  it('writes nothing when there is no code', () => {
    expect(resolveReferrerForSignup(null, 'ffffffff-0000-0000-0000-000000000000')).toBeNull();
  });

  it('still attributes when the signing-up user id is unknown', () => {
    // Nothing to compare against is not a reason to throw away a real referral.
    expect(resolveReferrerForSignup('a1b2c3d4', null)).toBe('a1b2c3d4');
  });
});
