// EVERY SHIPPED LANGUAGE HAS EVERY LINE OF EVERY RELEASE.
//
// Tre asked for the what's-new popup to reach a returning user "in their own language". The
// dialog shipped 2026-09-13 rendering hardcoded English; this is the half that was missing.
//
// ⚠️ WHAT ACTUALLY GOES WRONG HERE IS A PARTIAL RELEASE, NOT A MISSING FILE. Nobody forgets the
// whole catalogue — they add a sixth line to `RELEASES` in English and ship it, and the Spanish
// entry silently has five. The user then reads four lines of Spanish and one of English, or (if
// the fallback were ever removed) a raw `lines.2026-09-13.5`. So the assertion is a COUNT PER
// RELEASE PER LOCALE, which is the shape the mistake actually takes.
//
// ⚠️ THE LOCALE LIST IS DERIVED FROM `SUPPORTED_LANGUAGES`, never typed out here. A list named by
// hand passes the language nobody added to it — and adding a language is exactly when this gate
// has to fire. `i18n.ts` says adding one is "an edit here plus its locale files"; this makes the
// second half enforceable rather than remembered.
//
// WHAT THIS DOES NOT CATCH, said plainly: whether a translation is any GOOD, whether it fits the
// layout at that length, and anything about a locale that is registered in `i18n.ts` but absent
// from `SUPPORTED_LANGUAGES`. Copy quality is a human read; this is only about completeness.

import { describe, it, expect } from 'vitest';
import { RELEASES } from '@/lib/whats-new';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import en from '@/locales/en/whatsNew.json';
import es from '@/locales/es/whatsNew.json';

type Catalogue = { lines: Record<string, string[]> } & Record<string, unknown>;

/** Keyed by the same codes `SUPPORTED_LANGUAGES` declares, so a gap shows up as `undefined`. */
const CATALOGUES: Record<string, Catalogue> = {
  en: en as unknown as Catalogue,
  es: es as unknown as Catalogue,
};

/** The chrome keys the dialog actually calls `t()` with. */
const CHROME_KEYS = ['dialogLabel', 'title', 'close', 'dismiss'] as const;

describe('the what\'s-new popup is complete in every shipped language', () => {
  it('examined every shipped language and every release', () => {
    // Zero examined is "nothing was compared", never a pass.
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    expect(RELEASES.length).toBeGreaterThanOrEqual(1);
  });

  it('has a catalogue for every language in SUPPORTED_LANGUAGES', () => {
    const missing = SUPPORTED_LANGUAGES.map(l => l.code).filter(c => !CATALOGUES[c]);
    expect(missing, `no whatsNew catalogue for: ${missing.join(', ')}`).toEqual([]);
  });

  it('has every chrome string in every language', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      const cat = CATALOGUES[code];
      if (!cat) continue; // reported by the case above
      for (const key of CHROME_KEYS) {
        expect(typeof cat[key], `${code}.${key}`).toBe('string');
        expect(String(cat[key]).trim().length, `${code}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('has the SAME NUMBER OF LINES as the release, in every language', () => {
    for (const release of RELEASES) {
      for (const { code } of SUPPORTED_LANGUAGES) {
        const cat = CATALOGUES[code];
        if (!cat) continue;
        const translated = cat.lines?.[release.version];
        expect(translated, `${code} has no lines for release ${release.version}`).toBeDefined();
        expect(
          translated.length,
          `${code} release ${release.version}: ${translated.length} lines vs ${release.lines.length} in English`,
        ).toBe(release.lines.length);
        for (const [i, l] of translated.entries()) {
          expect(String(l).trim().length, `${code} ${release.version} line ${i} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the non-English copy is actually DIFFERENT from the English', () => {
    // A catalogue copy-pasted from English passes every count check above and ships an
    // untranslated dialog to a Spanish reader. This is the case that notices.
    for (const release of RELEASES) {
      for (const { code } of SUPPORTED_LANGUAGES) {
        if (code === 'en') continue;
        const translated = CATALOGUES[code]?.lines?.[release.version];
        if (!translated) continue;
        const identical = translated.filter((l, i) => l === release.lines[i]);
        expect(
          identical,
          `${code} release ${release.version}: ${identical.length} line(s) identical to English`,
        ).toEqual([]);
      }
    }
  });
});
