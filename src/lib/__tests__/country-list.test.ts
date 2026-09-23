import { describe, it, expect } from 'vitest';
import { ISO_COUNTRY_CODES, countryOptions } from '@/lib/country-list';
import { KNOWN_COUNTRIES } from '@/lib/derive-country';

describe('ISO_COUNTRY_CODES', () => {
  it('holds the 249 ISO 3166-1 codes, each two capitals, no duplicates', () => {
    expect(ISO_COUNTRY_CODES.length).toBe(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
    for (const c of ISO_COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it('excludes ICU codes that are not countries', () => {
    for (const c of ['EU', 'UN', 'XK', 'SU', 'YU', 'ZZ', 'UK']) expect(ISO_COUNTRY_CODES).not.toContain(c);
  });

  it('covers every country the device derivation can produce, so a derived value is always pickable', () => {
    expect(KNOWN_COUNTRIES.length).toBeGreaterThan(0);
    for (const c of KNOWN_COUNTRIES) expect(ISO_COUNTRY_CODES).toContain(c);
  });
});

describe('countryOptions', () => {
  it('names countries and sorts by name', () => {
    const opts = countryOptions('US', 'en');
    expect(opts.find((o) => o.code === 'US')?.name).toBe('United States');
    const names = opts.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps a stored code the list does not know, so it still shows as selected', () => {
    expect(countryOptions('QZ', 'en').some((o) => o.code === 'QZ')).toBe(true);
    expect(countryOptions('US', 'en').length).toBe(249);
  });
});
