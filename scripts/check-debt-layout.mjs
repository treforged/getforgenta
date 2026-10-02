#!/usr/bin/env node
/**
 * check-debt-layout.mjs - the Debt Payoff (cards) tab's layout, RENDERED, signed in, at 1440x900 and 390x844.
 *
 * Tre, 2026-10-01 (desktop screenshot, ask 63e11072): "a lot of empty space, shared button off placement,
 * organization, unecessary/duplicate info". Each defect he named is one assertion:
 *   - Share sits in the page toolbar beside Reset & Recalculate, NOT inside the Payoff ETA tile;
 *   - utilization is stated ONCE (the second card repeated the same percentage as "Overall Utilization");
 *   - the "Targets ending cash" note and the "Cash floor always enforced" pill are gone (both repeated
 *     what the Cash Floor control already says);
 *   - at 1440 the controls card and the payoff-order card share ONE row (stacked, each left most of the
 *     row empty); at 390 they stack and nothing is wider than the viewport.
 * CONTROLS: "Total CC Balance" must render (right screen, page mounted), and an impossible label must
 * count zero (the matcher can say no).
 * DOES NOT COVER: colour, the Other Debts / Auto / Which Card tabs, the panels below the order list, or
 * whether the figures are right.
 *   The walk account's plan never pays off (no Share by design), so a /demo probe carries the Share check.
 * USAGE: node scripts/check-debt-layout.mjs    EXITS: 0 pass . 1 a layout defect . 2 could not test
 */
import { readFileSync, mkdirSync } from 'node:fs';

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
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

