/**
 * The public handle people connect by — Tre, 2026-09-13: "a username that only one person can use".
 *
 * ⚠️ WHAT THESE TESTS ARE ACTUALLY PROTECTING. A username is the one string in this app a stranger
 * is meant to type, so every rule here is an impersonation or enumeration guard wearing a
 * validation costume. The cases that matter most are the ones asserting a specific REASON: a rule
 * can be relaxed into a different rule while the handle stays "invalid", and only the reason
 * catches that.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeUsername, usernameProblem, isValidUsername, usernameProblemMessage,
  USERNAME_MIN, USERNAME_MAX, RESERVED_USERNAMES, USERNAME_UNAVAILABLE_MESSAGE,
} from '../username';

describe('normalizeUsername — one canonical form, so uniqueness means something', () => {
  it('trims and lower-cases', () => {
    expect(normalizeUsername('  TreForged  ')).toBe('treforged');
  });

  it('maps null and undefined to an empty string rather than throwing', () => {
    expect(normalizeUsername(null)).toBe('');
    expect(normalizeUsername(undefined)).toBe('');
  });

  it('⚠️ CASE CANNOT CREATE A SECOND PERSON: Tre and tre normalise identically', () => {
    // The database enforces this with a unique index on lower(username). If these ever diverged,
    // "only one person can use it" would be false while every test still passed.
    expect(normalizeUsername('Tre')).toBe(normalizeUsername('tre'));
  });
});

describe('usernameProblem — the reason, not just a no', () => {
  it('accepts an ordinary handle', () => {
    expect(usernameProblem('tre_forged1')).toBeNull();
    expect(isValidUsername('tre_forged1')).toBe(true);
  });

  it.each([
    ['ab', 'too-short'],
    ['a'.repeat(USERNAME_MAX + 1), 'too-long'],
    ['tre.forged', 'bad-characters'],
    ['tre-forged', 'bad-characters'],
    ['tre forged', 'bad-characters'],
    ['tré', 'bad-characters'],
    ['1tre', 'must-start-with-letter'],
    ['_tre', 'must-start-with-letter'],
    ['admin', 'reserved'],
    ['Forgenta', 'reserved'],
  ])('%s is rejected as %s', (input, expected) => {
    expect(usernameProblem(input)).toBe(expected);
  });

  it('LENGTH IS REPORTED BEFORE CHARACTERS — the first thing wrong is the first thing said', () => {
    // A 40-character string full of dots is both too long and badly formed. Saying "bad
    // characters" would send someone hunting for a character when the real problem is the length.
    expect(usernameProblem('.'.repeat(40))).toBe('too-long');
  });

  it('the boundaries are inclusive, both ends', () => {
    // Off-by-one here is the difference between a rule and a rule nobody can satisfy exactly.
    expect(usernameProblem('a'.repeat(USERNAME_MIN))).toBeNull();
    expect(usernameProblem('a'.repeat(USERNAME_MAX))).toBeNull();
    expect(usernameProblem('a'.repeat(USERNAME_MIN - 1))).toBe('too-short');
  });

  it('a reserved name is reserved in ANY case, because that is how impersonation is done', () => {
    expect(usernameProblem('ADMIN')).toBe('reserved');
    expect(usernameProblem('  SuPPorT ')).toBe('reserved');
  });

  it('every reserved word is itself a valid handle but for being reserved', () => {
    // Otherwise an entry is dead weight: a word already rejected for its characters can never
    // reach the reserved check, and someone would later "fix" the list by adding more of them.
    for (const word of RESERVED_USERNAMES) {
      expect(usernameProblem(word)).toBe('reserved');
    }
  });
});

describe('the messages a person actually reads', () => {
  it('every problem has a sentence, and none is empty', () => {
    const problems = ['too-short', 'too-long', 'bad-characters', 'must-start-with-letter', 'reserved'] as const;
    for (const p of problems) {
      expect(usernameProblemMessage(p).length).toBeGreaterThan(0);
    }
  });

  it('⚠️ RESERVED AND TAKEN READ THE SAME, which is the enumeration guard', () => {
    // A form that says "reserved" for one and "already taken" for another hands a scraper a
    // membership oracle. Both must be the same sentence.
    expect(usernameProblemMessage('reserved')).toBe(USERNAME_UNAVAILABLE_MESSAGE);
  });
});
