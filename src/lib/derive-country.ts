// A COARSE country code, derived from what the browser already tells every website. Pure, no I/O.
//
// Tre, 2026-09-14, via Sam: "do what you need to do... I just want it done." The privacy call was
// made rather than asked: DERIVE the country, never ask for it, and never use IP geolocation.
//
// ⚠️ WHY NOT IP GEOLOCATION, which is the obvious implementation. An IP address is a network fact
// about a person that this app would have to send somewhere to resolve. The locale and the time
// zone are things the browser volunteers to every site already, so deriving from them collects
// nothing new. A derived column can also be dropped; a question, once asked, cannot be un-asked.
//
// ⚠️ WHY AN UNKNOWN SIGNAL RETURNS `null` RATHER THAN A DEFAULT. This feeds a leaderboard, which
// publishes one person's standing to other people. A WRONG country is materially worse than no
// country: it puts someone in a cohort they are not in, and on a small board that is close to
// mislabelling a named individual. `null` means "not on the country board", which is honest and
// which the UI can show plainly.
//
// ⚠️ AND THE REGION SUBTAG IS FOUND BY SHAPE, NEVER BY POSITION. `zh-Hant-TW` has its region
// third; `en-US` has it second; `en` has none at all. Taking "the last subtag" reads `POSIX` out
// of `en-US-POSIX`, and taking "the second" reads the SCRIPT `Hant` out of `zh-Hant-TW` and
// invents a country called HA. The only reliable rule is: scan the subtags AFTER the first, and
// take the first one that is exactly two ASCII letters.
//
// ⚠️ A THREE-DIGIT UN M.49 REGION IS NOT A COUNTRY. `es-419` means Latin America — a continent,
// not a place — so it is rejected rather than truncated into something alpha-2-shaped.

export interface CountrySignals {
  /** IANA zone, e.g. 'America/New_York'. Usually Intl.DateTimeFormat().resolvedOptions().timeZone. */
  timeZone?: string | null;
  /** BCP-47 tags, most preferred first, e.g. ['en-US','en']. Usually navigator.languages. */
  languages?: readonly (string | null | undefined)[] | null;
}

/**
 * ⚠️ ZONES UNDER `Etc/`, plus bare `UTC` and `GMT`, ARE DELIBERATELY ABSENT. They are offsets,
 * not places — `Etc/GMT+5` is every longitude at that offset — so they must fall through to null
 * rather than resolve to whichever country happens to sit there.
 */
const ZONE_TO_COUNTRY: Readonly<Record<string, string>> = Object.freeze({
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'America/Detroit': 'US',
  'America/Indiana/Indianapolis': 'US',
  'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/Mexico_City': 'MX',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Madrid': 'ES',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT',
  'Europe/Amsterdam': 'NL',
  'Europe/Warsaw': 'PL',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ',
  'Asia/Tokyo': 'JP',
  'Asia/Kolkata': 'IN',
  'Asia/Singapore': 'SG',
  'Asia/Manila': 'PH',
  'America/Sao_Paulo': 'BR',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'Africa/Lagos': 'NG',
  'Africa/Johannesburg': 'ZA',
});

/** Every code this module can ever emit. Exported so a test can assert the output shape in bulk. */
export const KNOWN_COUNTRIES: readonly string[] = Object.freeze(
  [...new Set(Object.values(ZONE_TO_COUNTRY))].sort(),
);

const ALPHA2 = /^[A-Za-z]{2}$/;

/**
 * The region subtag of one BCP-47 tag, upper-cased, or null.
 *
 * Case is normalised because a tag is case-INSENSITIVE by specification: `en-us`, `en-US` and
 * `EN-US` are the same tag, and real browsers have shipped all three spellings.
 */
function regionOfTag(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  const parts = tag.split('-');
  // Start at 1: the first subtag is the LANGUAGE, and `it` (Italian) would otherwise read as Italy.
  for (let i = 1; i < parts.length; i++) {
    if (ALPHA2.test(parts[i])) return parts[i].toUpperCase();
  }
  return null;
}

/**
 * Derives an upper-case alpha-2 code, or null when no signal is conclusive.
 *
 * ⚠️ THE LANGUAGE TAG OUTRANKS THE TIME ZONE, and the order is a decision rather than an accident.
 * A tag's region is an explicit statement of which locale a person uses; a time zone is a
 * consequence of where their device is sitting right now. Somebody on holiday keeps their locale
 * and changes their zone, so preferring the zone would move them onto another country's board for
 * a fortnight and move them back.
 */
export function deriveCountry(signals: CountrySignals): string | null {
  const languages = signals?.languages;
  if (Array.isArray(languages)) {
    for (const tag of languages) {
      const region = regionOfTag(tag);
      if (region) return region;
    }
  }

  const zone = signals?.timeZone;
  if (typeof zone === 'string' && Object.prototype.hasOwnProperty.call(ZONE_TO_COUNTRY, zone)) {
    return ZONE_TO_COUNTRY[zone];
  }
  return null;
}

/**
 * Reads the signals from the current environment. The only environment-dependent function here,
 * and it MUST NOT THROW: `Intl` and `navigator` are both absent under SSR and in some test
 * environments, and this is called during app start-up where a throw is a white screen.
 */
export function readCountrySignals(): CountrySignals {
  let timeZone: string | null;
  let languages: readonly string[] | null;

  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    timeZone = null;
  }

  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    // `navigator.language` is the fallback because Safari has shipped an empty `languages`.
    const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : null;
    languages = list ? [...list] : null;
  } catch {
    languages = null;
  }

  return { timeZone, languages };
}
