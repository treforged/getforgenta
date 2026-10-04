/**
 * Backend health: WHY Forgenta cannot reach its back end, in words a user can act on.
 *
 * ⚠️ WHY THIS EXISTS. On 2026-10-04 from ~19:00Z every request carrying the publishable key to
 * `<project>.supabase.co/auth/v1` HUNG — no response, no error — while status.supabase.com
 * reported "Intermittent latency in Eastern US" against its API Gateway. supabase-js has no
 * timeout, so a hung request never rejects: the app sat on "Authenticating…" for ever and said
 * nothing, and from the outside that is indistinguishable from Forgenta itself being broken.
 * The user deserves the cause, named, and the honest version of "we do not know".
 *
 * This file is the PURE half — no timers it does not own, no globals, no React — so every rule
 * below is a unit test rather than a hope. The store that wires it to `window.fetch` and the
 * status pages lives in `backend-health-store.ts`.
 *
 * THE RULES, each one load-bearing:
 * - ⚠️ A FAILURE IS A REAL REQUEST THAT DID NOT GET AN ANSWER. A network error (fetch rejects),
 *   a 5xx/52x, or a request still pending after `HANG_MS`. A 4xx is NOT a failure: a refused
 *   token or an RLS denial is the back end ANSWERING, and treating it as "down" would raise the
 *   alarm on every expired session.
 * - ⚠️ THE CAUSE CHECK DOES NOT DEPEND ON SUPABASE. It reads the providers' own public
 *   Statuspage summaries directly. Asking Supabase whether Supabase is down is asking the one
 *   party that cannot answer.
 * - ⚠️ A STATUS READ THAT FAILED OR CAME BACK MALFORMED IS "UNKNOWN", NEVER AN INCIDENT. An
 *   unreadable status page is not evidence of an outage, and blaming a provider on no evidence
 *   is the confident-wrong answer this whole feature exists to avoid.
 * - ⚠️ OFFLINE IS DETECTED LOCALLY: `navigator.onLine === false`, or EVERY status host also
 *   failed — the device reaches nothing, so "our servers are down" would be the wrong sentence.
 */

export type ProviderId = 'supabase' | 'cloudflare' | 'vercel' | 'plaid';
export type Indicator = 'none' | 'minor' | 'major' | 'critical';

export interface StatusIncident {
  name: string;
  impact: string;
  components: string[];
}

/** One provider's status page, read. `ok: false` covers every way the read can fail. */
export type StatusRead =
  | { ok: true; indicator: Indicator; description: string; incidents: StatusIncident[] }
  | { ok: false };

export type ProviderStatuses = Partial<Record<ProviderId, StatusRead>>;

/**
 * The four public Statuspage summaries. Measured 2026-10-04: all four answer 200 with
 * `Access-Control-Allow-Origin: *`, so the browser and the WKWebView can read them directly.
 * ⚠️ PRODUCTION'S CSP MUST LIST EVERY HOST HERE in `connect-src` (vercel.json) or the read is
 * blocked on getforgenta.com — and therefore on the phone, which loads that origin. The dev
 * server sends no CSP, so a localhost walk cannot see that failure;
 * `backend-health.test.ts` asserts the two lists agree.
 */
export const STATUS_SOURCES: Record<ProviderId, { url: string; name: string; role: string }> = {
  supabase: { url: 'https://status.supabase.com/api/v2/summary.json', name: 'Supabase', role: 'our database provider' },
  cloudflare: { url: 'https://www.cloudflarestatus.com/api/v2/summary.json', name: 'Cloudflare', role: 'our network provider' },
  vercel: { url: 'https://www.vercel-status.com/api/v2/summary.json', name: 'Vercel', role: 'our hosting provider' },
  plaid: { url: 'https://status.plaid.com/api/v2/summary.json', name: 'Plaid', role: 'our bank-connection provider' },
};

/** How long a request may stay unanswered before it counts as failed. */
export const HANG_MS = 10_000;

const INDICATORS: readonly Indicator[] = ['none', 'minor', 'major', 'critical'];
const SEVERITY: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };
/** Statuspage incident states that mean the incident is over. A finished incident names nothing. */
const CLOSED_INCIDENT = new Set(['resolved', 'postmortem', 'completed']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate a Statuspage `summary.json`. Anything that is not the documented shape is `ok: false`.
 *
 * `incidents` is OPTIONAL on purpose: Plaid's page (incident.io, Statuspage-compatible) omits the
 * key entirely when nothing is open — measured 2026-10-04 — and that is a clean read, not a broken
 * one. Present-but-not-an-array is broken. A single malformed incident is dropped rather than
 * failing the read, because the page-level indicator is still trustworthy.
 */
export function parseStatusSummary(json: unknown): StatusRead {
  if (!isRecord(json) || !isRecord(json.status)) return { ok: false };
  const indicator = json.status.indicator;
  if (typeof indicator !== 'string' || !INDICATORS.includes(indicator as Indicator)) return { ok: false };
  const description = typeof json.status.description === 'string' ? json.status.description : '';
  if (json.incidents !== undefined && !Array.isArray(json.incidents)) return { ok: false };
  const incidents: StatusIncident[] = [];
  for (const raw of (json.incidents as unknown[] | undefined) ?? []) {
    if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.trim() === '') continue;
    if (typeof raw.status === 'string' && CLOSED_INCIDENT.has(raw.status)) continue;
    const components = Array.isArray(raw.components)
      ? raw.components.flatMap(c => (isRecord(c) && typeof c.name === 'string' ? [c.name] : []))
      : [];
    incidents.push({ name: raw.name.trim(), impact: typeof raw.impact === 'string' ? raw.impact : 'none', components });
  }
  return { ok: true, indicator: indicator as Indicator, description, incidents };
}

