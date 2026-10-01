// npm run check:money-glance - calls the DEPLOYED money-glance function (ask 1dc2c388) as the walk
// account (@forgenta.test only) and asserts the contract agreed with Vera (forged-glass Leo):
//   1. no token                -> 401 (the gateway; verify_jwt is on)
//   2. walk account, no row    -> 404 {"missing":"no-snapshot"}
//   3. planted row (own JWT)   -> 200 with EXACTLY 7 keys, the planted numbers, computed_at ending in Z
//   4. the row is deleted again -> 404, so the next run starts clean
// The planted row goes in through PostgREST with the walk account's own JWT, so RLS is exercised on
// the write as well as the read. Cross-user RLS is proven in SQL (see the migration's commit).
// Exit 0 pass, 1 a contract failure, 2 the check could not run.
import { readFileSync } from 'node:fs';

const fail = (code, msg) => { console.error(`FAIL: ${msg}`); process.exit(code); };
const env = readFileSync('.env.local', 'utf8');
let creds;
try { creds = readFileSync('.env.deck-walk.local', 'utf8'); }
catch { fail(2, '.env.deck-walk.local is missing - see scripts/seed-walk-account.sql.'); }
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL');
const anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL');
const password = pick(creds, 'REACH_TEST_PASSWORD');
if (!url || !anon || !email || !password) fail(2, 'missing supabase url/key or walk credentials.');
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);
const userId = session.user?.id;
const auth = { apikey: anon, Authorization: `Bearer ${session.access_token}` };
const FN = `${url}/functions/v1/money-glance`;
const KEYS = ['amount_cents', 'computed_at', 'floor_cents', 'horizon', 'low_date', 'low_point_cents', 'payday'];
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };
const glance = async (headers) => {
  const r = await fetch(FN, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const del = () => fetch(`${url}/rest/v1/safe_to_spend_snapshot?user_id=eq.${userId}`, { method: 'DELETE', headers: auth });

// Start clean: clear any row a crashed earlier run left behind (own DELETE, 20261001g).
await del();
const pre = await glance(auth);

const noTok = await glance({ apikey: anon });
check(noTok.status === 401, `no token -> ${noTok.status} (want 401)`);

if (pre.status === 200) {
  console.log('note: a snapshot row already exists for the walk account; the 404 arm needs it absent.');
}
const missing = pre.status === 404 ? pre : null;
check(!!missing && missing.body?.missing === 'no-snapshot' && Object.keys(missing.body).length === 1,
  `no row -> ${pre.status} ${JSON.stringify(pre.body)} (want 404 {"missing":"no-snapshot"})`);

const planted = {
  user_id: userId, amount_cents: 12345, payday: '2026-10-02', horizon: '2026-10-31',
  low_point_cents: -678, low_date: '2026-10-10', floor_cents: 500, computed_at: '2026-10-01T13:40:00Z',
};
const up = await fetch(`${url}/rest/v1/safe_to_spend_snapshot?on_conflict=user_id`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(planted),
});
if (!up.ok) fail(2, `could not plant the row as the walk account: ${up.status}.`);

const got = await glance(auth);
check(got.status === 200, `planted row -> ${got.status} (want 200)`);
const keys = got.body ? Object.keys(got.body).sort() : [];
check(JSON.stringify(keys) === JSON.stringify(KEYS), `exactly 7 keys: ${keys.join(',')}`);
check(got.body?.amount_cents === 12345 && got.body?.low_point_cents === -678 && got.body?.floor_cents === 500,
  `numbers round-trip (12345, -678, 500): ${got.body?.amount_cents}, ${got.body?.low_point_cents}, ${got.body?.floor_cents}`);
check(got.body?.low_date === '2026-10-10' && got.body?.horizon === '2026-10-31' && got.body?.payday === '2026-10-02', 'dates round-trip');
check(got.body?.computed_at === '2026-10-01T13:40:00.000Z', `computed_at UTC ending in Z: ${got.body?.computed_at}`);

await del();
const after = await glance(auth);
check(after.status === 404, `own DELETE clears it -> ${after.status} (want 404)`);

if (failures.length) { console.error(`\n${failures.length} contract failure(s).`); process.exit(1); }
console.log('\nPASS: money-glance answers the 7-key contract; 401 without a token; 404 with no row.');
