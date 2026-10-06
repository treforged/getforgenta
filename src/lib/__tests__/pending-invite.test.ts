import { describe, it, expect } from 'vitest';
import {
  PENDING_INVITE_KEY,
  clearPendingInvite,
  PENDING_INVITE_MAX_AGE_MS,
  peekPendingInvite,
  readInviteFromSearch,
  stashInviteFromSearch,
  takePendingInvite,
} from '../pending-invite';

const CODE = 'tBE7DcqszMATZlCzFRZ14Q';
const NOW = 1_800_000_000_000;

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('pending-invite', () => {
  it('reads a partner code, a friend code, and prefers partner when both are present', () => {
    expect(readInviteFromSearch(`?partner_code=${CODE}`)).toEqual({ kind: 'partner', code: CODE });
    expect(readInviteFromSearch(`?friend_code=${CODE}`)).toEqual({ kind: 'friend', code: CODE });
    expect(readInviteFromSearch(`?friend_code=friendcode1&partner_code=${CODE}`)).toEqual({ kind: 'partner', code: CODE });
  });

  it('ignores a malformed code and a missing one', () => {
    expect(readInviteFromSearch('?partner_code=short')).toBeNull();
    expect(readInviteFromSearch('?partner_code=has%20space%20inside')).toBeNull();
    expect(readInviteFromSearch('?tab=accounts')).toBeNull();
    const s = memStore();
    expect(stashInviteFromSearch('?tab=accounts', NOW, s)).toBe(false);
    expect(s.m.size).toBe(0);
  });

  it('saves a partner code and hands it back exactly once', () => {
    const s = memStore();
    expect(stashInviteFromSearch(`?partner_code=${CODE}`, NOW, s)).toBe(true);
    expect(JSON.parse(s.m.get(PENDING_INVITE_KEY)!)).toEqual({ kind: 'partner', code: CODE, savedAt: NOW });
    expect(takePendingInvite(NOW + 1000, s)).toBe(`/account?partner_code=${CODE}`);
    expect(s.m.has(PENDING_INVITE_KEY)).toBe(false);
    expect(takePendingInvite(NOW + 2000, s)).toBeNull();
  });

  it('resumes a friend code on the friend param', () => {
    const s = memStore();
    stashInviteFromSearch(`?friend_code=${CODE}`, NOW, s);
    expect(takePendingInvite(NOW, s)).toBe(`/account?friend_code=${CODE}`);
  });

  it('drops an invite older than 7 days, and removes it', () => {
    const s = memStore();
    stashInviteFromSearch(`?partner_code=${CODE}`, NOW, s);
    expect(peekPendingInvite(NOW + PENDING_INVITE_MAX_AGE_MS + 1, s)).toBeNull();
    expect(takePendingInvite(NOW + PENDING_INVITE_MAX_AGE_MS + 1, s)).toBeNull();
    expect(s.m.has(PENDING_INVITE_KEY)).toBe(false);
  });

  it('drops a record dated more than a minute in the future', () => {
    const s = memStore();
    stashInviteFromSearch(`?partner_code=${CODE}`, NOW + 120_000, s);
    expect(takePendingInvite(NOW, s)).toBeNull();
  });

  it('drops corrupt JSON and a record of the wrong shape, and removes both', () => {
    const s = memStore();
    s.setItem(PENDING_INVITE_KEY, '{not json');
    expect(takePendingInvite(NOW, s)).toBeNull();
    expect(s.m.has(PENDING_INVITE_KEY)).toBe(false);
    s.setItem(PENDING_INVITE_KEY, JSON.stringify({ kind: 'admin', code: CODE, savedAt: NOW }));
    expect(takePendingInvite(NOW, s)).toBeNull();
    s.setItem(PENDING_INVITE_KEY, JSON.stringify({ kind: 'partner', code: '../../x', savedAt: NOW }));
    expect(takePendingInvite(NOW, s)).toBeNull();
  });

  it('peek answers the same URL twice and leaves the invite in place; clear removes it', () => {
    const s = memStore();
    stashInviteFromSearch(`?partner_code=${CODE}`, NOW, s);
    expect(peekPendingInvite(NOW, s)).toBe(`/account?partner_code=${CODE}`);
    expect(peekPendingInvite(NOW, s)).toBe(`/account?partner_code=${CODE}`);
    expect(s.m.has(PENDING_INVITE_KEY)).toBe(true);
    clearPendingInvite(s);
    expect(peekPendingInvite(NOW, s)).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    expect(stashInviteFromSearch(`?partner_code=${CODE}`, NOW, throwing)).toBe(false);
    expect(peekPendingInvite(NOW, throwing)).toBeNull();
    expect(() => clearPendingInvite(throwing)).not.toThrow();
    expect(takePendingInvite(NOW, throwing)).toBeNull();
    expect(stashInviteFromSearch(`?partner_code=${CODE}`, NOW, null)).toBe(false);
  });
});
