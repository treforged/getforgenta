import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enLanding from '@/locales/en/landing.json';
import esLanding from '@/locales/es/landing.json';

/**
 * THE TRANSLATION SCAFFOLD — one library, one namespace, one real language.
 *
 * ⚠️ SCOPE, DELIBERATELY SMALL. This translates the `landing` namespace and nothing
 * else. Every other surface still renders its English literals, unchanged, and that
 * is not an oversight: a half-translated screen is worse than an English one, so a
 * surface is either fully in the catalogue or it is not in it at all. The next
 * surface adds a namespace file per locale and nothing here has to change.
 *
 * ⚠️ ARABIC AND RTL ARE A SEPARATE SLICE. `dir` is set on <html> below so the
 * plumbing is in place, but no RTL locale is registered, because mirroring the
 * layout is the actual work and shipping the strings without it would produce a
 * page that reads backwards. See docs/international-release-plan.md.
 *
 * ⚠️ THIS IS NOT THE MONEY FORMATTER. `formatCurrency` in `calculations.ts` owns how
 * an amount is written, driven by `setMoneyDisplay` from the user's profile and the
 * browser locale. Language and money formatting are different knobs on purpose: a
 * person reading the app in Spanish may still hold a USD account, and restating
 * their balances because they changed the interface language would be a lie.
 */

/** One row per shipped language. The switcher renders this, so adding a language is
 *  an edit here plus its locale files — never a second list to keep in sync. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' as const },
  { code: 'es', label: 'Español', dir: 'ltr' as const },
];

export const DEFAULT_LANGUAGE = 'en';

/** Where the choice is remembered. Deliberately localStorage and NOT the profile row:
 *  the language is a property of the device somebody is reading on, it must work on
 *  the signed-out Landing page where there is no profile to read, and it needs no
 *  migration to ship. Moving it to the profile later is additive. */
export const LANGUAGE_STORAGE_KEY = 'forgenta.language';

function isSupported(code: string | undefined | null): code is string {
  return !!code && SUPPORTED_LANGUAGES.some(l => l.code === code);
}

function storedLanguage(): string | null {
  // Private-mode Safari and some embedded webviews THROW on localStorage rather than
  // returning null, and an exception here would blank the whole app before first paint.
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The browser's preference, reduced to a language we actually ship. `es-MX` and
 *  `es-419` both mean the `es` catalogue; an unshipped language means English rather
 *  than a page of missing keys. */
function browserLanguage(): string | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const candidates = nav?.languages?.length ? nav.languages : [nav?.language];
  for (const tag of candidates) {
    const base = tag?.split('-')[0];
    if (isSupported(base)) return base;
  }
  return null;
}

/** Stored choice first — an explicit decision outranks a device default — then the
 *  browser, then English. */
export function resolveInitialLanguage(): string {
  const stored = storedLanguage();
  if (isSupported(stored)) return stored;
  return browserLanguage() ?? DEFAULT_LANGUAGE;
}

/** Keep the document in step with the language. `lang` is what a screen reader uses to
 *  pick a voice, and getting it wrong makes Spanish read aloud in an English accent —
 *  so this is an accessibility fix, not decoration. `dir` is set for the RTL slice that
 *  has not landed yet; today every shipped language is `ltr`. */
function applyDocumentLanguage(code: string): void {
  if (typeof document === 'undefined') return;
  const entry = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = entry?.dir ?? 'ltr';
}

/** Change the language and remember it. Returns nothing; `useTranslation` re-renders. */
export function setLanguage(code: string): void {
  if (!isSupported(code)) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // A device that cannot persist still gets the language for this session.
  }
  void i18n.changeLanguage(code);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { landing: enLanding },
    es: { landing: esLanding },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'landing',
  // React escapes everything it renders already; leaving i18next's escaper on would
  // double-encode an apostrophe into `&#39;` on screen.
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

export default i18n;
