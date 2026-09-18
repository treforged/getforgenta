// measure-dashboard-facts.mjs - AN INVENTORY, AND DELIBERATELY NOT A GATE.
//
// Tre, 2026-09-17, about the Overview dashboard: "that top section seems to be the same as
// like maybe some stuff below". Its sibling `measure-dashboard-duplication.mjs` answered that
// with a TEXT-IDENTITY diff and the answer was negative in a useful way: after the readability
// filter every remaining repeat was LOCAL, within ~600px, and none was section-to-section. He
// is describing the same INFORMATION reported twice, not the same STRING - a snapshot in one
// card and a snapshot widget below duplicate meaning while sharing almost no literal text.
//
// So this one attributes every reading to its OWNING SECTION and asks the cross-SECTION
// question directly:
//   A. which FIGURE is reported by more than one section (same number, two cards)
//   B. which LABEL appears in more than one section (same fact named twice, numbers may differ)
// B is the half the text diff could never do, because "Income" in two cards is not a repeat of
// any single string node's position - it is a repeat of a MEANING, and only section attribution
// makes it visible.
//
// ⚠️ IT MUST NEVER BECOME A PASS/FAIL GATE. Sections legitimately share figures and words: a
// total and its largest component are often the same number, and "Income" belongs in more than
// one card by design. A gate on "no cross-section repeats" would be red on every run and would
// be switched off, which is how this repo loses gates. Read the output and judge it.
//
// ⚠️ STATED LIMITS, because an inventory invites more trust than it has earned:
//   · It CANNOT see duplication where two sections report the same fact with a DIFFERENT number
//     AND DIFFERENT words - a donut slice called "projected surplus" against a table row called
//     "net" is invisible to both reports here. Those need a human reading the section inventory.
//   · Section names come from the DOM. A card with no aria-label and no heading reads as
//     `unnamed@<y>`, which is a fact about the markup, not about the page being unstructured.
//   · Attribution takes the OUTERMOST card ancestor, so a card nested inside a card is reported
//     as ONE section. That is deliberate - it matches the granularity a person perceives - and
//     it means an inner sub-card cannot show up as duplicating its own parent.
//   · 390x844, dark, SIGNED IN as the reviewer account only. Another account has other figures,
//     and a PREMIUM-only card never renders here at all, so its facts are simply not measured.
//   · It reads the rendered page, so anything behind a tab, a drawer or a modal is out of scope.
//
// ⚠️ THE POSITIVE CONTROL IS LOAD-BEARING AND RUNS FIRST. A zero from a matcher that cannot
// find anything and a zero from a page with no duplication are the same zero. Before the real
// reading, two synthetic sections carrying one shared figure and one shared label are injected
// and BOTH reports must name them; the run refuses at exit 2 if either half is silent. They are
// then removed and the page is read again, and the real reports are asserted NOT to mention them.
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8080';
const fail = (c, m) => { console.error(`FAIL: ${m}`); process.exit(c); };

const CONTROL_FIGURE = '$123456.78';
const CONTROL_LABEL = 'Zzcontrolfact';

const env = readFileSync('.env.local', 'utf8');
const creds = readFileSync('.env.deck-walk.local', 'utf8');
const pick = (s, k) => (s.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const url = pick(env, 'VITE_SUPABASE_URL'), anon = pick(env, 'VITE_SUPABASE_PUBLISHABLE_KEY');
const email = pick(creds, 'REACH_TEST_EMAIL'), password = pick(creds, 'REACH_TEST_PASSWORD');
const ref = new URL(url).hostname.split('.')[0];
const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }) });
const session = await r.json();
if (!session.access_token) fail(2, 'sign-in failed');

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
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });   // warm: the app cold-starts on first navigation
await page.waitForTimeout(6000);

