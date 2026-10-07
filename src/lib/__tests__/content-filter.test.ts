// Drafted by groq gpt-oss-120b, reviewed by Ada 2026-10-07; passed review unchanged.
// Assumption: Using Vitest test framework with default configuration.

import { describe, it, expect } from 'vitest';
import { filterProfanity, isSafeUrl, LIMITS } from '../content-filter';

describe('filterProfanity', () => {
  it('leaves clean text unchanged and flags false', () => {
    // Input text: "Hello world"
    // Step 1: Initialize flagged = false, clean = "Hello world"
    // Step 2: Iterate BLOCKED_WORDS regexes – none match
    // Step 3: Return { clean: "Hello world", flagged: false }
    const result = filterProfanity('Hello world');
    // Expected clean text unchanged, flagged false
    expect(result).toEqual({ clean: 'Hello world', flagged: false });
  });

  it('masks a single blocked word and flags true', () => {
    // Input text: "what the shit"
    // Step 1: flagged = false, clean = "what the shit"
    // Step 2: Regex /\bshit\b/gi matches "shit"
    //   - flagged becomes true
    //   - clean becomes "what the ***"
    // Step 3: No other regex matches
    // Step 4: Return { clean: "what the ***", flagged: true }
    const result = filterProfanity('what the shit');
    expect(result).toEqual({ clean: 'what the ***', flagged: true });
  });

  it('is case‑insensitive for blocked words', () => {
    // Input text: "SHIT happens"
    // Step 1: flagged = false, clean = "SHIT happens"
    // Step 2: /\bshit\b/gi matches "SHIT"
    //   - flagged true, clean => "*** happens"
    const result = filterProfanity('SHIT happens');
    expect(result).toEqual({ clean: '*** happens', flagged: true });
  });

  it('does not flag substrings inside other words', () => {
    // Input text: "class assess"
    // Step 1: flagged = false, clean = "class assess"
    // Step 2: No BLOCKED_WORDS regex matches because of word boundaries
    // Step 3: Return unchanged, flagged false
    const result = filterProfanity('class assess');
    expect(result).toEqual({ clean: 'class assess', flagged: false });
  });

  it('masks multiple different blocked words in one string', () => {
    // Input text: "shit and damn"
    // Step 1: flagged = false, clean = "shit and damn"
    // Step 2: /\bshit\b/gi matches "shit" → clean => "*** and damn", flagged = true
    // Step 3: /\bdamn\b/gi matches "damn" → clean => "*** and ***"
    // Step 4: Return final clean string, flagged true
    const result = filterProfanity('shit and damn');
    expect(result).toEqual({ clean: '*** and ***', flagged: true });
  });

  it('returns identical results on successive calls with the same input', () => {
    // Input text: "shit happens"
    // First call:
    //   flagged false → true, clean => "*** happens"
    // Subsequent calls should repeat the same transformation without state
    const first = filterProfanity('shit happens');
    const second = filterProfanity('shit happens');
    const third = filterProfanity('shit happens');
    // All three results must be identical
    expect(first).toEqual({ clean: '*** happens', flagged: true });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe('isSafeUrl', () => {
  it('treats empty or whitespace‑only strings as safe', () => {
    // Input: ""
    // Trim → "", early return { safe: true }
    expect(isSafeUrl('')).toEqual({ safe: true });

    // Input: "   "
    // Trim → "", early return { safe: true }
    expect(isSafeUrl('   ')).toEqual({ safe: true });
  });

  it('rejects invalid URLs', () => {
    // Input: "not a url"
    // Trim → "not a url", new URL throws → safe false, reason Invalid URL
    expect(isSafeUrl('not a url')).toEqual({
      safe: false,
      reason: 'Invalid URL — must start with http:// or https://',
    });
  });

  it('rejects non‑http/https protocols', () => {
    // Input: "javascript:alert(1)"
    // Parsed protocol "javascript:" → reject with protocol reason
    expect(isSafeUrl('javascript:alert(1)')).toEqual({
      safe: false,
      reason: 'Only http:// and https:// links are allowed',
    });

    // Input: "data:text/html,x"
    // Parsed protocol "data:" → reject with same reason
    expect(isSafeUrl('data:text/html,x')).toEqual({
      safe: false,
      reason: 'Only http:// and https:// links are allowed',
    });

    // Input: "ftp://a.com"
    // Parsed protocol "ftp:" → reject
    expect(isSafeUrl('ftp://a.com')).toEqual({
      safe: false,
      reason: 'Only http:// and https:// links are allowed',
    });
  });

  it('accepts a normal https URL', () => {
    // Input: "https://example.com"
    // Trim, parse, protocol https, hostname "example.com" contains no blocked fragment
    expect(isSafeUrl('https://example.com')).toEqual({ safe: true });
  });

  it('rejects URLs containing a blocked domain fragment', () => {
    // Choose a fragment from BLOCKED_DOMAIN_FRAGMENTS, e.g., "porn"
    // Input: "https://my.pornsite.com"
    // Hostname includes "porn" → reject with blocked domain reason
    expect(isSafeUrl('https://my.pornsite.com')).toEqual({
      safe: false,
      reason: 'That link is not allowed',
    });
  });
});

describe('LIMITS', () => {
  it('exposes the correct transactionNote limit', () => {
    // Expected constant value from source: 200
    expect(LIMITS.transactionNote).toEqual(200);
  });
});

// Sam 2026-10-07: the usual javascript: bypasses. URL lowercases the scheme and strips tabs and
// surrounding whitespace, so each is refused; the entity-encoded form does not parse at all.
describe('isSafeUrl refuses javascript: bypass forms', () => {
  it.each([
    ['mixed case', 'JavaScript:alert(1)'],
    ['leading space', ' javascript:alert(1)'],
    ['leading tab', '\tjavascript:alert(1)'],
    ['tab inside the scheme', 'jav\tascript:alert(1)'],
    ['HTML-entity encoded', 'java&#x73;cript:alert(1)'],
  ])('%s', (_name, url) => {
    expect(isSafeUrl(url).safe).toBe(false);
  });
});
