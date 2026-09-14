#!/usr/bin/env node
// Reads REAL App Store proceeds from Apple, so nobody has to ask Tre to sign in and read a number
// off his screen.
//
// Tre, 2026-09-12: "i did it and it spoke. at this point you should [be] testing for me." The
// charter rule that follows from it is that the desk MEASURES things; handing him a verification
// step is handing him the work. This is that rule applied to revenue.
//
// ⚠️ A ZERO AND A REFUSAL MUST NEVER LOOK THE SAME, and that is the whole design of this file.
// "$0.00 proceeds" is a fact about a slow week. "$0.00 proceeds" printed because the API key lacks
// the Sales role, or because nobody supplied a vendor number, is a LIE that reads like a fact — and
// it is the kind of lie a dashboard repeats for months. So every failure path below exits NON-ZERO
// and names which of the four distinct causes it hit, using Apple's own error text where there is
// one. Only a genuine, authorised, parsed report can print a figure.
//
// ⚠️ THE KEY IS NEVER PRINTED, NEVER LOGGED, AND NEVER WRITTEN TO DISK. It is decoded into memory,
// used to sign, and dropped. The JWT itself is also never logged — it is a bearer credential for
// ten minutes, and CI logs are retained far longer than that.
//
// Usage (locally or in CI); all three key values come from the environment, never from argv,
// because argv is visible in the process table to every other process on the machine:
//   APP_STORE_CONNECT_API_KEY_ID=... APP_STORE_CONNECT_API_ISSUER_ID=... \
//   APP_STORE_CONNECT_API_KEY_CONTENT=<base64 of the .p8> \
//   APP_STORE_VENDOR_NUMBER=...  node scripts/app-store-revenue.mjs [--date YYYY-MM-DD]

