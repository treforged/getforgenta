/**
 * WHERE A NEW USER CAME FROM — campaign attribution, kept strictly apart from referrals.
 *
 * ⚠️ WHY THIS IS NOT `ref`, WHICH ALREADY EXISTS. Ellis measured (2026-09-17) that no link from
 * treforged.com is attributable once the visitor lands here: production reads exactly one query
 * parameter, `ref`, and `utm_` appears nowhere in `src/` except a test asserting it is ignored.
 * He deliberately did NOT reuse `ref` to fix it, and he was right to leave that call here.
 *
 * `ref` means a referral CODE: `/^[0-9a-f]{8}$/`, the first 8 characters of a referrer's uuid,
 * validated at the door because its destination is a column this app matches other users against.
 * A campaign name like `link_in_bio` is not that shape, so reusing `ref` would not merely be
 * untidy — `referralCodeFromSearch` would DISCARD it silently and attribute nothing, while
 * looking like attribution existed. That is the failure Ellis refused to ship.
 *
 * So campaigns use the `utm_*` convention, which is what every analytics tool, every link builder
 * and the marketing desk's own links already emit. Using the parameter people already know beats
 * inventing a private one.
 *
 * ── FIRST TOUCH WINS, matching `referral.ts` ───────────────────────────────
 * The campaign that INTRODUCED somebody is the one that earned the signup, and last-touch would
 * let any later link overwrite a pending attribution. Same rule, same reasoning, deliberately the
 * same as the referral module so the two cannot disagree about what "source" means.
 *
 * ⚠️ ONE MODULE OWNS THE KEY, AND THAT IS NOT A STYLE PREFERENCE. The referral chain was silently
 * broken until 2026-08-18 because the capture wrote `forgenta:ref` and the read asked for
 * `forged:ref` — **46 profiles, 0 referrers, and nothing anywhere went red.** Both halves live
 * here for that reason, and a test pins the key so a rename cannot separate them again.
 *
 * ⚠️ VALIDATION IS NOT DECORATION. These values arrive from a query string anybody can type and
 * end up in the database. Anything that is not a short, plain campaign token is dropped at the
 * door rather than stored and puzzled over later.
 */

export const ATTRIBUTION_KEY = 'forgenta:acq';

/** Only what a real campaign link produces: short, lowercase, no separators beyond - and _ */
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface Attribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

interface StoredAttribution extends Attribution {
  at: number;
}

const EMPTY: Attribution = { source: null, medium: null, campaign: null };

function clean(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  return TOKEN.test(lowered) ? lowered : null;
}

/** What a URL is offering, or all-null when it offers nothing usable. Pure. */
export function attributionFromSearch(search: string | URLSearchParams): Attribution {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return {
    source: clean(params.get('utm_source')),
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
  };
}

/** True when there is anything worth storing. A medium with no source is still a signal. */
export function hasAttribution(a: Attribution): boolean {
  return a.source !== null || a.medium !== null || a.campaign !== null;
}

export function readAttribution(
  storage: Pick<Storage, 'getItem'> = localStorage,
): Attribution {
  try {
    const raw = storage.getItem(ATTRIBUTION_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredAttribution>;
    // Re-validated on the way OUT as well as in. Storage is writable by anything running in this
    // origin, so trusting it because we wrote it once is the same mistake as trusting the URL.
    return {
      source: clean(parsed?.source ?? null),
      medium: clean(parsed?.medium ?? null),
      campaign: clean(parsed?.campaign ?? null),
    };
  } catch {
    // Unparseable, blocked, or private mode. An unattributed signup is the pre-existing
    // behaviour; a thrown error on a landing page is a regression.
    return EMPTY;
  }
}

/**
 * Record a campaign seen in a URL. Safe to run on every navigation: first touch wins, so a later
 * link cannot overwrite a pending attribution, and a URL offering nothing changes nothing.
 *
 * Returns the attribution now held, so a caller can tell what is stored without re-reading.
 */
export function captureAttribution(
  search: string | URLSearchParams,
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Attribution {
  const offered = attributionFromSearch(search);
  const existing = readAttribution(storage);

  if (!hasAttribution(offered)) return existing;
  if (hasAttribution(existing)) return existing;

  try {
    const record: StoredAttribution = { ...offered, at: now };
    storage.setItem(ATTRIBUTION_KEY, JSON.stringify(record));
  } catch {
    // Never break the page somebody landed on over a marketing detail.
  }
  return offered;
}

/**
 * The columns to write at signup, or an empty object when there is nothing to attribute.
 *
 * Returns an object to SPREAD, so an unattributed signup writes no columns at all rather than
 * three explicit nulls — the difference between "arrived directly" and "we overwrote what was
 * there" matters on a row that may already carry a value.
 */
export function attributionColumnsForSignup(
  a: Attribution = readAttribution(),
): Partial<Record<'acquisition_source' | 'acquisition_medium' | 'acquisition_campaign', string>> {
  if (!hasAttribution(a)) return {};
  return {
    ...(a.source ? { acquisition_source: a.source } : {}),
    ...(a.medium ? { acquisition_medium: a.medium } : {}),
    ...(a.campaign ? { acquisition_campaign: a.campaign } : {}),
  };
}
