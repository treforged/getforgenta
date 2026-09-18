// measure-dashboard-cost.mjs - WHAT EACH CARD COSTS IN PAGE LENGTH. AN INVENTORY, NOT A GATE.
//
// Tre, 2026-09-17, on the Overview dashboard: "advanced analytics I like it, but I'm not sure if
// it's the right place for it ... cash flow review I'm not sure if it should be there ... monthly
// change I like it a lot, but I'm not sure if it should be there as well".
//
// Three "I'm not sure"s are three decisions that are HIS, and the thing that makes them decidable
// is what each card COSTS. Its sibling `measure-dashboard-facts.mjs` answered "what repeats" and
// found the answer is small - one $25 obligation in three cards - while the page is 6.7 screens.
// So the reorganisation is a LENGTH problem, and this measures length per card.
//
// ⚠️ NOT A GATE, and there is no threshold here on purpose. "Is this card worth its height" is a
// product judgement about what a person wants on a dashboard; a number cannot answer it and a
// gate on it would be somebody's taste wearing a pass/fail. This prints the cost and stops.
//
// ⚠️ STATED LIMITS:
//   · A card BEHIND A PREMIUM GATE still occupies its height, and this counts that height - which
//     is right for "how long is the page" and WRONG for "what is this card giving me", because on
//     a free account it is giving nothing. Premium-gated cards are flagged so the two are not
//     confused.
//   · Heights are measured at 390x844 on the reviewer account. A card whose height depends on how
//     many rows the user has (goals, upcoming bills, debts) is that account's height, not Tre's.
//   · A card that renders nothing at all does not appear. Absent here means NOT MEASURED - it does
//     not mean the widget is cheap.
//
// ⚠️ THE POSITIVE CONTROL RUNS FIRST: a synthetic card of a known height must be measured at that
// height, or every number below is a fact about a broken matcher rather than about the page.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (c, m) => { console.error(`FAIL: ${m}`); process.exit(c); };
const CONTROL_HEIGHT = 321;

const env = readFileSync('.env.local', 'utf8');
const creds = readFileSync('.env.deck-walk.local', 'utf8');
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL'), anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: pick(creds, 'REACH_TEST_EMAIL'), password: pick(creds, 'REACH_TEST_PASSWORD') }) });
const session = await r.json();
if (!session.access_token) fail(2, 'sign-in failed');
const ref = new URL(url).hostname.split('.')[0];

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const EXTRACT = () => {
  const SEL = 'section[aria-label], [role="region"], .card-forged';
  const outermost = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.matches && a.matches(SEL)) return false;
    }
    return true;
  };
  const nameOf = (sec) => {
    const aria = sec.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 44);
    const h = sec.querySelector('h1,h2,h3,h4');
    const ht = h && (h.textContent || '').trim();
    if (ht) return ht.slice(0, 44);
    const own = (sec.textContent || '').trim().split('\n')[0].trim();
    return own ? '(untitled) ' + own.slice(0, 32) : 'unnamed';
  };
  // Premium gating is a `blur(` filter over the card's own content in this app.
  const gated = (sec) => {
    if (/blur\(/.test(getComputedStyle(sec).filter || '')) return true;
    return [...sec.querySelectorAll('*')].some(e => /blur\(/.test(getComputedStyle(e).filter || ''));
  };

  let scroller = document.documentElement;
  for (const el of document.querySelectorAll('*')) {
    const ov = getComputedStyle(el).overflowY;
    if (ov !== 'auto' && ov !== 'scroll') continue;
    if (el.scrollHeight > el.clientHeight + 4 && el.scrollHeight > scroller.scrollHeight) scroller = el;
  }

  const cards = [];
  for (const sec of document.querySelectorAll(SEL)) {
    if (!outermost(sec)) continue;
    const b = sec.getBoundingClientRect();
    if (b.height < 1) continue;
    cards.push({
      name: nameOf(sec),
      top: Math.round(b.top + window.scrollY),
      height: Math.round(b.height),
      gated: gated(sec),
    });
  }
  cards.sort((a, b) => a.top - b.top);
  return { cards, pageHeight: scroller.scrollHeight, viewportHeight: window.innerHeight };
};

const MIN_CARDS = 6;
async function settled() {
  let prev = -1, last = null;
  for (let i = 0; i < 10; i++) {
    const read = await page.evaluate(EXTRACT);
    last = read;
    if (read.cards.length === prev && read.cards.length >= MIN_CARDS) return read;
    prev = read.cards.length;
    await page.waitForTimeout(2000);
    if (i % 3 === 2 && read.cards.length < MIN_CARDS) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
  }
  fail(2, 'the dashboard never settled above ' + MIN_CARDS + ' cards (last ' +
          (last ? last.cards.length : 0) + ', url ' + page.url() + '). This measured nothing.');
}

await settled();

// ---- positive control: a card of a known height must be measured at that height ----
await page.evaluate((h) => {
  const s = document.createElement('section');
  s.setAttribute('aria-label', 'CONTROL-CARD');
  s.setAttribute('data-probe-control', '1');
  s.style.cssText = 'height:' + h + 'px;background:#000;position:relative;';
  document.body.appendChild(s);
}, CONTROL_HEIGHT);
const ctl = (await page.evaluate(EXTRACT)).cards.find(c => c.name === 'CONTROL-CARD');
if (!ctl) fail(2, 'CONTROL FAILED: a planted card was not found at all - the card selector matches nothing reliable.');
if (Math.abs(ctl.height - CONTROL_HEIGHT) > 2) {
  fail(2, 'CONTROL FAILED: planted a ' + CONTROL_HEIGHT + 'px card and measured ' + ctl.height +
          'px - heights are not being read correctly, so every number below would be wrong.');
}
await page.evaluate(() => document.querySelectorAll('[data-probe-control]').forEach(e => e.remove()));
await page.waitForTimeout(500);

const real = await settled();
await browser.close();

if (real.cards.some(c => c.name === 'CONTROL-CARD')) fail(2, 'the control card survived into the real reading.');
const lowest = Math.max(...real.cards.map(c => c.top + c.height), 0);
if (real.pageHeight < lowest) {
  fail(2, 'page height ' + real.pageHeight + 'px is above the lowest card bottom at ' + lowest +
          ' - the real scroller was not found, so the percentages would be nonsense.');
}

console.log('control: a planted ' + CONTROL_HEIGHT + 'px card measured ' + ctl.height + 'px');
console.log('page: ' + real.pageHeight + 'px = ' + (real.pageHeight / real.viewportHeight).toFixed(1) +
            ' screens at ' + real.viewportHeight + 'px, ' + real.cards.length + ' top-level cards\n');
console.log('  top    height   % of page   card');
for (const c of real.cards) {
  const pct = ((c.height / real.pageHeight) * 100).toFixed(1);
  console.log('  ' + String(c.top).padStart(5) + '  ' + String(c.height).padStart(5) + 'px  ' +
              (pct + '%').padStart(8) + '   ' + c.name + (c.gated ? '   [PREMIUM-GATED: costs its height, gives nothing on a free account]' : ''));
}
const measured = real.cards.reduce((a, c) => a + c.height, 0);
console.log('\n  cards account for ' + measured + 'px of ' + real.pageHeight + 'px (' +
            ((measured / real.pageHeight) * 100).toFixed(0) + '%); the rest is gaps, headings and the nav.');
console.log('\nINVENTORY ONLY - there is no threshold here. "Worth its height" is a product call.');
