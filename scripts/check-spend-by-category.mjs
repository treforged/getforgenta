// npm run check:spend-by-category - calls the DEPLOYED spend-by-category function (ask fbc5671a, Leo's
// "how much did I spend on food") as the walk account (@forgenta.test only) and asserts the contract
// agreed with Vera (forged-glass Leo):
//   1. no token               -> 401 (the gateway; verify_jwt is on)
//   2. ?month=2026-13         -> 400 {"error":"bad-month"}
//   3. ?month=2026-10         -> 200 with EXACTLY 3 keys {month, categories, computed_at}; month echoes,
//                                categories is an array of {name, spent_cents} (integer > 0), sorted
//                                largest first; computed_at ends in Z
//   4. no month               -> 200 with the current UTC month
// The walk account has no bank link, so its list is usually empty; the NUMBERS are owned by
// src/lib/__tests__/spend-by-category.test.ts. Writes nothing. Exit 0 pass, 1 contract failure, 2 could not run.
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
const auth = { apikey: anon, Authorization: `Bearer ${session.access_token}` };
const FN = `${url}/functions/v1/spend-by-category`;
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };
const call = async (qs, headers) => {
  const r = await fetch(FN + qs, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const shapeOk = (b, month) => {
  if (!b || typeof b !== 'object') return 'no body';
  const keys = Object.keys(b).sort().join(',');
  if (keys !== 'categories,computed_at,month') return `keys ${keys}`;
  if (b.month !== month) return `month ${b.month}`;
  if (!/Z$/.test(b.computed_at) || Number.isNaN(Date.parse(b.computed_at))) return `computed_at ${b.computed_at}`;
  if (!Array.isArray(b.categories)) return 'categories not an array';
  for (const [i, c] of b.categories.entries()) {
    if (Object.keys(c).sort().join(',') !== 'name,spent_cents') return `category ${i} keys`;
    if (typeof c.name !== 'string' || !/^[A-Z0-9_]+$/.test(c.name)) return `category ${i} name`;
    if (!Number.isInteger(c.spent_cents) || c.spent_cents <= 0) return `category ${i} spent_cents`;
    if (i > 0 && b.categories[i - 1].spent_cents < c.spent_cents) return 'not sorted';
  }
  return null;
};

const none = await call('', { apikey: anon });
check(none.status === 401, `no token -> 401 (got ${none.status})`);
const bad = await call('?month=2026-13', auth);
check(bad.status === 400 && bad.body?.error === 'bad-month', `bad month -> 400 bad-month (got ${bad.status} ${JSON.stringify(bad.body)})`);
const oct = await call('?month=2026-10', auth);
const octErr = shapeOk(oct.body, '2026-10');
check(oct.status === 200 && !octErr, `month=2026-10 -> 200, 3-key contract (got ${oct.status}${octErr ? ', ' + octErr : ''}; ${oct.body?.categories?.length ?? '?'} categories)`);
const cur = new Date().toISOString().slice(0, 7);
const dflt = await call('', auth);
const dErr = shapeOk(dflt.body, cur);
check(dflt.status === 200 && !dErr, `no month -> 200 for ${cur} (got ${dflt.status}${dErr ? ', ' + dErr : ''})`);

if (failures.length) { console.error(`\n${failures.length} contract failure(s).`); process.exit(1); }
console.log('\nPASS spend-by-category contract (4 checks).');