// The extraction, run twice: once with the control sections present, once without.
const EXTRACT = () => {
  const SECTION_SEL = 'section[aria-label], [role="region"], .card-forged';

  // The OUTERMOST matching ancestor, so a card inside a card is one section, not two.
  const sectionFor = (el) => {
    let found = null;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.matches && a.matches(SECTION_SEL)) found = a;
    }
    return found;
  };

  const nameOf = (sec) => {
    if (!sec) return '(page)';
    const aria = sec.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 60);
    const h = sec.querySelector('h1,h2,h3,h4');
    const ht = h && (h.textContent || '').trim();
    if (ht) return ht.slice(0, 60);
    // A card with neither. Name it by its own first line of text so the report is legible -
    // the KPI tiles on this page are each their own `.card-forged` with no heading at all, and
    // six rows reading `unnamed@<y>` tell a reader nothing about what they hold.
    const own = (sec.textContent || '').trim().split('\n')[0].trim();
    const y = Math.round(sec.getBoundingClientRect().top + window.scrollY);
    return own ? '(untitled) ' + own.slice(0, 40) : 'unnamed@' + y;
  };

  const CURRENCY = /^\$-?[0-9][0-9,]*(\.[0-9]+)?$/;
  const PERCENT = /^-?[0-9]+(\.[0-9]+)?%$/;
  const MONTHYEAR = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? ?[0-9]{4}$/i;

  const classify = (t) => {
    if (CURRENCY.test(t)) return { kind: 'figure', key: t.replace(/[$,]/g, '') };
    if (PERCENT.test(t)) return { kind: 'figure', key: t };
    if (MONTHYEAR.test(t)) return { kind: 'figure', key: t.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ') };
    if (t.length >= 2 && t.length <= 40 && /[A-Za-z]/.test(t)) return { kind: 'label', key: t.toLowerCase() };
    return null;
  };

  const rows = [];
  const sectionTops = {};
  let dropped = 0, considered = 0;

  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.textContent || '').trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    considered++;

    // Readability, same filter as the sibling: a string a person cannot read is not a repeat
    // a person sees. This is what killed the previous session's headline finding.
    let blurred = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const f = getComputedStyle(a).filter;
      if (f && f !== 'none' && /blur\(/.test(f)) { blurred = true; break; }
      if (Number(getComputedStyle(a).opacity) < 0.15) { blurred = true; break; }
    }
    let covered = false;
    const cx = Math.min(Math.max(b.left + b.width / 2, 1), window.innerWidth - 1);
    const cy = Math.min(Math.max(b.top + b.height / 2, 1), window.innerHeight - 1);
    if (b.top >= 0 && b.bottom <= window.innerHeight) {
      const hit = document.elementFromPoint(cx, cy);
      covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
    }
    if (blurred || covered) { dropped++; continue; }

    // ⚠️ OFF-SCREEN BY POSITION, not by display. The first run reported "$0" as a
    // cross-section figure at y=-20000 - an element parked far off the document, readable by
    // every test above and invisible to every person. A negative document top is the signature.
    const docTop = Math.round(b.top + window.scrollY);
    if (docTop < 0 || b.right <= 0 || b.left >= document.documentElement.scrollWidth) { dropped++; continue; }

    const c = classify(t);
    if (!c) continue;
    const sec = sectionFor(el);
    const name = nameOf(sec);
    if (sectionTops[name] === undefined) {
      sectionTops[name] = sec ? Math.round(sec.getBoundingClientRect().top + window.scrollY) : 0;
    }
    rows.push({ text: t, kind: c.kind, key: c.key, section: name, y: Math.round(b.top + window.scrollY) });
  }
  // ⚠️ `documentElement.scrollHeight` IS THE WRONG OBJECT HERE and read 844px - exactly one
  // screen - while content was laid out at y=5545. This app scrolls an INNER container, which
  // `check:glass` in this repo already had to discover the hard way. So find the real scroller:
  // the element with the largest scrollHeight that actually overflows its own client box.
  let scroller = document.documentElement;
  for (const el of document.querySelectorAll('*')) {
    const ov = getComputedStyle(el).overflowY;
    if (ov !== 'auto' && ov !== 'scroll') continue;
    if (el.scrollHeight > el.clientHeight + 4 && el.scrollHeight > scroller.scrollHeight) scroller = el;
  }
  return {
    rows, sectionTops, dropped, considered,
    pageHeight: scroller.scrollHeight,
    scrollerTag: scroller === document.documentElement ? 'documentElement' : (scroller.className || scroller.tagName),
    viewportHeight: window.innerHeight,
  };
};