// Settle the first-run dialogs on the WALK account only, exactly as check:account does.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the current release version out of src/lib/whats-new.ts.');
const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${session.user.id}`, { headers: rest });
if (!prof.ok) fail(2, `reading the walk account's profile returned ${prof.status}.`);
const flags = (await prof.json())[0]?.tour_flags ?? {};
const patch = await fetch(`${url}/rest/v1/profiles?user_id=eq.${session.user.id}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});
const patched = await patch.json().catch(() => []);
if (!patch.ok || !Array.isArray(patched) || patched.length === 0) {
  fail(2, `settling the first-run dialogs matched no profile row (HTTP ${patch.status}).`);
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch();
const problems = [];

async function probe(view, tag, demo = false) {
  const ctx = await browser.newContext({ viewport: view });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  if (demo) {
    // Demo mode is in-memory React state, so /debt must be reached by a CLIENT-SIDE click after /demo.
    await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const link = page.locator('a[href="/debt"]:visible').first();
    if (!(await link.count())) { await browser.close(); fail(2, `[${tag}] CONTROL FAILED: no visible /debt link in demo.`); }
    await link.click();
  } else {
    await page.goto(`${BASE}/debt`, { waitUntil: 'domcontentloaded' });
  }
  try { await page.getByText('Total CC Balance').first().waitFor({ state: 'visible', timeout: 30000 }); }
  catch { await browser.close(); fail(2, `[${tag}] CONTROL FAILED: "Total CC Balance" never rendered on /debt.`); }
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6 && (await page.locator('div.backdrop-blur-sm, div.modal-overlay').count()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const r = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('p, span, div, h2, h3, label, button')]
      .filter(el => el.children.length === 0 && el.getClientRects().length > 0);
    const texts = leaves.map(el => (el.textContent || '').trim());
    const count = re => texts.filter(t => re.test(t)).length;
    const share = document.querySelector('[data-testid="share-debt-free"]');
    const toolbar = document.querySelector('[data-testid="debt-toolbar"]');
    const box = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right) }; };
    const head = re => [...document.querySelectorAll('h3, span')].find(el => re.test((el.textContent || '').trim()));
    const cardOf = el => el && el.closest('.card-forged');
    const controls = cardOf(head(/^strategy:?$/i));
    const order = cardOf(head(/^(avalanche|snowball) order$/i));
    return {
      impossible: count(/^zzz-not-a-real-label$/i),
      utilizationLabels: count(/utilization$/i),
      targetsNote: count(/targets ending cash/i),
      alwaysPill: count(/^cash floor always enforced$/i),
      shareInToolbar: !!(share && toolbar && toolbar.contains(share)),
      shareCount: document.querySelectorAll('[data-testid="share-debt-free"]').length,
      neverPaysOff: count(/^not within \d+ years$/i) > 0,
      controls: controls ? box(controls) : null,
      order: order ? box(order) : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      // Sam, 2026-10-02 (259f01ba): each fact on the card's rate line ("18.99% APR", "Limit $7,500",
      // "Utilization 56.0%", "Due 22nd") must sit on ONE line. Measured with a Range over the fact's own
      // characters, so it can see a break inside a fact whatever elements the line is built from.
      rateFacts: (() => {
        const line = [...document.querySelectorAll('p')].find(el => /% APR · Limit/.test(el.textContent || ''));
        if (!line) return null;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let text = '';
        for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, at: text.length }); text += n.textContent; }
        const point = i => { const hit = nodes.filter(x => x.at <= i).pop(); return [hit.n, i - hit.at]; };
        return [/[\d.]+% APR/, /Limit \$[\d,]+/, /Utilization [\d.]+%/, /Due \d+\w\w/].flatMap(re => {
          const m = re.exec(text);
          if (!m) return [];
          const range = document.createRange();
          range.setStart(...point(m.index));
          range.setEnd(...point(m.index + m[0].length - 1));
          range.setEnd(range.endContainer, range.endOffset + 1);
          const tops = new Set([...range.getClientRects()].filter(b => b.width > 0).map(b => Math.round(b.top)));
          return [{ fact: m[0], lines: tops.size }];
        });
      })(),
    };
  });
  await page.screenshot({ path: `test-results/debt-layout-${tag}.png`, fullPage: true });
  console.log(`[${tag}] ${JSON.stringify(r)}`);
  if (r.impossible !== 0) { await browser.close(); fail(2, `[${tag}] CONTROL FAILED: the matcher cannot say no.`); }
  if (!r.controls || !r.order) { await browser.close(); fail(2, `[${tag}] CONTROL FAILED: could not find the controls or the order card.`); }
  if (r.utilizationLabels !== 1) problems.push(`[${tag}] utilization is labelled ${r.utilizationLabels} times (want 1)`);
  if (r.targetsNote) problems.push(`[${tag}] the "Targets ending cash" note is back`);
  if (r.alwaysPill) problems.push(`[${tag}] the "Cash floor always enforced" pill is back`);
  // A plan that never pays off has no date to share, so no Share button is the right answer there.
  // The DEMO account does pay off, which is what makes it the probe that can see a misplaced Share.
  if (r.neverPaysOff && !demo) {
    if (r.shareCount !== 0) problems.push(`[${tag}] Share renders for a plan that never pays off`);
  } else if (r.neverPaysOff && demo) {
    await browser.close(); fail(2, `[${tag}] CONTROL FAILED: the demo plan reads as never paying off, so Share placement cannot be checked.`);
  } else if (r.shareCount !== 1 || !r.shareInToolbar) {
    problems.push(`[${tag}] Share is not alone in the toolbar (count ${r.shareCount}, inToolbar ${r.shareInToolbar})`);
  }
  if (r.overflow > 1) problems.push(`[${tag}] the page is ${r.overflow}px wider than the viewport`);
  if (!demo) {
    if (!r.rateFacts || r.rateFacts.length < 3) { await browser.close(); fail(2, `[${tag}] CONTROL FAILED: the card rate line or its facts were not found (${JSON.stringify(r.rateFacts)}).`); }
    for (const f of r.rateFacts) if (f.lines !== 1) problems.push(`[${tag}] "${f.fact}" breaks across ${f.lines} lines`);
  }
  if (view.width >= 1024) {
    if (Math.abs(r.controls.top - r.order.top) > 4 || r.order.left <= r.controls.right - 4) {
      problems.push(`[${tag}] controls (${JSON.stringify(r.controls)}) and order (${JSON.stringify(r.order)}) are not side by side`);
    }
  } else if (r.order.top <= r.controls.top) {
    problems.push(`[${tag}] the order card does not stack below the controls`);
  }
  await ctx.close();
}

await probe({ width: 1440, height: 900 }, 'desktop');
await probe({ width: 390, height: 844 }, 'phone');
await probe({ width: 1440, height: 900 }, 'demo-desktop', true);

// Sam, 2026-10-01 (from debt-demo-top.png): the cookie banner said "Budget OS", the cash floor showed a greyed
// "1500" beside a "Safe Min" chip so the applied floor was ambiguous, and "Set manually" was a bare checkbox.
// Checked on /demo at 390 with NO consent stored, so the banner is on screen. Every non-GET to the data plane is
// aborted in this context, so pressing the switch persists nothing.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let aborted = 0;
  await page.route(/\/(rest|functions)\/v1\//, r => {
    if (['GET', 'HEAD'].includes(r.request().method())) return r.continue();
    aborted += 1;
    return r.abort();
  });
  await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  const banner = page.getByText('We use cookies').first();
  try { await banner.waitFor({ state: 'visible', timeout: 15000 }); }
  catch { await browser.close(); fail(2, '[floor] CONTROL FAILED: the cookie banner never showed with no consent stored.'); }
  // textContent, NOT innerText: the banner's long sentence is `hidden sm:inline`, so at 390 innerText skips the
  // very words a desktop user reads - measured, the first red run passed "Budget OS" this way. And the two
  // category descriptions only render inside "Manage preferences", so it is opened before reading.
  await page.getByRole('button', { name: 'Manage preferences' }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const bannerText = (await page.locator('body').textContent()) ?? '';
  if (!/analytics/i.test(bannerText)) { await browser.close(); fail(2, '[floor] CONTROL FAILED: the consent preferences did not open.'); }
  if (/budget os/i.test(bannerText)) problems.push('[floor] the consent copy still says "Budget OS"');
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let aborted = 0;
  await page.route(/\/(rest|functions)\/v1\//, r => {
    if (['GET', 'HEAD'].includes(r.request().method())) return r.continue();
    aborted += 1;
    return r.abort();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
    version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
  })));
  await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const debtLink = page.locator('a[href="/debt"]:visible').first();
  if (!(await debtLink.count())) { await browser.close(); fail(2, '[floor] CONTROL FAILED: no visible /debt link at 390.'); }
  await debtLink.click();
  try { await page.getByText('Total CC Balance').first().waitFor({ state: 'visible', timeout: 30000 }); }
  catch { await browser.close(); fail(2, '[floor] CONTROL FAILED: /debt did not render in demo at 390.'); }
  await page.waitForTimeout(2000);
  const sw = page.getByRole('switch', { name: 'Set the cash floor manually' });
  const applied = page.getByTestId('cash-floor-applied');
  const manualBox = page.getByLabel('Manual cash floor');
  if (!(await sw.count())) problems.push('[floor] "Set manually" is not a switch');
  if (!(await applied.count())) problems.push('[floor] no applied-floor value is shown');
  // The Pay From select must show the whole account name at 390: measure the selected option's text in the
  // select's own font against the room inside it (the chevron's padding excluded).
  const fit = await page.getByLabel('Funding account').evaluate(el => {
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = el.options[el.selectedIndex]?.text ?? '';
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { text, need: Math.ceil(c.measureText(text).width), room: Math.floor(room) };
  });
  console.log(`[floor] pay-from "${fit.text}" needs ${fit.need}px, has ${fit.room}px`);
  if (!fit.text) { await browser.close(); fail(2, '[floor] CONTROL FAILED: the funding select has no selected text.'); }
  if (fit.need > fit.room) problems.push(`[floor] the Pay From select cuts "${fit.text}" short (${fit.need}px in ${fit.room}px)`);
  const before = (await sw.count()) ? await sw.first().getAttribute('aria-checked') : null;
  const boxBefore = await manualBox.count();
  if (before === 'false' && boxBefore !== 0) problems.push(`[floor] automatic mode still shows a number box (${boxBefore})`);
  if (await sw.count()) {
    await sw.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/debt-floor-auto-390.png' });
    await sw.first().click();
    await page.waitForTimeout(500);
    const after = await sw.first().getAttribute('aria-checked');
    const boxAfter = await manualBox.count();
    if (after === before) problems.push(`[floor] pressing the switch changed nothing (aria-checked ${before} -> ${after})`);
    if (after === 'true' && boxAfter !== 1) problems.push(`[floor] manual mode shows ${boxAfter} number boxes, want 1`);
    await page.screenshot({ path: 'test-results/debt-floor-manual-390.png' });
    console.log(`[floor] switch ${before}->${after} box ${boxBefore}->${boxAfter} applied="${(await applied.first().textContent())?.trim()}" writes aborted ${aborted}`);
  }
  await ctx.close();
}
await browser.close();
if (problems.length) { problems.forEach(p => console.error(`FAIL: ${p}`)); process.exit(1); }
console.log('PASS: Share in the toolbar, utilization stated once, no repeated safe-minimum notes, controls beside the order at 1440 and stacked at 390. Frames test-results/debt-layout-{desktop,phone,demo-desktop}.png');
