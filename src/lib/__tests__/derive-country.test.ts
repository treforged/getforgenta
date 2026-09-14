// THE COUNTRY DERIVATION, AND THE FOUR DEFECTS A FREE EXECUTOR PUT IN IT FIRST.
//
// Written after reviewing a generated first draft. Every `caught the draft` case below is one the
// draft actually FAILED — they are recorded as cases rather than as a commit message because the
// next draft of this file will be generated too, and a defect that only lives in prose is one the
// next generator is free to reintroduce.
//
//   1. It looked the zone up with `ZONE_TO_COUNTRY.get(zone)` on a plain object, which THROWS
//      `not a function` — on the one function whose entire contract is that it never throws.
//   2. It matched regions with `/^[A-Z]{2}$/`, so the perfectly ordinary tag `en-us` returned null.
//   3. It took the LAST subtag, so `en-US-POSIX` yielded nothing at all.
//   4. It started scanning at the language subtag, so `it` (Italian) could read as Italy.
//
// ⚠️ THE OUTPUT IS A COUNTRY PUBLISHED ON A LEADERBOARD, so the load-bearing assertions here are
// the NEGATIVE ones. A derivation that guesses is worse than one that abstains: abstaining shows
// somebody "not on the country board", guessing puts them in a cohort of strangers under a flag
// that is not theirs. Any change that turns one of the `null` cases into a code is a regression
// even if it makes the board look busier.

import { describe, it, expect } from 'vitest';
import { deriveCountry, readCountrySignals, KNOWN_COUNTRIES } from '@/lib/derive-country';

describe('deriveCountry — language tags', () => {
  it('reads the region from an ordinary tag', () => {
    expect(deriveCountry({ languages: ['en-US'] })).toBe('US');
    expect(deriveCountry({ languages: ['es-MX'] })).toBe('MX');
    expect(deriveCountry({ languages: ['pt-BR'] })).toBe('BR');
  });

  it('caught the draft: a tag is case-INSENSITIVE, so `en-us` must work', () => {
    expect(deriveCountry({ languages: ['en-us'] })).toBe('US');
    expect(deriveCountry({ languages: ['EN-US'] })).toBe('US');
    expect(deriveCountry({ languages: ['es-mx'] })).toBe('MX');
  });

  it('caught the draft: finds the region by SHAPE, not by position', () => {
    // Third position, after a script subtag.
    expect(deriveCountry({ languages: ['zh-Hant-TW'] })).toBe('TW');
    // A trailing variant must not hide the region in front of it.
    expect(deriveCountry({ languages: ['en-US-POSIX'] })).toBe('US');
  });

  it('caught the draft: never reads the LANGUAGE subtag as a region', () => {
    // `it` is Italian. Reading subtag 0 would call this Italy for every Italian speaker on earth.
    expect(deriveCountry({ languages: ['it'] })).toBeNull();
    expect(deriveCountry({ languages: ['de'] })).toBeNull();
    expect(deriveCountry({ languages: ['fr'] })).toBeNull();
  });

  it('a bare language, a script alone, and an M.49 region are all inconclusive', () => {
    expect(deriveCountry({ languages: ['en'] })).toBeNull();
    expect(deriveCountry({ languages: ['zh-Hant'] })).toBeNull();
    expect(deriveCountry({ languages: ['es-419'] })).toBeNull(); // Latin America is not a country
  });

  it('walks the list in order and takes the first CONCLUSIVE tag, not the first tag', () => {
    expect(deriveCountry({ languages: ['en', 'fr-CA'] })).toBe('CA');
    expect(deriveCountry({ languages: ['es-419', 'es-MX'] })).toBe('MX');
  });
});

describe('deriveCountry — time zones', () => {
  it('maps a known zone', () => {
    expect(deriveCountry({ timeZone: 'America/New_York' })).toBe('US');
    expect(deriveCountry({ timeZone: 'Europe/London' })).toBe('GB');
    expect(deriveCountry({ timeZone: 'Asia/Tokyo' })).toBe('JP');
    expect(deriveCountry({ timeZone: 'America/Argentina/Buenos_Aires' })).toBe('AR');
  });

  it('an OFFSET is not a place', () => {
    for (const zone of ['UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+5', 'Etc/GMT-14']) {
      expect(deriveCountry({ timeZone: zone })).toBeNull();
    }
  });

  it('an unknown zone abstains rather than guessing', () => {
    expect(deriveCountry({ timeZone: 'Antarctica/Troll' })).toBeNull();
    expect(deriveCountry({ timeZone: 'Not/A_Zone' })).toBeNull();
  });

  it('caught the draft: an inherited property must not resolve as a zone', () => {
    // A bare `zone in map` or `map[zone]` check answers YES for 'constructor' and 'toString'.
    expect(deriveCountry({ timeZone: 'constructor' })).toBeNull();
    expect(deriveCountry({ timeZone: 'toString' })).toBeNull();
    expect(deriveCountry({ timeZone: '__proto__' })).toBeNull();
  });
});

describe('deriveCountry — precedence', () => {
  it('the language tag OUTRANKS the time zone', () => {
    // A traveller keeps their locale and changes their zone. They stay on their own board.
    expect(deriveCountry({ languages: ['en-GB'], timeZone: 'America/New_York' })).toBe('GB');
  });

  it('falls back to the zone only when NO tag is conclusive', () => {
    expect(deriveCountry({ languages: ['en'], timeZone: 'America/New_York' })).toBe('US');
    expect(deriveCountry({ languages: [], timeZone: 'Europe/Paris' })).toBe('FR');
  });
});

describe('deriveCountry — never throws, whatever it is handed', () => {
  const hostile: unknown[] = [
    undefined, null, {}, { languages: null }, { languages: undefined },
    { languages: 'en-US' }, // a string, not an array
    { languages: [null, undefined, 42, {}, [], 'en-US'] },
    { languages: ['', '-', 'en-', '--', '-US'] },
    { timeZone: 42 }, { timeZone: '' }, { timeZone: null },
    { languages: [Symbol('x')] },
  ];

  it.each(hostile.map((h, i) => [i, h] as const))('hostile input #%i returns a code or null', (_i, input) => {
    let result: string | null = null;
    expect(() => { result = deriveCountry(input as never); }).not.toThrow();
    if (result !== null) expect(result).toMatch(/^[A-Z]{2}$/);
  });

  it('a leading empty subtag still finds a later region', () => {
    expect(deriveCountry({ languages: ['-US'] })).toBe('US');
  });
});

describe('output shape', () => {
  it('every code the zone map can emit is a well-formed alpha-2', () => {
    expect(KNOWN_COUNTRIES.length).toBeGreaterThan(10);
    for (const code of KNOWN_COUNTRIES) expect(code).toMatch(/^[A-Z]{2}$/);
  });
});

describe('readCountrySignals', () => {
  it('never throws and returns the documented shape', () => {
    let signals: ReturnType<typeof readCountrySignals> | undefined;
    expect(() => { signals = readCountrySignals(); }).not.toThrow();
    expect(signals).toBeDefined();
    expect(['string', 'object']).toContain(typeof signals!.timeZone); // string or null
  });

  it('what it reads is consumable by deriveCountry without throwing', () => {
    expect(() => deriveCountry(readCountrySignals())).not.toThrow();
  });
});