// ⚠️ READ UNTIL TWO CONSECUTIVE READS AGREE. A fixed wait let one run see SEVEN text nodes,
// and while that one refused honestly, a HALF-mounted page reading 120 nodes would have cleared
// the 50-node bar and silently under-reported the duplication this probe exists to find. The
// count only ever grows as the page mounts, so agreement on it is the settle signal.
// ⚠️ AND AGREEMENT ALONE IS NOT ENOUGH. Runs that refused did so holding SEVEN nodes for
// several seconds - a page that is perfectly stable because it is the wrong page (the app had
// bounced to /auth, or was still on a spinner). A stuck page agrees with itself perfectly, so
// a floor on the count and a check on the URL are what separate "settled" from "never arrived".
const MIN_NODES = 50;
async function settled() {
  let prev = -1, last = null;
  for (let i = 0; i < 10; i++) {
    const read = await page.evaluate(EXTRACT);
    last = read;
    if (read.considered === prev && read.considered >= MIN_NODES) return read;
    prev = read.considered;
    await page.waitForTimeout(2000);
    // Every third attempt, re-navigate: a session that was not picked up never recovers by waiting.
    if (i % 3 === 2 && read.considered < MIN_NODES) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
  }
  const where = page.url();
  fail(2, 'the dashboard never settled above ' + MIN_NODES + ' text nodes (last read ' +
          (last ? last.considered : 0) + ', url ' + where + '). ' +
          (where.includes('/auth') ? 'The app bounced to sign-in, so this measured the login page.'
                                   : 'This measured nothing - do not read a clean result from it.'));
}

await settled();   // settle BEFORE the control is planted, so the control run is not the warm-up

// ---- positive control: two synthetic sections sharing one figure and one label ----
await page.evaluate(([fig, lab]) => {
  for (const which of ['ALPHA', 'BETA']) {
    const s = document.createElement('section');
    s.setAttribute('aria-label', 'CONTROL-' + which);
    s.setAttribute('data-probe-control', '1');
    s.style.cssText = 'position:relative;z-index:99999;background:#000;color:#fff;padding:8px;';
    const a = document.createElement('p'); a.textContent = fig;
    const b = document.createElement('p'); b.textContent = lab;
    s.appendChild(a); s.appendChild(b);
    document.body.appendChild(s);
  }
}, [CONTROL_FIGURE, CONTROL_LABEL]);

const controlRead = await page.evaluate(EXTRACT);

await page.evaluate(() => {
  document.querySelectorAll('[data-probe-control]').forEach(e => e.remove());
});
await page.waitForTimeout(500);

const real = await settled();
await browser.close();

// ---- grouping, shared by the control run and the real run ----
function crossSection(rows, kind) {
  const by = new Map();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    if (!by.has(row.key)) by.set(row.key, { texts: new Set(), sections: new Map() });
    const g = by.get(row.key);
    g.texts.add(row.text);
    if (!g.sections.has(row.section)) g.sections.set(row.section, []);
    g.sections.get(row.section).push(row.y);
  }
  return [...by.entries()]
    .filter(([, g]) => g.sections.size >= 2)
    .sort((a, b) => b[1].sections.size - a[1].sections.size);
}

