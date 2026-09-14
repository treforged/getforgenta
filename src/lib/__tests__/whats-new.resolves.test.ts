// THE TRANSLATION KEY ACTUALLY RESOLVES — measured through i18next, not assumed.
//
// ⚠️ THE ASSUMPTION WORTH TESTING IS THE KEY SHAPE, NOT THE CATALOGUE. The dialog asks for
// `lines.${version}.${i}` — a dotted path whose last segment is an ARRAY INDEX and whose middle
// segment is a date. Whether i18next walks that depends on its `keySeparator` and on how it
// treats arrays, and "the JSON contains the string" proves nothing about either. A completeness
// gate over the catalogue would stay green while every line rendered as a raw key.
//
// ⚠️ AND THE ENGLISH FALLBACK IS THE OTHER HALF. A release line with no translation must render
// the English sentence, never `lines.2026-09-13.5`. That path only runs for copy nobody has
// translated yet, which means it is the branch least likely to be exercised by hand and the one
// a real user hits first after a release.

import { describe, it, expect } from 'vitest';
import i18n from '@/lib/i18n';
import { CURRENT_RELEASE } from '@/lib/whats-new';
import es from '@/locales/es/whatsNew.json';

const key = (i: number) => `lines.${CURRENT_RELEASE.version}.${i}`;

describe('what\'s-new line keys resolve through i18next', () => {
  it('resolves each line to the SPANISH sentence when the language is es', async () => {
    await i18n.changeLanguage('es');
    const expected = (es as { lines: Record<string, string[]> }).lines[CURRENT_RELEASE.version];
    expect(expected.length).toBe(CURRENT_RELEASE.lines.length);

    CURRENT_RELEASE.lines.forEach((english, i) => {
      const got = i18n.t(key(i), { ns: 'whatsNew', defaultValue: english });
      expect(got, `line ${i} did not resolve — got the raw key or the fallback`).toBe(expected[i]);
      // Belt and braces: it must not be the key, and must not still be English.
      expect(got).not.toBe(key(i));
      expect(got).not.toBe(english);
    });
  });

  it('resolves to ENGLISH when the language is en', async () => {
    await i18n.changeLanguage('en');
    CURRENT_RELEASE.lines.forEach((english, i) => {
      expect(i18n.t(key(i), { ns: 'whatsNew', defaultValue: english })).toBe(english);
    });
  });

  it('FALLS BACK to the English sentence for a line with no translation', async () => {
    await i18n.changeLanguage('es');
    const beyond = CURRENT_RELEASE.lines.length + 3; // an index no catalogue has
    const english = 'A line nobody has translated yet.';
    const got = i18n.t(`lines.${CURRENT_RELEASE.version}.${beyond}`, { ns: 'whatsNew', defaultValue: english });
    expect(got).toBe(english);
    expect(got).not.toContain('lines.');
  });

  it('the chrome strings resolve, and differ between the two languages', async () => {
    for (const k of ['dialogLabel', 'title', 'close', 'dismiss']) {
      await i18n.changeLanguage('en');
      const enVal = i18n.t(k, { ns: 'whatsNew' });
      await i18n.changeLanguage('es');
      const esVal = i18n.t(k, { ns: 'whatsNew' });
      expect(enVal, `${k} unresolved in en`).not.toBe(k);
      expect(esVal, `${k} unresolved in es`).not.toBe(k);
      expect(esVal, `${k} is identical in both languages`).not.toBe(enVal);
    }
    await i18n.changeLanguage('en');
  });
});
