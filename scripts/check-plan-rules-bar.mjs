#!/usr/bin/env node
/**
 * check-plan-rules-bar.mjs - the Plan panel's rule selector, at 390x844, signed in.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-18 (ask bb517b7b): "like all the other tabs, make all the sections in the
 * selector bar visible at once. reduce to easily discernable icons instead of text". Plan was
 * the one selector bar in the app NOT on `PanelBar`: radix `TabsList` in a `grid-cols-3`, so its
 * six text triggers drew as TWO ROWS OF THREE on a phone. It moved onto `PanelBar` on 2026-09-22
 * as icons, each carrying its rule count as a corner badge.
 *
 * WHAT IT ASSERTS, per segment found BY ROLE inside Plan's own tablist (never a hand-typed list):
 *   1. It has a non-empty accessible name. Icon-only removes the visible name, so a segment
 *      without an aria-label is unreadable to a screen reader and a screenshot cannot show it.
 *   2. EVERY segment is inside the track's box and ALL of them share ONE ROW - "visible at once".
 *      A track that scrolls hides segments offscreen; a wrapping grid is the two-row defect.
 *   3. Its badge shows the same count its accessible name states, and sits inside the segment.
 *   4. Pressing it moves `aria-selected` to it, the panel body CHANGES, and the body carries that
 *      section's own heading and none of the others'. A press that throws nothing and does
 *      nothing is the dead-tab defect forged-glass shipped; the assertion is the CHANGE.
 *
 * POSITIVE CONTROL: the page must hold exactly TWO tablists - Transactions' own panel bar and
 * Plan's. Plan's is the LAST one. Fewer means Plan did not mount, and every absence below would
 * be the absence of the whole panel rather than a finding.
 *
 * DOES NOT COVER: desktop widths, colour or contrast of the badge, whether an icon is the RIGHT
 * icon (a taste call), and anything inside a section beyond its heading.
 *
 * EXITS: 0 pass . 1 a real finding . 2 could not test
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
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

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const done = async (code, msg) => { await browser.close(); fail(code, msg); };
// 390 by default; PLAN_BAR_WIDTH=375 / 360 checks the smaller phones the fit has to survive.
const WIDTH = Number(process.env.PLAN_BAR_WIDTH || 390);
console.log(`viewport ${WIDTH}x844`);
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: 844 } })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => {
  localStorage.setItem(k, JSON.stringify(s));
  localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  }));
}, [`sb-${ref}-auth-token`, session]);
// `/budget` redirects to /transactions naming the Plan panel.
await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const still = page.locator(OVERLAY);
  if (await still.count()) { await still.first().dispatchEvent('click'); await page.waitForTimeout(600); }
}
if (await page.locator(OVERLAY).count()) await done(2, 'a modal overlay is still up; it would intercept every press.');

const lists = page.locator('[role="tablist"]');
const nLists = await lists.count();
if (nLists !== 2) await done(2, `expected 2 tablists (Transactions' panel bar + Plan's), found ${nLists} - Plan did not mount, so nothing below would mean anything.`);
const bar = lists.nth(1);
const tabs = bar.getByRole('tab');
const count = await tabs.count();
console.log(`Plan rule bar: ${count} segment(s) found by role`);
if (count < 2) await done(1, `Plan's rule bar has ${count} segment(s).`);

// 2 - visible at once, on one row.
const geo = await bar.evaluate((el) => {
  const t = el.getBoundingClientRect();
  const segs = [...el.querySelectorAll('[role="tab"]')].map((s) => {
    const r = s.getBoundingClientRect();
    return { left: r.left, right: r.right, top: Math.round(r.top) };
  });
  // ⚠️ THE TRACK SIZES TO ITS OWN CONTENT (measured 316px at 390, 375 AND 360), so
  // scrollWidth == clientWidth holds BY CONSTRUCTION and proves nothing about fitting. What
  // matters is that the track fits inside its PANEL and the viewport, so that is asserted too.
  const p = el.parentElement.getBoundingClientRect();
  return { track: { left: t.left, right: t.right }, panel: { left: p.left, right: p.right }, vw: window.innerWidth, scroll: el.scrollWidth, client: el.clientWidth, segs };
});
const outside = geo.segs.filter((s) => s.left < geo.track.left - 0.5 || s.right > geo.track.right + 0.5).length;
const rows = new Set(geo.segs.map((s) => s.top)).size;
console.log(`  track ${Math.round(geo.track.right - geo.track.left)}px . scrollWidth ${geo.scroll} / clientWidth ${geo.client} . ${outside} outside . ${rows} row(s)`);
if (outside > 0 || geo.scroll > geo.client + 1) await done(1, `${outside} segment(s) sit outside the track (scrollWidth ${geo.scroll} > ${geo.client}) - they are not all visible at once.`);
console.log(`  panel ${Math.round(geo.panel.left)}-${Math.round(geo.panel.right)} . track ${Math.round(geo.track.left)}-${Math.round(geo.track.right)} . viewport ${geo.vw}`);
if (geo.track.left < geo.panel.left - 0.5 || geo.track.right > geo.panel.right + 0.5 || geo.track.right > geo.vw) {
  await done(1, `the rule bar (${Math.round(geo.track.left)}-${Math.round(geo.track.right)}px) does not fit its panel (${Math.round(geo.panel.left)}-${Math.round(geo.panel.right)}px) at ${geo.vw}px.`);
}
if (rows !== 1) await done(1, `the segments sit on ${rows} rows - the two-rows-of-three defect Tre reported.`);

const MARKERS = {
  Income: 'Income Rules', Fixed: 'Fixed Expenses', Subs: 'Subscriptions', Variable: 'Variable Expenses',
  Debt: 'Debt Payments', Transfers: 'Transfers & Investing',
};
/** The Plan panel body: the bar's container, minus the bar. */
const bodyText = () => bar.evaluate((el) => {
  const clone = el.parentElement.cloneNode(true);
  for (const t of clone.querySelectorAll('[role="tablist"]')) t.remove();
  return (clone.innerText || '').replace(/\s+/g, ' ').trim();
});

