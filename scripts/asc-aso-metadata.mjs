#!/usr/bin/env node
/**
 * App Store listing NAME + KEYWORDS (ask b0b54c92, Tre approved 10-07 "6. approved";
 * proposal docs/aso-proposal-2026-10-07.md). Runs in CI only: the App Store Connect key lives in
 * GitHub secrets, never on a desk machine.
 *
 *   node scripts/asc-aso-metadata.mjs            READ: prints the current en-US name, subtitle and
 *                                                keywords, and which version/app-info is editable.
 *   APPLY=1 node scripts/asc-aso-metadata.mjs    sets the name on the EDITABLE app info and the
 *                                                keywords on the EDITABLE iOS version, then reads both back.
 *
 *   CREATE_VERSION=6.8.2 APPLY=1 ...             when NO iOS version is open, first creates that version
 *                                                (Prepare for Submission; Sam 10-07, reversible: an
 *                                                unsubmitted version can be deleted), then applies.
 *
 * It never submits anything: the change ships with the next iOS version Tre submits. If no
 * editable version exists (and CREATE_VERSION is unset) it says so and exits 3.
 * Undo a created version: App Store Connect > the version > Delete Version (only before submission).
 * Exits: 0 ok (a READ with nothing open is 0 + a notice) . 1 a write or read-back failed . 2 could not read . 3 APPLY with nothing open.
 * Undo: rerun with NAME/KEYWORDS set to the old values printed by the READ.
 */
import { createSign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com';
const BUNDLE = 'com.treforged.forged';
const LOCALE = 'en-US';
const NAME = process.env.NAME || 'Forgenta: Budget Planner';
const KEYWORDS = process.env.KEYWORDS
  || 'budgeting,paycheck,payday,bills,tracker,debt,forecast,expense,money,cash,calendar,savings,simple';
const APPLY = process.env.APPLY === '1';
const CREATE_VERSION = (process.env.CREATE_VERSION || '').trim();

const die = (code, msg) => { console.error(`FAILED: ${msg}`); process.exit(code); };
if (NAME.length > 30) die(2, `name is ${NAME.length} chars; Apple allows 30.`);
if (KEYWORDS.length > 100) die(2, `keywords are ${KEYWORDS.length} chars; Apple allows 100.`);
if (CREATE_VERSION && !/^\d+\.\d+(\.\d+)?$/.test(CREATE_VERSION)) die(2, `CREATE_VERSION "${CREATE_VERSION}" is not like 6.8.2.`);
if (CREATE_VERSION && !APPLY) die(2, 'CREATE_VERSION needs APPLY=1: a READ never writes.');

const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
const issuerId = process.env.APP_STORE_CONNECT_API_ISSUER_ID;
const raw = process.env.APP_STORE_CONNECT_API_KEY_CONTENT;
if (!keyId || !issuerId || !raw) die(2, 'App Store Connect key secrets are missing.');
// The secret is the BASE64 of the .p8 (ios-build.yml decodes it the same way); accept raw PEM too.
const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
if (!pem.includes('BEGIN PRIVATE KEY')) die(2, 'key content did not decode to a PEM private key.');

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }))}`;
  const s = createSign('SHA256'); s.update(input); s.end();
  // ieee-p1363 is load-bearing: a DER signature is a flat 401 (see app-store-revenue.mjs).
  return `${input}.${b64u(s.sign({ key: pem, dsaEncoding: 'ieee-p1363' }))}`;
}
async function asc(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* raw */ }
  if (!res.ok) {
    const errs = (json?.errors ?? []).map((e) => `[${e.status} ${e.code}] ${e.title}${e.detail ? ` - ${e.detail}` : ''}`).join('; ');
    return { ok: false, status: res.status, error: errs || text.slice(0, 300) };
  }
  return { ok: true, json };
}

const apps = await asc('GET', `/v1/apps?filter[bundleId]=${BUNDLE}`);
if (!apps.ok) die(2, `apps read ${apps.status}: ${apps.error}`);
const app = apps.json.data[0];
if (!app) die(2, `no app with bundle ${BUNDLE}.`);
console.log(`app ${app.id} ${app.attributes.name}`);

// App info: the one NOT live is editable (Apple keeps a live and, while a version is open, an editable one).
let infos = await asc('GET', `/v1/apps/${app.id}/appInfos`);
if (!infos.ok) die(2, `appInfos read ${infos.status}: ${infos.error}`);
const LIVE = new Set(['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO']);
for (const i of infos.json.data) console.log(`appInfo ${i.id} state=${i.attributes.state ?? i.attributes.appStoreState}`);
let editInfo = infos.json.data.find((i) => !LIVE.has(i.attributes.state ?? i.attributes.appStoreState));

let vers = await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`);
if (!vers.ok) die(2, `versions read ${vers.status}: ${vers.error}`);
const EDITABLE = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);
for (const v of vers.json.data.slice(0, 4)) console.log(`version ${v.attributes.versionString} state=${v.attributes.appVersionState ?? v.attributes.appStoreState}`);
let editVer = vers.json.data.find((v) => EDITABLE.has(v.attributes.appVersionState ?? v.attributes.appStoreState));

