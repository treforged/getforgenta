// ⚠️ WHAT THIS PROTECTS. Slice 6 introduces the first answer in this app that comes from OTHER
// PEOPLE, and the whole slice rests on two rules that are easy to erode by accident:
//   1. the user's own answer beats the crowd, always;
//   2. a suggestion says which of the three sources it came from, because "you said this" and
//      "other people say this" are different promises.
// The k-anonymity floor itself is enforced in the database (`crowd_merchant_categories` clamps at
// 3 and a caller cannot lower it) and is verified there — this file pins the client-side ordering.
import { describe, it, expect } from 'vitest';
import {
  resolveCategorySuggestion, describeSuggestionSource, CROWD_PRIVACY_NOTE,
} from '@/lib/crowd-category';

describe('the order of answers', () => {
  it('puts the user ahead of the crowd, even when the crowd is unanimous', () => {
    const s = resolveCategorySuggestion({
      ownCategory: 'Business',
      crowd: { category: 'Groceries', voters: 900 },
      providerCategory: 'Groceries',
      providerHasOpinion: true,
    });
    expect(s).toEqual({ category: 'Business', source: 'you' });
  });

  it('puts the crowd ahead of the bank’s own label', () => {
    const s = resolveCategorySuggestion({
      crowd: { category: 'Gas', voters: 4 },
      providerCategory: 'Shopping',
      providerHasOpinion: true,
    });
    expect(s.category).toBe('Gas');
    expect(s.source).toBe('crowd');
    expect(s.voters).toBe(4);
  });

  it('falls through to the bank when the crowd has nothing', () => {
    const s = resolveCategorySuggestion({ crowd: null, providerCategory: 'Dining', providerHasOpinion: true });
    expect(s).toEqual({ category: 'Dining', source: 'provider' });
  });

  it('answers nothing rather than guessing when no source has an opinion', () => {
    expect(resolveCategorySuggestion({})).toEqual({ category: null, source: 'none' });
    // A provider category the map could not place is not an opinion, and must not become one.
    expect(resolveCategorySuggestion({ providerCategory: 'Other', providerHasOpinion: false }))
      .toEqual({ category: null, source: 'none' });
  });
});

describe('a category no longer in the app’s vocabulary is skipped, not shown', () => {
  // ⚠️ The crowd table is written by clients, so a label the app has since dropped can survive in
  // it. Rendering that would put a dead option into a live dropdown.
  it('skips an invalid crowd category and falls through', () => {
    const s = resolveCategorySuggestion({
      crowd: { category: 'Cryptocurrency Mining', voters: 50 },
      providerCategory: 'Bills',
      providerHasOpinion: true,
    });
    expect(s).toEqual({ category: 'Bills', source: 'provider' });
  });

  it('skips an invalid remembered category rather than trusting it for being the user’s', () => {
    const s = resolveCategorySuggestion({
      ownCategory: 'Blimps',
      crowd: { category: 'Gas', voters: 3 },
    });
    expect(s.source).toBe('crowd');
  });
});

describe('the promise each source makes is stated, not implied', () => {
  it('names every source distinctly, and says nothing when there is nothing to say', () => {
    const label = (s: Parameters<typeof describeSuggestionSource>[0]) => describeSuggestionSource(s);
    const you = label({ category: 'Gas', source: 'you' });
    const crowd = label({ category: 'Gas', source: 'crowd', voters: 3 });
    const provider = label({ category: 'Gas', source: 'provider' });
    expect(new Set([you, crowd, provider]).size).toBe(3);
    expect(label({ category: null, source: 'none' })).toBeNull();
  });

  // ⚠️ At the threshold, a headcount is a headcount of a very small group, and it invites the
  // reader to work out who. The copy must not carry one.
  it('never puts a number of people in the crowd line', () => {
    const line = describeSuggestionSource({ category: 'Gas', source: 'crowd', voters: 3 }) ?? '';
    expect(line).not.toMatch(/\d/);
  });
});

describe('the privacy note says what actually leaves the account', () => {
  it('names the things that are not sent, not just the things that are', () => {
    expect(CROWD_PRIVACY_NOTE).toMatch(/never amounts/i);
    expect(CROWD_PRIVACY_NOTE).toMatch(/dates/i);
    // The k-anonymity promise is the part that makes a one-off payee safe, so it has to be said.
    expect(CROWD_PRIVACY_NOTE).toMatch(/several different people/i);
  });
});