const seen = [];
for (let i = 0; i < count; i += 1) {
  const tab = tabs.nth(i);
  const name = ((await tab.getAttribute('aria-label')) || (await tab.innerText()) || '').trim();
  if (!name) await done(1, `segment ${i} has NO accessible name.`);
  const key = Object.keys(MARKERS).find((k) => name.startsWith(k));
  if (!key) await done(1, `segment ${JSON.stringify(name)} is not one this check knows a marker for - add it here rather than letting it go unasserted.`);
  // 3 - the badge states the same count as the name, and sits inside the segment.
  const badge = await tab.evaluate((b) => {
    const s = b.querySelector('.seg-badge');
    if (!s) return null;
    const r = s.getBoundingClientRect(); const o = b.getBoundingClientRect();
    return { text: s.textContent.trim(), inside: r.left >= o.left - 0.5 && r.right <= o.right + 0.5 && r.top >= o.top - 0.5 && r.width > 0 };
  });
  const stated = (name.match(/(\d+)\s+rules?$/) || [])[1];
  if (!badge) await done(1, `segment ${JSON.stringify(name)} has no count badge.`);
  if (stated === undefined || badge.text !== stated) await done(1, `segment ${JSON.stringify(name)}: badge reads ${JSON.stringify(badge.text)} but its name states ${stated}.`);
  if (!badge.inside) await done(1, `segment ${JSON.stringify(name)}: its badge spills outside the segment.`);

  await tab.click();
  await page.waitForTimeout(900);
  const selected = await tab.getAttribute('aria-selected');
  const body = await bodyText();
  console.log(`  pressed ${JSON.stringify(name)} . aria-selected=${selected} . badge ${badge.text} . body ${body.length} chars`);
  if (selected !== 'true') await done(1, `pressing ${JSON.stringify(name)} left aria-selected=${selected}.`);
  seen.push({ name, key, body });
}
await page.screenshot({ path: 'plan-rules-bar.png' });
await browser.close();

const failures = [];
for (let i = 0; i < seen.length; i += 1) {
  for (let j = i + 1; j < seen.length; j += 1) {
    if (seen[i].body === seen[j].body) failures.push(`${JSON.stringify(seen[i].name)} and ${JSON.stringify(seen[j].name)} render the IDENTICAL body - one section is unreachable.`);
  }
}
for (const s of seen) {
  if (!s.body.includes(MARKERS[s.key])) failures.push(`section ${JSON.stringify(s.name)} does not show its heading ${JSON.stringify(MARKERS[s.key])}.`);
  for (const [other, marker] of Object.entries(MARKERS)) {
    if (other !== s.key && s.body.includes(marker)) failures.push(`section ${JSON.stringify(s.name)} still shows ${JSON.stringify(marker)}, which belongs to ${other}.`);
  }
}
if (failures.length) { for (const f of failures) console.error(`FAIL: ${f}`); process.exit(1); }
console.log(`PASS - all ${seen.length} Plan rule segments are named, on one row inside the track, carry a badge matching their count, and each switches to its OWN section.`);
