// check:offline - the offline local stack (d5c183b3) serves the app signed in, and
// NOTHING reaches the hosted Supabase project. Needs `npm run dev:offline` on :8081,
// the local stack up (`npx supabase start --workdir local-stack/sb -x edge-runtime`),
// .env.offline.local, and local-stack/.env.local-tre (both gitignored) for the local login.
// Exit 0 pass, 1 finding, 2 could not check.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const readEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const BASE = 'http://localhost:8081';
const PROD = 'mdtosrbfkextcaezuclh.supabase.co';
const login = readEnv('local-stack/.env.local-tre');
const off = readEnv('.env.offline.local');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let local = 0;
let prod = 0;
page.on('request', (r) => {
  if (r.url().includes('127.0.0.1:54321')) local++;
  if (r.url().includes(PROD)) prod++;
});

try {
  const res = await fetch(`${off.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: off.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: login.LOCAL_TRE_EMAIL, password: login.LOCAL_TRE_PASSWORD }),
  });
  const session = await res.json();
  if (!session.access_token) throw new Error(`local sign-in returned ${res.status}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const ref = new URL(off.VITE_SUPABASE_URL).hostname.split('.')[0];
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [`sb-${ref}-auth-token`, session]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/offline-dashboard.png' });
  const onAuth = new URL(page.url()).pathname.startsWith('/auth');
  console.log(`url=${page.url()} local_requests=${local} prod_requests=${prod}`);
  const ok = !onAuth && local > 0 && prod === 0;
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`COULD NOT CHECK: ${String(e.message).split('\n')[0]} (local=${local} prod=${prod})`);
  await browser.close();
  process.exit(2);
}
