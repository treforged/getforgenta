import { describe, expect, test } from 'vitest';
import { inboxLinkFor, type InboxLink } from '../inbox-link';

describe('inboxLinkFor', () => {
  // Gmail
  test('recognises gmail.com (case/whitespace tolerant)', () => {
    const result = inboxLinkFor('  A@Gmail.COM  ');
    expect(result).toEqual({
      provider: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
    });
  });

  test('recognises googlemail.com', () => {
    expect(inboxLinkFor('user@googlemail.com')).toEqual({
      provider: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
    });
  });

  // Outlook family
  test.each([
    ['user@outlook.com'],
    ['user@hotmail.com'],
    ['user@live.com'],
    ['user@msn.com'],
  ])('recognises %s as Outlook', (addr) => {
    expect(inboxLinkFor(addr)).toEqual({
      provider: 'Outlook',
      url: 'https://outlook.live.com/mail/0/inbox',
    });
  });

  // Yahoo family
  test.each([
    ['user@yahoo.com'],
    ['user@ymail.com'],
  ])('recognises %s as Yahoo Mail', (addr) => {
    expect(inboxLinkFor(addr)).toEqual({
      provider: 'Yahoo Mail',
      url: 'https://mail.yahoo.com/',
    });
  });

  // iCloud family
  test.each([
    ['user@icloud.com'],
    ['user@me.com'],
    ['user@mac.com'],
  ])('recognises %s as iCloud Mail', (addr) => {
    expect(inboxLinkFor(addr)).toEqual({
      provider: 'iCloud Mail',
      url: 'https://www.icloud.com/mail',
    });
  });

  // AOL
  test('recognises aol.com', () => {
    expect(inboxLinkFor('user@aol.com')).toEqual({
      provider: 'AOL Mail',
      url: 'https://mail.aol.com/',
    });
  });

  // Unknown domains
  test('returns null for unknown domain', () => {
    expect(inboxLinkFor('x@company.io')).toBeNull();
  });

  test('returns null for similar but not exact domain', () => {
    expect(inboxLinkFor('x@notgmail.com')).toBeNull();
    expect(inboxLinkFor('x@gmail.com.evil.io')).toBeNull();
  });

  // Invalid formats
  test('returns null when no @ sign', () => {
    expect(inboxLinkFor('no-at-sign')).toBeNull();
  });

  test('returns null when domain is empty', () => {
    expect(inboxLinkFor('x@')).toBeNull();
  });

  // Multiple @ signs – last one wins
  test('uses last @ to determine domain', () => {
    expect(inboxLinkFor('a@b@gmail.com')).toEqual({
      provider: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
    });
  });

  // Mutation safety
  test('mutating returned object does not affect subsequent calls', () => {
    const first = inboxLinkFor('alice@gmail.com') as InboxLink;
    first.provider = 'tampered';

    const second = inboxLinkFor('bob@gmail.com');
    expect(second).toEqual({
      provider: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox',
    });
  });

  // URL must not contain the local part
  test('returned url never contains the local part of the address', () => {
    const result = inboxLinkFor('alice@gmail.com');
    expect(result?.url.includes('alice')).toBe(false);
  });

  test('prototype keys are not providers', () => {
    expect(inboxLinkFor('x@constructor')).toBeNull();
    expect(inboxLinkFor('x@__proto__')).toBeNull();
    expect(inboxLinkFor('x@hasownproperty')).toBeNull();
  });
});
