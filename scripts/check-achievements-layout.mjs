/**
 * THE ACHIEVEMENTS PANEL MUST NOT STRAND ITS NUMBERS ACROSS A RUN OF EMPTY PIXELS, AND EVERY
 * BADGE MUST BE DRAWN BY ITS OWN ICON.
 *
 * ⚠️ WHY THIS EXISTS. Tre, 2026-09-17: *"format the achievements better give them better
 * icon/images and space the amount so there's a less intense space ... there's a lot of blank
 * space in those boxes"*. Measured before the fix: each "Still to earn" row was
 * `justify-between`, so the name sat hard left and `0/1` hard right with **640px of nothing
 * between them at 1440 and 230px at 390**. And all eleven milestones rendered the SAME target
 * icon, because the glyph was chosen per KIND rather than per badge — eleven identical marks
 * carry no information, so the icon column may as well have been blank too.
 *
 * ⚠️ IT IS THE FOURTH REPORT OF THIS CLASS (accounts descriptions, the debt purchases text, the
 * settings pill, now this), which is why the gate measures the PROPERTY — the widest horizontal
 * blank run inside a row — rather than the one screen that was reported.
 *
 * WHAT IT ASSERTS, each a measurement rather than an absence:
 *   1. POSITIVE CONTROL: the panel renders, with at least one earned tile and at least one
 *      "Still to earn" row. Every assertion below is over a SET, and an empty set satisfies all
 *      of them — a panel that rendered nothing would otherwise pass perfectly.
 *   2. every earned tile and every upcoming row draws an SVG icon;
 *   3. the upcoming rows draw DISTINCT icons — a COUNT of icons cannot tell eleven targets from
 *      eleven different badges, so the glyph itself is compared;
 *   4. no row contains a horizontal blank run wider than MAX_GAP at 1440.
 *
 * WHAT IT DOES NOT COVER: colour, contrast, whether an icon is a GOOD choice for its badge, the
 * earned grid's own empty cell (a two-column grid with an odd number of tiles always leaves one,
 * and that is ordinary card-grid behaviour rather than this defect), phone-only layout, and
 * anything outside the Achievements segment of /account.
 *
 * ⚠️ IT WRITES NOTHING to the achievements table — unlike check-trophy-case.mjs it only reads —
 * but it still refuses any account outside @forgenta.test. Signing in as a real person to
 * measure a layout is not something this repo does.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const MAX_GAP = 120; // px at 1440. The reported defect measured 640; a tidy row is well under 100.
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
if (!/@forgenta\.test$/.test(email)) fail(2, `refusing to sign in as "${email}".`);

const ref = new URL(url).hostname.split('.')[0];
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await res.json().catch(() => ({}));
if (!session.access_token) fail(2, `sign-in returned ${res.status}.`);

const rest = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
const uid = session.user.id;

// Settle the first-run dialogs the same way the sibling gates do, so nothing covers the panel.
const whatsNew = readFileSync('src/lib/whats-new.ts', 'utf8');
const releaseVersion = (whatsNew.match(/version:\s*'([^']+)'/) || [])[1];
if (!releaseVersion) fail(2, 'could not read the release version from src/lib/whats-new.ts.');
const prof = await fetch(`${url}/rest/v1/profiles?select=tour_flags&user_id=eq.${uid}`, { headers: rest });
const flags = (await prof.json())[0]?.tour_flags ?? {};
await fetch(`${url}/rest/v1/profiles?user_id=eq.${uid}`, {
  method: 'PATCH',
  headers: { ...rest, Prefer: 'return=representation' },
  body: JSON.stringify({
    founder_note_seen: true,
    tour_flags: { ...flags, new_user_done: true, premium_done: true, [`whats_new_${releaseVersion}`]: true },
  }),
});

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });

// Found BY ROLE and accessible name — a selector keyed on a styling class goes quiet the day the
// bar is restyled, and would report a missing panel that is merely painted differently.
let pressed = false;
for (let i = 0; i < 25 && !pressed; i += 1) {
  await page.waitForTimeout(700);
  const tabs = page.locator('button[role="tab"]');
  const n = await tabs.count();
  for (let k = 0; k < n; k += 1) {
    const label = ((await tabs.nth(k).textContent()) || '').trim();
    if (/achievements/i.test(label)) { await tabs.nth(k).click(); pressed = true; break; }
  }
}
if (!pressed) fail(1, 'no Achievements segment on /account, so the panel has no door at all.');

let seen = false;
for (let i = 0; i < 25 && !seen; i += 1) {
  await page.waitForTimeout(700);
  seen = (await page.locator('[data-testid="trophy-case"]').count()) > 0;
}
if (!seen) fail(1, 'the Achievements segment was pressed and the trophy case never rendered.');

// The milestone grant happens on mount and the earned list refetches after it. Measuring before
// that settles reads a panel with no earned tile — which is the instrument, not the layout.
await page.waitForTimeout(3500);

const m = await page.evaluate(() => {
  const box = document.querySelector('[data-testid="trophy-case"]');
  const upcomingList = box?.querySelector('[data-testid="trophy-case-upcoming"]');
  const earnedList = [...(box?.querySelectorAll('ul') ?? [])].find(u => u !== upcomingList);

  // The widest horizontal run of empty pixels inside one row: collect every rendered text rect
  // and every box that actually PAINTS something, sort by x, and take the largest hole.
  const widestGap = (row) => {
    const spans = [];
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walk.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(t);
      for (const r of rg.getClientRects()) if (r.width > 0) spans.push([r.left, r.right]);
    }
    for (const el of row.querySelectorAll('svg, div')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // A bare layout wrapper is not a mark on screen, so it must not count as filled space.
      const paints = el.tagName.toLowerCase() === 'svg'
        || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')
        || cs.borderTopWidth !== '0px';
      if (paints && r.width > 0) spans.push([r.left, r.right]);
    }
    if (!spans.length) return null;
    spans.sort((a, b) => a[0] - b[0]);
    const rr = row.getBoundingClientRect();
    let gap = spans[0][0] - rr.left;
    let reach = spans[0][1];
    for (const [l, r] of spans) {
      if (l > reach) gap = Math.max(gap, l - reach);
      reach = Math.max(reach, r);
    }
    gap = Math.max(gap, rr.right - reach);
    return +gap.toFixed(1);
  };

  const describe = (li) => ({
    text: li.innerText.replace(/\n+/g, ' | ').slice(0, 60),
    svgs: li.querySelectorAll('svg').length,
    // The glyph itself, never the count — a count cannot tell eleven targets from eleven badges.
    shape: [...li.querySelectorAll('svg')].map(s => s.innerHTML).join('|'),
    gap: widestGap(li),
  });

  return {
    earned: [...(earnedList?.querySelectorAll(':scope > li') ?? [])].map(describe),
    upcoming: [...(upcomingList?.querySelectorAll(':scope > li') ?? [])].map(describe),
  };
});

await browser.close();

// 1. POSITIVE CONTROL. Every assertion below is over a set; an empty set passes them all.
if (m.earned.length === 0) {
  fail(2, 'CONTROL FAILED: no earned badge tile rendered, so nothing below was measured. The '
       + 'walk account holds at least one milestone once the panel settles — this is the '
       + 'instrument, not the layout.');
}
if (m.upcoming.length === 0) {
  fail(2, 'CONTROL FAILED: no "Still to earn" rows rendered, so the gap and icon checks examined '
       + 'nothing. This is the instrument, not the layout.');
}

// 2. Every row draws an icon.
const iconless = [...m.earned, ...m.upcoming].filter(r => r.svgs === 0);
if (iconless.length) {
  fail(1, `${iconless.length} achievement row(s) draw no icon at all:\n  `
       + iconless.map(r => r.text).join('\n  '));
}

// 3. DISTINCT icons across the upcoming milestones.
const shapes = new Set(m.upcoming.map(r => r.shape));
if (shapes.size !== m.upcoming.length) {
  fail(1, `${m.upcoming.length} milestones are drawn with only ${shapes.size} distinct icon(s). `
       + 'Choosing the glyph by KIND rather than by badge is the defect Tre reported — eleven '
       + 'identical targets tell a reader nothing.');
}

// 4. No stranded numbers.
const wide = [...m.earned, ...m.upcoming].filter(r => r.gap !== null && r.gap > MAX_GAP);
if (wide.length) {
  fail(1, `${wide.length} row(s) carry a blank run wider than ${MAX_GAP}px at 1440:\n  `
       + wide.map(r => `${String(r.gap).padStart(7)}px  ${r.text}`).join('\n  '));
}

const worst = Math.max(...[...m.earned, ...m.upcoming].map(r => r.gap ?? 0));
console.log(`  earned tiles: ${m.earned.length}, still-to-earn rows: ${m.upcoming.length}`);
console.log(`  distinct milestone icons: ${shapes.size}/${m.upcoming.length}`);
console.log(`  widest blank run in any row: ${worst.toFixed(1)}px (limit ${MAX_GAP}px at 1440)`);
console.log('\nPASS: every badge has its own icon and no row strands its number across empty space.');
process.exit(0);