// ── Request outcomes ────────────────────────────────────────────────────────────────────────

/**
 * `supabase` is the back end the app needs to work at all. `bank` is the bank-sync edge
 * functions, whose failure is usually PLAID's, and which must never claim Forgenta itself is
 * unreachable.
 */
export type RequestTarget = 'supabase' | 'bank';
export type FailureReason = 'network' | 'server' | 'timeout';
export type RequestOutcome =
  | { target: RequestTarget; ok: true }
  | { target: RequestTarget; ok: false; reason: FailureReason };

/**
 * Which kind of request a Supabase path is, and whether a long wait means it is stuck.
 *
 * ⚠️ EDGE FUNCTIONS ARE NOT WATCHED FOR HANGS. `plaid-sync` and `financial-sync` legitimately
 * run longer than ten seconds — they page through a bank's transactions — so a timer there
 * would accuse a working sync. A function still FAILS on a network error or a 5xx.
 * ⚠️ `financial-sync` IS BANK SYNC TOO. It is the provider-generic sync the app calls most
 * (useFinancialConnections), and it reaches Plaid through the same shared handler as
 * `plaid-sync`; matching only `plaid-*` would miss the request that actually syncs.
 */
export function classifyPath(pathname: string): { target: RequestTarget; watchHang: boolean } {
  const fn = /^\/functions\/v1\/([^/?#]+)/.exec(pathname);
  if (!fn) return { target: 'supabase', watchHang: true };
  const name = fn[1];
  return { target: name.startsWith('plaid') || name === 'financial-sync' ? 'bank' : 'supabase', watchHang: false };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A request the CALLER cancelled is not the back end failing. React Query cancels routinely. */
function wasAborted(err: unknown, input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.signal?.aborted) return true;
  if (typeof Request !== 'undefined' && input instanceof Request && input.signal?.aborted) return true;
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Wrap `fetch` so every request to the Supabase origin reports its outcome. Requests to any
 * other origin pass straight through, untouched and unobserved.
 *
 * ⚠️ IT NEVER ABORTS AND NEVER ALTERS THE USER'S REQUEST. The hang timer only OBSERVES: a slow
 * request that eventually answers still delivers its answer, and that answer clears the notice.
 * Cancelling it to "fail fast" would turn a slow-but-working network into a broken one.
 *
 * ⚠️ IT WRAPS `window.fetch`, NOT ONLY supabase-js's `global.fetch`. The bank-sync calls
 * (PlaidLinkButton, useFinancialConnections, PlaidOAuth) use raw `fetch` against
 * `/functions/v1`, so a client-only wrapper could never see a Plaid failure. supabase-js
 * resolves the global `fetch` at call time, so it is observed by the same wrapper.
 */
export function createHealthFetch(opts: {
  baseFetch: typeof fetch;
  origin: string;
  report: (o: RequestOutcome) => void;
  hangMs?: number;
}): typeof fetch {
  const { baseFetch, origin, report, hangMs = HANG_MS } = opts;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL;
    try { url = new URL(requestUrl(input)); } catch { return baseFetch(input, init); }
    if (url.origin !== origin) return baseFetch(input, init);

    const { target, watchHang } = classifyPath(url.pathname);
    let settled = false;
    const timer = watchHang
      ? setTimeout(() => { if (!settled) report({ target, ok: false, reason: 'timeout' }); }, hangMs)
      : undefined;
    try {
      const res = await baseFetch(input, init);
      settled = true;
      clearTimeout(timer);
      // 5xx covers Cloudflare's 52x too. Anything below 500 — including 401 and 404 — is the
      // back end answering, which is exactly what "reachable" means.
      report(res.status >= 500 ? { target, ok: false, reason: 'server' } : { target, ok: true });
      return res;
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      if (!wasAborted(err, input, init)) report({ target, ok: false, reason: 'network' });
      throw err;
    }
  };
}

// ── Diagnosis ──────────────────────────────────────────────────────────────────────────────

export type DiagnosisKind = 'offline' | 'provider' | 'unknown' | 'plaid';

export interface Diagnosis {
  kind: DiagnosisKind;
  provider?: ProviderId;
  headline: string;
  detail: string;
}

export interface DiagnoseInput {
  online: boolean;
  statuses: ProviderStatuses;
  failure: { supabase: boolean; bank: boolean };
}

export const OFFLINE_HEADLINE = "You're offline";
export const UNKNOWN_HEADLINE = "Forgenta can't reach its servers right now.";

/**
 * The provider's active report, or null when it is not reporting at least `minSeverity`.
 * The incident named is the most severe open one; with none open, the page's own description.
 */
function activeReport(read: StatusRead | undefined, minSeverity: Indicator): string | null {
  if (!read?.ok || SEVERITY[read.indicator] < SEVERITY[minSeverity]) return null;
  const worst = [...read.incidents].sort((a, b) => (SEVERITY[b.impact] ?? 0) - (SEVERITY[a.impact] ?? 0))[0];
  return worst?.name ?? (read.description || 'a service problem');
}

function providerDiagnosis(id: ProviderId, what: string): Diagnosis {
  const { name, role } = STATUS_SOURCES[id];
  return {
    kind: 'provider',
    provider: id,
    // ⚠️ "REPORTS A PROBLEM", NEVER "IS HAVING AN OUTAGE". A status page proves the provider has an
    // open incident, not that the incident is what stopped THIS request. On 2026-10-04 the banner
    // blamed Supabase's regional latency incident while our own database was I/O-starved: their
    // gateway answered a garbage key in 0.1 s, and only our valid key hung.
    headline: `${name}, ${role}, reports a problem: ${what}`,
    detail: "Forgenta can't reach its servers right now, and this may be why. Nothing has been lost, and this clears the moment a request gets through.",
  };
}

/**
 * What to tell the user, or `null` for nothing at all.
 *
 * ⚠️ NO FAILURE, NO NOTICE — except offline. A provider incident on its own says nothing about
 * THIS user's requests (Cloudflare carries some minor incident most days), so a status page alone
 * never raises the banner. Offline is the one exception: the device saying it has no network is a
 * fact, and while offline React Query pauses its queries, so waiting for a failed request would
 * mean never saying it.
 *
 * ⚠️ CLOUDFLARE AND VERCEL ARE NAMED ONLY AT `major` OR WORSE. Measured 2026-10-04: Cloudflare's
 * indicator read `minor` with three open incidents — Workers Builds, WARP geolocation, Cloudflare
 * One — none of which touch this app. At `minor` the banner would have blamed "Issues with Workers
 * Build failing to start" for a Supabase hang, which is guessing with extra steps. Below `major`
 * the honest sentence is the generic one. Supabase is our own back end, so ANY non-`none`
 * indicator from it is named, and it is named first.
 */
export function diagnose({ online, statuses, failure }: DiagnoseInput): Diagnosis | null {
  if (!online) {
    return {
      kind: 'offline',
      headline: OFFLINE_HEADLINE,
      detail: 'Your device has no internet connection. Forgenta picks up on its own as soon as it is back.',
    };
  }

  if (failure.supabase) {
    const ids = Object.keys(STATUS_SOURCES) as ProviderId[];
    // Every status host also failed: the device reaches nothing, whatever navigator.onLine says.
    if (ids.every(id => statuses[id] && !statuses[id]!.ok)) {
      return {
        kind: 'offline',
        headline: OFFLINE_HEADLINE,
        detail: "Your device isn't reaching the internet. Forgenta picks up on its own as soon as it does.",
      };
    }
    const supabase = activeReport(statuses.supabase, 'minor');
    if (supabase) return providerDiagnosis('supabase', supabase);
    const cloudflare = activeReport(statuses.cloudflare, 'major');
    if (cloudflare) return providerDiagnosis('cloudflare', cloudflare);
    const vercel = activeReport(statuses.vercel, 'major');
    if (vercel) return providerDiagnosis('vercel', vercel);
    // ⚠️ "None report a problem" is a claim about four pages, so it needs all four READ and clean.
    // Before the reads land, or with any page unreadable, saying it would be the confident-wrong
    // answer: measured live 2026-10-04, it showed for ~2 s while Supabase was reporting the incident.
    const allReadClean = ids.every(id => statuses[id]?.ok);
    const anyUnread = ids.some(id => statuses[id] === undefined);
    const why = allReadClean
      ? 'None of our providers report a problem.'
      : anyUnread
        ? 'Checking whether one of our providers reports a problem.'
        : "We couldn't read every provider's status page, so the cause is not confirmed.";
    return {
      kind: 'unknown',
      headline: UNKNOWN_HEADLINE,
      detail: `${why} Nothing has been lost, and this clears the moment a request gets through.`,
    };
  }

  if (failure.bank) {
    const plaid = activeReport(statuses.plaid, 'minor');
    if (plaid) {
      return {
        kind: 'plaid',
        provider: 'plaid',
        headline: `Bank sync is delayed: Plaid reports ${plaid}`,
        detail: 'Your accounts update once Plaid recovers. Everything else in Forgenta works as normal.',
      };
    }
  }
  return null;
}
