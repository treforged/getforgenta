#!/usr/bin/env node
/**
 * check:cloudflare-serve - does a host serve the web app the way Vercel does? (ask 8a5268d9)
 *
 *   BASE_URL=http://127.0.0.1:8788 npm run check:cloudflare-serve      (wrangler dev)
 *   BASE_URL=https://forgenta-web.<sub>.workers.dev npm run check:cloudflare-serve   (cutover)
 *   BASE_URL=https://getforgenta.com npm run check:cloudflare-serve    (control: today's Vercel)
 *
 * Exit 0 all hold, 1 a finding, 2 could not reach the host. Headers expected are READ from
 * vercel.json, never restated here.
 *
 * ⚠️ The missing-chunk arm is the one that matters: SPA fallback alone answers a missing module
 * with 200 index.html (measured 2026-10-08), which is the 2026-09-24 blank-screen incident.
 * Red-proven by deleting `main` from wrangler.jsonc.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const base = (process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const globalHeaders = vercel.headers.find((r) => r.source === '/(.*)').headers;
const findings = [];
const fail = (m) => findings.push(m);

// ⚠️ node:http, NOT fetch: undici's fetch overwrites Sec-Fetch-Mode with "cors" (measured
// 2026-10-08), so every "navigation" it sent was a cors request and the SPA arm read 404.
function get(path, headers = {}) {
  const url = new URL(base + path);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return v === undefined ? null : String(v); } },
          text: async () => body,
        });
      });
    });
    req.on('error', (e) => {
      console.error(`UNREACHABLE ${url}: ${e.message}`);
      process.exit(2);
    });
    req.end();
  });
}
const NAV = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html' };
const MODULE = { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'script', Origin: base };

// 1. Root: 200 HTML carrying every security header vercel.json sets.
const root = await get('/', NAV);
const html = await root.text();
// No shell at / means nothing below is a measurement (a proxy 403 read as 13 "findings" on
// 2026-10-08), so it is exit 2, not a list of defects.
if (root.status !== 200 || !html.includes('id="root"')) {
  console.error(`check:cloudflare-serve ${base}: / -> ${root.status} with no app shell; NOT MEASURED`);
  process.exit(2);
}
for (const { key, value } of globalHeaders) {
  if (root.headers.get(key) !== value) fail(`/ header ${key} = ${JSON.stringify(root.headers.get(key))}`);
}

// 2. A deep link navigated to: the SPA shell (control for arm 3 - same path family, other mode).
const deep = await get('/dashboard', NAV);
if (deep.status !== 200 || !(await deep.text()).includes('id="root"')) fail(`/dashboard (navigate) -> ${deep.status}, not the shell`);

// 3. A missing chunk requested as a module: must NOT be HTML.
const miss = await get('/assets/check-cloudflare-serve-missing-c2.js', MODULE);
const missType = miss.headers.get('content-type') || '';
if (miss.status === 200 || missType.includes('text/html')) fail(`missing chunk -> ${miss.status} ${missType} (must be a 404, never index.html)`);

// 4. A real chunk: served, immutable. Its name is read from the shell, so no build is assumed.
const chunk = html.match(/\/assets\/[^"']+\.js/)?.[0];
if (!chunk) fail('no /assets/*.js referenced by the shell');
else {
  const c = await get(chunk, MODULE);
  if (c.status !== 200 || !/javascript/.test(c.headers.get('content-type') || '')) fail(`${chunk} -> ${c.status} ${c.headers.get('content-type')}`);
  if (!(c.headers.get('cache-control') || '').includes('immutable')) fail(`${chunk} cache-control ${c.headers.get('cache-control')}`);
}

// 5. Universal links need the AASA as JSON.
const aasa = await get('/.well-known/apple-app-site-association');
if (aasa.status !== 200 || !(aasa.headers.get('content-type') || '').includes('application/json')) {
  fail(`AASA -> ${aasa.status} ${aasa.headers.get('content-type')}`);
}

// 6. A static SEO page is served as itself, not as the SPA shell.
const seo = await get('/best-budget-app/', NAV);
const seoText = await seo.text();
if (seo.status !== 200 || seoText === html) fail(`/best-budget-app/ -> ${seo.status}${seoText === html ? ', the SPA shell instead of its page' : ''}`);

console.log(`check:cloudflare-serve ${base}: ${findings.length ? 'FAIL' : 'PASS'} (6 arms)`);
for (const f of findings) console.log(`  - ${f}`);
process.exit(findings.length ? 1 : 0);
