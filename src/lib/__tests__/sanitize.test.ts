// sanitize.ts strips tags before writes (useSupabaseData). Drafted by groq gpt-oss-120b, reviewed by Ada.
import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizePayload } from '../sanitize';

describe('sanitizeString', () => {
  it('removes simple script tags', () => {
    const input = '<script>alert(1)</script>';
    const output = sanitizeString(input);
    expect(output).toBe('alert(1)');
  });

  it('removes straddling tags and leaves no "<"', () => {
    const input = '<scr<script>ipt>alert(1)</scr</script>ipt>';
    const output = sanitizeString(input);
    // `<scr<script>` and `</scr</script>` each go in one match; the leftover `ipt>` is inert text.
    expect(output).toBe('ipt>alert(1)ipt>');
    expect(output).not.toContain('<');
  });

  it('strips ASCII control characters (0x00 and 0x7F)', () => {
    const input = '\x00foo\x7F';
    const output = sanitizeString(input);
    expect(output).toBe('foo');
  });

  it('collapses tabs and newlines to a single space', () => {
    const input = 'a\t\nb';
    const output = sanitizeString(input);
    expect(output).toBe('a b');
  });

  it('trims leading and trailing whitespace', () => {
    const input = '  \n\tHello World  \t\n';
    const output = sanitizeString(input);
    expect(output).toBe('Hello World');
  });
});

describe('sanitizePayload', () => {
  it('sanitizes string fields while leaving other primitives unchanged', () => {
    const input = {
      safe: 'plain',
      dirty: '<b>bold</b>',
      number: 42,
      nan: NaN,
      inf: Infinity,
      negInf: -Infinity,
      bool: false,
      nil: null,
      arr: [1, '<i>i</i>', { nested: 'no' }],
    };
    const expected = {
      safe: 'plain',
      dirty: 'bold',
      number: 42,
      nan: null,
      inf: null,
      negInf: null,
      bool: false,
      nil: null,
      arr: [1, 'i', { nested: 'no' }],
    };
    const output = sanitizePayload(input);
    expect(output).toEqual(expected);
  });

  it('cleans strings inside nested objects and arrays (jsonb columns such as balance_tranches)', () => {
    const input = {
      outer: ' <script>bad</script> ',
      inner: { html: '<b>x</b>', num: 5 },
    };
    const expected = {
      outer: 'bad',
      inner: { html: 'x', num: 5 },
    };
    const output = sanitizePayload(input);
    expect(output).toEqual(expected);
  });

  it('cleans a balance tranche label and keeps dates and numbers', () => {
    const out = sanitizePayload({ balance_tranches: [{ id: 't1', label: '<img src=x onerror=alert(1)>Promo  0%', apr: 0, promo_end_date: '2027-01-31' }] });
    expect(out).toEqual({ balance_tranches: [{ id: 't1', label: 'Promo 0%', apr: 0, promo_end_date: '2027-01-31' }] });
  });
});
