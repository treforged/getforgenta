#!/usr/bin/env node
// check-destructive-states.mjs - the ARMED DELETE, the least legible state of the most dangerous
// control in the app, measured in a real browser.
//
// WHY THIS EXISTS, AND WHY THE OTHER GATES CANNOT DO IT. `check-dark-contrast.mjs` and
// `check-destructive-contrast.mjs` both measure only elements that OWN A TEXT NODE, and only what
// renders WITHOUT INTERACTION. The delete control on /budget is neither: it is an icon-only
// button, and its destructive colour appears only AFTER a first click arms it. So the single most
// dangerous control in a financial app was invisible to every contrast gate here, in the one state
// where being legible matters most.
//
// ⚠️ IT ARMS, IT NEVER CONFIRMS. BudgetControl.tsx uses a two-step INLINE confirm - the first click
// arms (`deleteConfirm === r.id`), the second deletes. This presses once and ASSERTS it armed
// rather than assuming, then leaves without a second press.
//
// ⚠️ THE NON-DESTRUCTIVE CONTROL COUNTS ROWS, NOT DELETE BUTTONS, AND THAT CORRECTION IS THE WHOLE
// LESSON OF THIS FILE. The first version counted buttons matching /^delete /i. Arming CHANGES that
// button's accessible name to "Confirm delete ...", so the count fell 2 -> 1 and the control
// announced that DATA HAD BEEN DESTROYED when nothing had been touched. It failed safe by luck: a
// real delete ALSO drops that count by one, so the control could not tell "row deleted" from
// "label changed" in EITHER direction. It was measuring the LABEL and reporting about the DATA.
// Rows are now counted by their "Edit ..." buttons, whose names do not move when a sibling arms.
//
// THE FLOOR HERE IS 3:1, NOT 4.5:1. WCAG 1.4.11 governs non-text contrast for a graphical control;
// 1.4.3's 4.5:1 is for text. Holding an icon to the text floor would make this a gate that is
// wrong on ordinary work, and this repo records what happens to those.
//
// WHAT IT DOES NOT COVER: validation errors and form-level error text are still unmeasured; one
// route; dark mode; 390x844; the FIRST armable control only; and it says nothing about whether the
// armed state is DISTINGUISHABLE from the unarmed one, which is a different question from contrast.
//
// EXITS: 0 clean . 1 the armed control is below 3:1 . 2 it could not measure at all.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (code, msg) => { console.error(`FAIL(${code}): ${msg}`); process.exit(code); };

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
// The same refusal every browser gate here carries, and it matters more in this one than in any of
// them: this script presses DELETE controls. It must never be able to do that as a real person.
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to script a sign-in for "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { fail(2, 'no @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}).`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('forgenta.theme.v1', 'dark'));
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));

const OVERLAY = 'div.backdrop-blur-sm, div.modal-overlay';
await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
for (let i = 0; i < 6 && (await page.locator(OVERLAY).count()); i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (!(await page.locator(OVERLAY).count())) break;
  const closer = page.getByRole('button', { name: /close|done|cancel|dismiss|got it/i }).first();
  if (await closer.count()) { await closer.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(600); }
}

const rowsBefore = await page.getByRole('button', { name: /^edit /i }).count();
const triggers = page.getByRole('button', { name: /^delete /i });
const before = await triggers.count();
if (before === 0 || rowsBefore === 0) {
  await browser.close();
  fail(2, `cannot reach the subject on /budget (${before} delete triggers, ${rowsBefore} rows) - a `
    + 'clean result here would be a fact about the instrument rather than about the app.');
}
const targetName = (await triggers.first().getAttribute('aria-label')) || '';
console.log(`rows ${rowsBefore}, destructive triggers ${before}; arming ${JSON.stringify(targetName)}`);

// Every exit from here on goes through stillSafe, so the safety control runs on the FAILURE paths
// too. The first version checked only after a successful read, so the path that actually fired
// exited having pressed a delete control and never looked at what the press did - which left me
// verifying by hand, the exact work a gate exists to remove.
const stillSafe = async (why, code = 2) => {
  const rowsNow = await page.getByRole('button', { name: /^edit /i }).count();
  await browser.close();
  if (rowsNow !== rowsBefore) {
    fail(2, `NON-DESTRUCTIVE CONTROL FAILED (while handling: ${why}): ${rowsBefore} rows before, `
      + `${rowsNow} after. This probe arms and never confirms. Investigate before re-running.`);
  }
  console.log(`non-destructive control: ${rowsBefore} rows before, ${rowsNow} after - nothing deleted.`);
  if (code === 0) { console.log(why); process.exit(0); }
  fail(code, why);
};

await triggers.first().click();
await page.waitForTimeout(1200);

// PROVE IT ARMED rather than assuming the click did anything. A control that throws nothing and
// does nothing passes every smoke test ever written, and this portfolio has shipped exactly that.
if (!(await page.getByRole('button', { name: /^confirm delete /i }).count())) {
  await stillSafe('the delete control did not ARM - no "Confirm delete ..." button appeared after the '
    + 'press. Either the press did not land, or the two-step confirm in BudgetControl.tsx changed '
    + 'shape. Nothing was measured.');
}

const report = await page.evaluate(() => {
  const parse = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const effBg = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    if (!stack.length) return { r: 5, g: 5, b: 5, a: 1 };
    let acc = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i -= 1) acc = over(stack[i], acc);
    return acc;
  };
  const btn = document.querySelector('button[aria-label^="Confirm delete"]');
  if (!btn) return { error: 'the armed button vanished between the check and the read.' };
  const icon = btn.querySelector('svg');
  const box = btn.getBoundingClientRect();
  // An icon's colour comes from stroke/fill, which lucide sets to currentColor - so read the SVG's
  // OWN computed stroke rather than the button's `color`. A future refactor hardcoding a stroke
  // would sail past a check that only read the button, while still looking right in the class list.
  const strokeRaw = icon ? getComputedStyle(icon).stroke : null;
  const stroke = parse(strokeRaw) || parse(getComputedStyle(btn).color);
  const bg = effBg(btn);
  return {
    hasIcon: Boolean(icon),
    strokeRaw,
    ratio: stroke ? Number(ratio(stroke.a < 1 ? over(stroke, bg) : stroke, bg).toFixed(2)) : null,
    color: stroke ? `rgb(${Math.round(stroke.r)},${Math.round(stroke.g)},${Math.round(stroke.b)})` : null,
    bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    size: `${Math.round(box.width)}x${Math.round(box.height)}`,
    cls: (btn.className || '').toString().slice(0, 80),
  };
});

if (report.error) await stillSafe(report.error);
if (!report.hasIcon) await stillSafe('the armed control has no <svg> - nothing graphical to measure.');
if (report.ratio === null) await stillSafe('could not resolve the armed icon colour.');

console.log(`armed icon: ${report.size}  colour ${report.color} (stroke ${JSON.stringify(report.strokeRaw)}) on ${report.bg}`);
console.log(`contrast against its surface: ${report.ratio}:1   (WCAG 1.4.11 floor for a graphical control is 3:1)`);
console.log(`class: ${report.cls}`);

if (report.ratio < 3) {
  await stillSafe(`the ARMED DELETE control measures ${report.ratio}:1, below the 3:1 non-text floor. `
    + 'This is the most dangerous control in the app, in the state where it is about to fire.', 1);
}
await stillSafe(`PASS: the armed delete control clears 3:1 at ${report.ratio}:1.`, 0);
