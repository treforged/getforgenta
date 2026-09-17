#!/usr/bin/env node
/**
 * check-text-scale.mjs - the type scale MOVES with the root size, and nothing breaks when it does.
 *
 * WHY THIS EXISTS
 * Tre, 2026-09-16: *"make the text sizing follow how the person's device is set up on mobile ...
 * the main text should follow that pattern and then the others should scale around that."*
 * That is iOS Dynamic Type, and it has two halves.
 *
 * ⚠️ THIS GATE COVERS THE SECOND HALF ONLY, AND SAYING SO IS THE POINT. Whether the root font
 * actually follows the iOS slider depends on `font: -apple-system-body` resolving on a real
 * device, and no machine here has one - that claim is documented behaviour, not a measurement.
 * What IS measurable, in any browser, is the half that silently rots: that every size in the app
 * is RELATIVE, so moving the root moves all of it. A single `font-size: 14px` added anywhere
 * makes that text the one part of the screen that ignores the user's choice, and nothing else
 * would ever go red.
 *
 * WHAT IT ASSERTS, at 390x844, signed in, on /dashboard:
 *   1. With the root at 150%, sampled text elements' computed size scales by ~1.5x.
 *      A ratio near 1.0 means that element is pinned in px and will ignore Dynamic Type.
 *   2. POSITIVE CONTROL: at least 20 text elements were sampled and the MAJORITY scaled -
 *      a zero from a broken selector and a perfectly rem-based app are the same zero.
 *   3. Nothing overflows its own container horizontally at the larger size. The real-world
 *      failure of Dynamic Type is not text that stays small, it is text that grows out of a
 *      fixed-height or fixed-width control.
 *
 * WHAT IT DOES NOT COVER
 *   The device half above, vertical clipping, line-clamped text (deliberately truncated), other
 *   routes, and whether the larger size still LOOKS right - that needs an eye.
 *
 * USAGE:  node scripts/check-text-scale.mjs   (needs the dev server and .env.deck-walk.local)
 * EXITS:  0 pass . 1 a real defect . 2 could not test
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
if (!session.access_token) fail(2, `sign-in returned ${res.status}: ${JSON.stringify(session).slice(0, 200)}`);

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
if (!patch.ok) fail(2, `settling the first-run dialogs returned HTTP ${patch.status}.`);

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { fail(2, 'Could not load @playwright/test - run npm i.'); }
try { await fetch(BASE, { redirect: 'manual' }); }
catch (err) { fail(2, `${BASE} is not serving (${err.message}). Run: node scripts/dev-session.mjs up`); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
await page.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({
  version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false,
})));
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
// ⚠️ WAIT FOR THE CONTENT, DO NOT SLEEP AT IT. A fixed 5s sampled 174 elements on one run and
// EIGHT on the next - the dashboard's widgets mount after their queries settle. Eight would have
// exited 2 ("too few to say anything"), which is honest and useless; the cure is to wait for the
// page rather than to lower the bar until a half-rendered page passes.
try {
  await page.waitForFunction(() => {
    let n = 0;
    for (const el of document.querySelectorAll('p, span, h1, h2, h3, button, label, div')) {
      if (el.children.length === 0 && (el.textContent || '').trim()) n += 1;
      if (n >= 60) return true;
    }
    return false;
  }, { timeout: 30000 });
} catch {
  await browser.close();
  fail(2, 'the dashboard never rendered 60 text elements within 30s, so there was nothing representative to measure.');
}
await page.waitForTimeout(1200);

// Sample the SAME elements before and after, matched by index into one stable query, so a
// re-render between the two reads cannot silently compare different nodes.
const SAMPLE = `p, span, h1, h2, h3, button, label, div`;

const ROOT_BEFORE = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const before = await page.evaluate((sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const t = (el.textContent || '').trim();
    if (!t || el.children.length > 0 || t.length > 60) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({ size: parseFloat(getComputedStyle(el).fontSize), text: t.slice(0, 34),
                where: `${el.tagName}.${String(el.className).slice(0, 40)}`,
                ctx: (el.parentElement ? el.parentElement.outerHTML : '').slice(0, 260) });
  }
  return out;
}, SAMPLE);

// 150% of whatever the root is - the same thing a user does with the iOS slider, applied to a
// rem scale. Set in px rather than %, so this does not compound with the existing 112.5%.
await page.evaluate((px) => { document.documentElement.style.fontSize = `${px}px`; }, ROOT_BEFORE * 1.5);
await page.waitForTimeout(700);

const readAfter = () => page.evaluate((sel) => {
  const out = [];
  const over = [];
  for (const el of document.querySelectorAll(sel)) {
    const t = (el.textContent || '').trim();
    if (!t || el.children.length > 0 || t.length > 60) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({ size: parseFloat(getComputedStyle(el).fontSize), text: t.slice(0, 34),
                where: `${el.tagName}.${String(el.className).slice(0, 40)}`,
                ctx: (el.parentElement ? el.parentElement.outerHTML : '').slice(0, 220) });
    // Horizontal overflow of its OWN box: the classic Dynamic Type failure.
    //
    // ⚠️ THREE EXCLUSIONS, EACH ADDED BECAUSE THE FIRST RUN CRIED WOLF. A gate that is wrong on
    // ordinary work is the one somebody switches off, and 6 of its 6 first findings were:
    //   - `text-overflow: ellipsis` and `-webkit-line-clamp` are DELIBERATE truncation. Text
    //     exceeding its box is the whole point of them; reporting it is reporting the feature.
    //   - a box narrower than 8px is a measuring or collapsed node, not something a user reads.
    //     The first run's worst-looking finding was "111px of text in a 1px box".
    const cs2 = getComputedStyle(el);
    const clamped = cs2.textOverflow === 'ellipsis' || (cs2.webkitLineClamp && cs2.webkitLineClamp !== 'none');
    if (!clamped && el.clientWidth >= 8 && el.scrollWidth > el.clientWidth + 2 && cs2.overflow !== 'visible') {
      over.push(`${t.slice(0, 30)} (${el.scrollWidth}px of text in a ${el.clientWidth}px box)`);
    }
  }
  return { out, over };
}, SAMPLE);

// ⚠️ READ IT TWICE AND REFUSE TO AVERAGE. One run of this gate reported a 13px element reading
// "Demo mode" that the next run could not find at all - a transient node, present for one read.
// A red control proves a check can tell two states apart; it says nothing about whether it
// returns the same answer twice, and a one-off finding reported as a defect sends somebody
// hunting in healthy code. So both passes must agree, and a disagreement is UNSTABLE (exit 2,
// "could not test") rather than a verdict either way.
const after = await readAfter();
await page.waitForTimeout(1500);
const confirm = await readAfter();

await browser.close();

// ⚠️ MATCH BY TEXT, NEVER BY INDEX, AND THIS COST A FALSE "BROKEN INSTRUMENT" VERDICT. The
// first version of this compared `before[i]` with `confirm.out[i]`. The dashboard re-renders
// between reads, so the two arrays do not line up - and when the gate was proven red by pinning
// `text-[10px]` back to real px, the first read found 22 pinned elements and the second found
// none. It exited 2, UNSTABLE, on a REAL defect. **That is the worst answer a gate can give:**
// an exit-1 finding gets fixed, an exit-2 tooling fault gets re-run, then ignored, then switched
// off. A text->size map is order-independent, so a re-render can no longer masquerade as
// instability.
// ⚠️ ONLY TEXT THAT IS UNIQUE IN BOTH READS IS COMPARED, and this caught a false finding within
// a minute of the map going in: "$0" appears many times on a dashboard at several sizes, so a
// text->element map silently pairs one "$0" with a different "$0" and reports a size change that
// is really two different elements. Duplicates carry no information about scaling, so they are
// dropped rather than guessed at - and the count of them is printed, because an inventory that
// quietly shrinks is the failure this repo keeps re-learning.
const countText = (rowsIn) => {
  const c = new Map();
  for (const r of rowsIn) c.set(r.text, (c.get(r.text) || 0) + 1);
  return c;
};
const beforeCounts = countText(before);
const uniqueBefore = before.filter((b) => beforeCounts.get(b.text) === 1);
const dropped = before.length - uniqueBefore.length;
const onlyUnique = (rowsIn) => {
  const c = countText(rowsIn);
  return rowsIn.filter((r) => c.get(r.text) === 1 && beforeCounts.get(r.text) === 1);
};
const sizeByText = new Map(uniqueBefore.map((b) => [b.text, b.size]));
const pinnedIn = (rowsIn) => {
  const out = [];
  for (const r of onlyUnique(rowsIn)) {
    const was = sizeByText.get(r.text);
    if (was === undefined) continue;
    if (r.size / was < 1.05) out.push(`${r.text}@${was}`);
  }
  return [...new Set(out)].sort().join(';');
};
const sig = (r) => `${r.over.slice().sort().join(';')}||${pinnedIn(r.out)}`;
if (sig(after) !== sig(confirm)) {
  fail(2, `UNSTABLE: two reads 1.5s apart disagreed.
    first : ${sig(after) || '(clean)'}
    second: ${sig(confirm) || '(clean)'}
  A finding that does not survive a second look is not reported as a defect, and a clean read that does not survive one is not reported as a pass.`);
}

const rows = after.out;
const n = Math.min(before.length, rows.length);
if (n < 20) fail(2, `sampled only ${n} text element(s) on /dashboard - too few to say anything, so a pass would be meaningless.`);

let scaled = 0;
let compared = 0;
const pinned = [];
const wasByText = new Map(uniqueBefore.map((b) => [b.text, b]));
for (const r of onlyUnique(rows)) {
  const was = wasByText.get(r.text);
  if (was === undefined) continue;                    // not present before; nothing to compare
  compared += 1;
  const ratio = r.size / was.size;
  if (ratio > 1.4) scaled += 1;
  // Name WHERE it is, not just what it says - a finding the reader has to go and identify is a
  // finding that gets skimmed.
  else if (ratio < 1.05) pinned.push(`"${r.text}" stayed at ${was.size}px  <${r.where}>
        parent: ${r.ctx}`);
}

console.log(`root ${ROOT_BEFORE}px -> ${(ROOT_BEFORE * 1.5).toFixed(1)}px`);
console.log(`sampled ${n}, compared ${compared}, scaled ${scaled}, pinned ${pinned.length}  (${dropped} dropped as non-unique text)`);

// ⚠️ "scaled > 0" WAS NOT A CONTROL, AND IT PASSED WHILE THE GATE MEASURED ALMOST NOTHING.
// Pairs are matched by their TEXT, and a pair whose text moved between the two reads is skipped -
// so on one run 174 elements were sampled, 172 were skipped, TWO were compared, and it printed
// PASS. Every skipped pair is neither scaled nor pinned, which means the two buckets the verdict
// rests on can both be near-empty while the sample looks large. So the control is on COMPARED,
// and on the share of it that moved: a run that could not line its samples up is "could not
// test", not "clean".
if (compared < 50) {
  fail(2, `CONTROL FAILED: only ${compared} of ${n} sampled elements could be matched across the two reads, so almost nothing was actually compared. That is an unstable page, not a verdict.`);
}
if (scaled < compared * 0.8) {
  fail(2, `CONTROL FAILED: only ${scaled} of ${compared} compared elements scaled at all. In an all-rem app nearly every one should. That points at the instrument - a root override that did not apply, or a re-render between the reads - rather than at ${compared - scaled} separate defects.`);
}

const problems = [];
if (pinned.length > 0) {
  problems.push(`${pinned.length} text element(s) are pinned in px and will ignore the device text size:\n      ${pinned.slice(0, 8).join('\n      ')}`);
}
if (after.over.length > 0) {
  problems.push(`${after.over.length} element(s) overflow their own box at the larger size:\n      ${after.over.slice(0, 8).join('\n      ')}`);
}
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`  ${p}`);
  fail(1, `${problems.length} text-scaling problem(s).`);
}
console.log(`\nPASS - ${scaled} of ${n} sampled text elements scale with the root, none is pinned in px, and none overflows its box at 150%.`);