// ---- the control must have fired, in BOTH halves, before anything else is believed ----
const ctlFigures = crossSection(controlRead.rows, 'figure').map(([k]) => k);
const ctlLabels = crossSection(controlRead.rows, 'label').map(([k]) => k);
const figKey = CONTROL_FIGURE.replace(/[$,]/g, '');
const labKey = CONTROL_LABEL.toLowerCase();
if (!ctlFigures.includes(figKey)) {
  fail(2, 'CONTROL FAILED (figure half): the planted ' + CONTROL_FIGURE + ' in two sections was not reported. ' +
          'This instrument cannot detect a cross-section figure, so its zero would mean nothing.');
}
if (!ctlLabels.includes(labKey)) {
  fail(2, 'CONTROL FAILED (label half): the planted "' + CONTROL_LABEL + '" in two sections was not reported. ' +
          'This instrument cannot detect a cross-section label, so its zero would mean nothing.');
}

// ---- refusals on the real reading ----
if (real.considered < 50) {
  fail(2, 'only ' + real.considered + ' text nodes considered - the page had not mounted, so this measured nothing.');
}
const sectionNames = Object.keys(real.sectionTops);
if (sectionNames.length < 3) {
  fail(2, 'only ' + sectionNames.length + ' section(s) attributed - attribution is broken, so "no cross-section repeats" would be a fact about the selector.');
}

const figures = crossSection(real.rows, 'figure');
const labels = crossSection(real.rows, 'label');

// The control must be GONE from the real reading, or the two runs have contaminated each other.
if (figures.some(([k]) => k === figKey) || labels.some(([k]) => k === labKey)) {
  fail(2, 'the control strings survived into the real reading - the injected sections were not removed.');
}

const show = (s) => (s.length > 34 ? s.slice(0, 33) + '…' : s);

console.log('control: figure half OK, label half OK (planted ' + CONTROL_FIGURE + ' / "' + CONTROL_LABEL + '" in 2 sections, both reported)');
console.log('text nodes considered: ' + real.considered + ', dropped as unreadable: ' + real.dropped + ', classified readings: ' + real.rows.length);
console.log('sections attributed: ' + sectionNames.length);
const lowestReading = Math.max(...real.rows.map(r => r.y), 0);
console.log('page height: ' + real.pageHeight + 'px = ' +
            (real.pageHeight / real.viewportHeight).toFixed(1) + ' screens at ' + real.viewportHeight +
            'px (scroller: ' + String(real.scrollerTag).slice(0, 40) + ')');
// A height SHORTER than the lowest thing measured means the scroller was not found, and
// "1.0 screens" would be a confident wrong number rather than a missing one.
if (real.pageHeight < lowestReading) {
  fail(2, 'page height ' + real.pageHeight + 'px is above the lowest reading at y=' + lowestReading +
          ' - the real scroller was not found, so the height figure is not measured.');
}

console.log('\nA. FIGURES REPORTED BY MORE THAN ONE SECTION (' + figures.length + ')\n');
for (const [, g] of figures) {
  console.log('  ' + show([...g.texts][0]).padEnd(36) + ' in ' + g.sections.size + ' sections:');
  for (const [sec, ys] of g.sections) console.log('      ' + show(sec).padEnd(36) + ' y=' + [...new Set(ys)].join(', '));
}

console.log('\nB. LABELS APPEARING IN MORE THAN ONE SECTION (' + labels.length + ')\n');
for (const [, g] of labels) {
  console.log('  ' + show([...g.texts][0]).padEnd(36) + ' in ' + g.sections.size + ' sections: ' + [...g.sections.keys()].map(show).join(' | '));
}

console.log('\nC. SECTION INVENTORY, in page order\n');
const inv = sectionNames
  .map(name => ({
    name,
    top: real.sectionTops[name],
    figures: real.rows.filter(r => r.section === name && r.kind === 'figure').length,
    labels: real.rows.filter(r => r.section === name && r.kind === 'label').length,
  }))
  .sort((a, b) => a.top - b.top);
for (const s of inv) {
  console.log('  y=' + String(s.top).padStart(5) + '  ' + show(s.name).padEnd(36) +
              ' figures=' + String(s.figures).padStart(3) + '  labels=' + String(s.labels).padStart(3));
}
console.log('\nINVENTORY ONLY - a cross-section repeat is a CANDIDATE, never a verdict. Read C alongside A and B.');