import { createSign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const API = 'https://api.appstoreconnect.apple.com';

/** Exit codes, so a caller can tell the causes apart without parsing prose. */
const EXIT = {
  OK: 0,
  MISSING_INPUT: 2,
  AUTH_FAILED: 3,
  NOT_AUTHORISED: 4,
  NO_REPORT: 5,
  UNPARSEABLE: 6,
};

function die(code, headline, detail) {
  // stderr, not stdout: a caller piping stdout for the figure must never receive an error as data.
  console.error(`\nFAILED (${headline})`);
  if (detail) console.error(detail);
  process.exit(code);
}

/**
 * base64url without padding. `Buffer.toString('base64url')` does this natively on modern Node, but
 * it is spelled out because a padded or `+`/`/`-bearing segment produces a token Apple rejects with
 * a generic 401 — which would be diagnosed as "the key is wrong" rather than "the encoder is".
 */
const b64u = buf => Buffer.from(buf).toString('base64url');

function mintJwt({ keyId, issuerId, privateKeyPem }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  // Apple rejects anything over 20 minutes for most endpoints. 10 keeps a wide margin for clock
  // skew on a CI runner while staying short-lived.
  const payload = { iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  // ⚠️ `dsaEncoding: 'ieee-p1363'` IS LOAD-BEARING. Node's default for EC keys is DER, and a
  // DER-encoded signature in a JWS is malformed — JWS requires the raw R||S pair. The failure is a
  // flat 401 with no hint, so without this line the obvious conclusion is that the key or the
  // issuer id is wrong, and somebody spends an afternoon rotating a perfectly good key.
  const sig = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64u(sig)}`;
}

async function call(path, token, accept) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...(accept ? { Accept: accept } : {}) },
  });
  return res;
}

/** Apple returns a JSON error envelope on most failures. Pull its own words out where present. */
async function appleError(res) {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    const errs = Array.isArray(json.errors) ? json.errors : [];
    if (errs.length) {
      return errs.map(e => `  [${e.status} ${e.code}] ${e.title}${e.detail ? ` — ${e.detail}` : ''}`).join('\n');
    }
  } catch {
    /* not JSON; fall through to the raw body */
  }
  return text ? `  ${text.slice(0, 600)}` : '  (no response body)';
}

function env(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

/** The report date Apple will actually have. Sales reports lag, so default to two days back. */
function defaultDate() {
  const d = new Date(Date.now() - 2 * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const dateArg = process.argv.indexOf('--date');
  const reportDate = dateArg > -1 ? process.argv[dateArg + 1] : defaultDate();

  const keyId = env('APP_STORE_CONNECT_API_KEY_ID');
  const issuerId = env('APP_STORE_CONNECT_API_ISSUER_ID');
  const keyContent = env('APP_STORE_CONNECT_API_KEY_CONTENT');
  const vendorNumber = env('APP_STORE_VENDOR_NUMBER');

  const missing = [
    !keyId && 'APP_STORE_CONNECT_API_KEY_ID',
    !issuerId && 'APP_STORE_CONNECT_API_ISSUER_ID',
    !keyContent && 'APP_STORE_CONNECT_API_KEY_CONTENT',
  ].filter(Boolean);
  if (missing.length) {
    die(EXIT.MISSING_INPUT, 'credentials not supplied', `  Absent from the environment: ${missing.join(', ')}`);
  }

  // The secret is stored base64-encoded (the iOS workflow decodes it the same way). Accept a raw
  // PEM too, so a future rotation that stores it unencoded does not fail with a confusing signature
  // error instead of a clear one.
  const privateKeyPem = keyContent.includes('BEGIN')
    ? keyContent
    : Buffer.from(keyContent, 'base64').toString('utf8');
  if (!privateKeyPem.includes('BEGIN')) {
    die(EXIT.MISSING_INPUT, 'the key content is not a PEM', '  After base64-decoding there is no "BEGIN ... PRIVATE KEY" header.');
  }

  let token;
  try {
    token = mintJwt({ keyId, issuerId, privateKeyPem });
  } catch (e) {
    die(EXIT.AUTH_FAILED, 'could not sign the JWT', `  ${e.message}`);
  }

  // ── Probe 1: does this key authenticate AT ALL? ────────────────────────────
  // ⚠️ THIS PROBE EXISTS TO SPLIT ONE FAILURE INTO TWO. Without it, a 401 on the sales endpoint is
  // ambiguous between "the key is bad" and "the key is fine but lacks the Sales role", and those
  // have completely different fixes — rotate a credential, versus change a role in App Store
  // Connect. `/v1/apps` is readable by every key role, so reaching it proves the credential itself.
  const probe = await call('/v1/apps?limit=1', token);
  if (probe.status === 401) {
    die(EXIT.AUTH_FAILED, 'the API key was rejected outright', await appleError(probe));
  }
  if (!probe.ok) {
    die(EXIT.AUTH_FAILED, `unexpected ${probe.status} on the credential probe`, await appleError(probe));
  }
  console.log('credential: OK (authenticated against /v1/apps)');

  if (!vendorNumber) {
    // ⚠️ NOT A ZERO, AND NOT A GUESS. The Sales Reports endpoint REQUIRES a vendor number and there
    // is no App Store Connect API that returns one — it is shown only in the Payments and Financial
    // Reports section of the web UI. So this is a genuine missing input rather than a bug, and it
    // stops here loudly instead of reporting no revenue.
    die(
      EXIT.MISSING_INPUT,
      'no vendor number',
      '  APP_STORE_VENDOR_NUMBER is not set, and Apple requires it on every sales report request.\n' +
        '  There is no API that returns it. It is in App Store Connect under\n' +
        '  Payments and Financial Reports, top-left beside the account name (an 8-10 digit number).\n' +
        '  Add it as a repository secret named APP_STORE_VENDOR_NUMBER and re-run.\n' +
        '  It is NOT a credential -- it identifies the selling entity and grants nothing on its own.',
    );
  }

  // ── The report ─────────────────────────────────────────────────────────────
  const q = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportDate]': reportDate,
    'filter[reportSubType]': 'SUMMARY',
    'filter[reportType]': 'SALES',
    'filter[vendorNumber]': vendorNumber,
  });
  const res = await call(`/v1/salesReports?${q}`, token, 'application/a-gzip');

  if (res.status === 401 || res.status === 403) {
    die(
      EXIT.NOT_AUTHORISED,
      'this key may not read sales',
      `${await appleError(res)}\n` +
        '  The credential itself works (the probe above passed), so this is a ROLE problem.\n' +
        '  An upload-only key cannot read sales. The key needs the "Sales and Reports"\n' +
        '  (or Finance) role in App Store Connect > Users and Access > Integrations.',
    );
  }
  if (res.status === 404) {
    die(
      EXIT.NO_REPORT,
      `no report exists for ${reportDate}`,
      `${await appleError(res)}\n` +
        '  Apple returns 404 when a report was never generated for a date -- which includes dates\n' +
        '  that are too recent, and dates with no activity at all.\n' +
        '  THIS IS NOT THE SAME AS ZERO REVENUE and must never be shown as such.\n' +
        '  Try an earlier --date before concluding anything.',
    );
  }
  if (!res.ok) {
    die(EXIT.NO_REPORT, `unexpected ${res.status} from the sales endpoint`, await appleError(res));
  }

  let tsv;
  try {
    tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  } catch (e) {
    die(EXIT.UNPARSEABLE, 'the report did not decompress', `  ${e.message}`);
  }

  const lines = tsv.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    die(EXIT.UNPARSEABLE, 'the report has a header and no rows', '  Nothing was parsed, so no figure is reported.');
  }

  const header = lines[0].split('\t').map(h => h.trim());
  const idx = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iProceeds = idx('Developer Proceeds');
  const iUnits = idx('Units');
  const iCurrency = idx('Currency of Proceeds');
  if (iProceeds === -1 || iUnits === -1) {
    // ⚠️ A MISSING COLUMN IS A PARSE FAILURE, NEVER A ZERO. Apple has changed this schema before,
    // and a reader that treats an absent column as 0 turns a format change into a revenue crash
    // that nobody can distinguish from a real one.
    die(EXIT.UNPARSEABLE, 'the expected columns are absent', `  Header was:\n  ${header.join(' | ')}`);
  }

  const byCurrency = new Map();
  let units = 0;
  let rows = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const proceeds = Number(cells[iProceeds]);
    const u = Number(cells[iUnits]);
    if (!Number.isFinite(proceeds) || !Number.isFinite(u)) continue;
    const cur = iCurrency > -1 ? (cells[iCurrency] || '?').trim() : '?';
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + proceeds * u);
    units += u;
    rows += 1;
  }

  // The count is printed because "0 rows parsed" and "0.00 proceeds" are different facts, and a
  // reader must be able to tell which one they are looking at.
  console.log(`\nApp Store sales -- ${reportDate} (DAILY SUMMARY)`);
  console.log(`  rows parsed: ${rows} of ${lines.length - 1}`);
  console.log(`  units:       ${units}`);
  if (!byCurrency.size) {
    console.log('  proceeds:    none parsed');
  } else {
    for (const [cur, total] of [...byCurrency].sort()) {
      console.log(`  proceeds:    ${total.toFixed(2)} ${cur}`);
    }
  }
  process.exit(EXIT.OK);
}

main().catch(e => die(EXIT.UNPARSEABLE, 'unexpected error', `  ${e?.stack ?? e}`));