async function infoLoc(infoId) {
  const r = await asc('GET', `/v1/appInfos/${infoId}/appInfoLocalizations`);
  return r.ok ? r.json.data.find((l) => l.attributes.locale === LOCALE) : null;
}
async function verLoc(verId) {
  const r = await asc('GET', `/v1/appStoreVersions/${verId}/appStoreVersionLocalizations`);
  return r.ok ? r.json.data.find((l) => l.attributes.locale === LOCALE) : null;
}
const liveInfo = infos.json.data.find((i) => LIVE.has(i.attributes.state ?? i.attributes.appStoreState));
const liveLoc = liveInfo ? await infoLoc(liveInfo.id) : null;
console.log(`LIVE name="${liveLoc?.attributes.name}" subtitle="${liveLoc?.attributes.subtitle}"`);
const liveVer = vers.json.data.find((v) => (v.attributes.appVersionState ?? v.attributes.appStoreState) === 'READY_FOR_DISTRIBUTION' || v.attributes.appStoreState === 'READY_FOR_SALE');
const liveVLoc = liveVer ? await verLoc(liveVer.id) : null;
console.log(`LIVE keywords="${liveVLoc?.attributes.keywords}"`);

if (!editVer && CREATE_VERSION) {
  if (vers.json.data.some((v) => v.attributes.versionString === CREATE_VERSION)) die(1, `version ${CREATE_VERSION} already exists and is not editable.`);
  const c = await asc('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions',
    attributes: { platform: 'IOS', versionString: CREATE_VERSION },
    relationships: { app: { data: { type: 'apps', id: app.id } } } } });
  if (!c.ok) die(1, `version create ${c.status}: ${c.error}`);
  console.log(`CREATED iOS version ${CREATE_VERSION} id=${c.json.data.id} state=${c.json.data.attributes.appVersionState ?? c.json.data.attributes.appStoreState}`);
  // Re-read: Apple opens an editable app info alongside the new version.
  infos = await asc('GET', `/v1/apps/${app.id}/appInfos`);
  vers = await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`);
  if (!infos.ok || !vers.ok) die(1, 'could not re-read after creating the version.');
  editInfo = infos.json.data.find((i) => !LIVE.has(i.attributes.state ?? i.attributes.appStoreState));
  editVer = vers.json.data.find((v) => EDITABLE.has(v.attributes.appVersionState ?? v.attributes.appStoreState));
  if (editVer?.attributes.versionString !== CREATE_VERSION) die(1, `after create, the editable version is ${editVer?.attributes.versionString ?? 'none'}, not ${CREATE_VERSION}.`);
}
if (!editInfo || !editVer) {
  console.log(`editable app info: ${editInfo?.id ?? 'none'} . editable iOS version: ${editVer?.attributes.versionString ?? 'none'}`);
  const msg = 'no iOS version in Prepare for Submission - nothing to apply. The name and keywords change only on an open version.';
  // A READ that finds nothing open is a correct no-op, not a failure (Sam 10-07: it showed red every time).
  // An APPLY that finds nothing open stays red: the requested change did not happen.
  if (!APPLY) { console.log(`::notice::${msg}`); process.exit(0); }
  die(3, msg);
}
const eLoc = await infoLoc(editInfo.id);
const vLoc = await verLoc(editVer.id);
console.log(`EDITABLE (version ${editVer.attributes.versionString}) name="${eLoc?.attributes.name}" keywords="${vLoc?.attributes.keywords}"`);
if (!eLoc || !vLoc) die(2, `no ${LOCALE} localization on the editable app info or version.`);
if (!APPLY) { console.log(`READ ONLY. APPLY=1 would set name="${NAME}" and keywords="${KEYWORDS}".`); process.exit(0); }

const p1 = await asc('PATCH', `/v1/appInfoLocalizations/${eLoc.id}`, { data: { type: 'appInfoLocalizations', id: eLoc.id, attributes: { name: NAME } } });
if (!p1.ok) die(1, `name PATCH ${p1.status}: ${p1.error}`);
const p2 = await asc('PATCH', `/v1/appStoreVersionLocalizations/${vLoc.id}`, { data: { type: 'appStoreVersionLocalizations', id: vLoc.id, attributes: { keywords: KEYWORDS } } });
if (!p2.ok) die(1, `keywords PATCH ${p2.status}: ${p2.error}`);
const back1 = await infoLoc(editInfo.id); const back2 = await verLoc(editVer.id);
console.log(`READ BACK name="${back1?.attributes.name}" keywords="${back2?.attributes.keywords}"`);
if (back1?.attributes.name !== NAME || back2?.attributes.keywords !== KEYWORDS) die(1, 'read-back does not match what was written.');
console.log(`OK: version ${editVer.attributes.versionString} carries the new name and keywords. Undo: rerun with the LIVE values above.`);
