// check:boot-failure - a load failure must fail LOUD, never black (ask 76d3f608, 2026-09-29).
//
// Serves the PRODUCTION build (dist/, via `vite preview`) and loads it in WebKit - the engine the
// iOS app runs on - at 390x844. Four arms, each in a fresh context:
//   control   nothing blocked: the app MUST mount and the boot screen MUST stay hidden
//   entry     the entry script is aborted: the screen MUST render, and Retry MUST reload into a
//             mounted app once the block is lifted (the press asserts a change, not no-error)
//   stall     the entry script never answers: the timeout MUST show the screen
//   chunk     the /auth lazy chunk is aborted: one automatic reload, then the screen, root hidden
// "Renders" means visible with a non-zero box and the heading text on screen, read from the page.
//
// RED PROOF: STRIP_GUARD=1 removes the guard from the served HTML (what index.html was before
// this change). Every failure arm must then go red. Exit 1 = a finding, 2 = the instrument broke.
//
//   npm run build && node scripts/check-boot-failure.mjs [STRIP_GUARD=1]
import { spawn } from 'node:child_process';
import { webkit } from 'playwright';

const PORT = 4178;
const BASE = `http://localhost:${PORT}`;
const STRIP = process.env.STRIP_GUARD === '1';
const TIMEOUT_ARM_WAIT = 15000;

function startPreview() {
  const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: process.platform === 'win32', stdio: 'ignore' });
  return p;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('preview never came up on ' + BASE);
}

async function state(page) {
  return page.evaluate(() => {
    const el = document.getElementById('boot-failed');
    const box = el ? el.getBoundingClientRect() : null;
    const visible = !!(el && getComputedStyle(el).display !== 'none' && box && box.width > 0 && box.height > 0);
    const root = document.getElementById('root');
    return {
      screenVisible: visible,
      screenText: visible ? el.innerText.split('\n')[0] : '',
      mounted: !!(root && root.childElementCount > 0 && getComputedStyle(root).display !== 'none'),
      recorded: localStorage.getItem('forgenta.bootFailure.v1'),
    };
  });
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // Offline by construction: nothing leaves localhost (no telemetry, no fonts, no Supabase).
  await ctx.route(u => u.origin !== BASE, r => r.abort());
  if (STRIP) {
    await page.route(u => u.origin === BASE && (u.pathname === '/' || u.pathname === '/auth'), async route => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace(/<div id="boot-failed"[\s\S]*?<\/script>/, '');
      await route.fulfill({ response: res, body: html });
    });
  }
  return { ctx, page };
}

const results = [];
const check = (arm, ok, detail) => { results.push({ arm, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${arm}: ${detail}`); };

process.on('unhandledRejection', e => { console.log('INSTRUMENT ERROR (unhandled): ' + (e && e.message)); process.exit(2); });
process.on('uncaughtException', e => { console.log('INSTRUMENT ERROR (uncaught): ' + (e && e.message)); process.exit(2); });

const preview = startPreview();
let exit = 0;
try {
  await waitUp();
  const browser = await webkit.launch();

  // control
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const s = await state(page);
    if (!s.mounted) { console.log('CONTROL FAILED: the unblocked app did not mount - the instrument is broken'); exit = 2; }
    check('control', s.mounted && !s.screenVisible, `mounted=${s.mounted} screen=${s.screenVisible}`);
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await page.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }

  // entry script aborted, then Retry with the block lifted
  {
    const { ctx, page } = await newPage(browser);
    let block = true;
    await page.route(/\/assets\/index-[^/]+\.js$/, r => (block ? r.abort() : r.continue()));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const s = await state(page);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/boot-failed-390.png` });
    check('entry: screen renders', s.screenVisible && /Couldn't load Forgenta/.test(s.screenText), `screen=${s.screenVisible} text="${s.screenText}" mounted=${s.mounted}`);
    check('entry: failure recorded', !!s.recorded, `record=${s.recorded ? JSON.parse(s.recorded).reason.slice(0, 60) : 'none'}`);
    if (s.screenVisible) {
      block = false;
      await Promise.all([page.waitForEvent('load'), page.click('#boot-retry')]);
      await page.waitForFunction(() => document.getElementById('root')?.childElementCount > 0, null, { timeout: 30000 }).catch(() => {});
      const after = await state(page);
      check('entry: Retry reloads into the app', after.mounted && !after.screenVisible, `mounted=${after.mounted} screen=${after.screenVisible}`);
    } else {
      check('entry: Retry reloads into the app', false, 'no screen to press');
    }
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await page.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }

  // entry script never answers: the timeout must fire
  {
    const { ctx, page } = await newPage(browser);
    await page.route(/\/assets\/index-[^/]+\.js$/, () => { /* never fulfil */ });
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.waitForTimeout(TIMEOUT_ARM_WAIT);
    const s = await state(page);
    check('stall: timeout shows the screen', s.screenVisible && /Couldn't load Forgenta/.test(s.screenText), `screen=${s.screenVisible} after ${TIMEOUT_ARM_WAIT}ms`);
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await page.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }

  // a lazy route chunk fails: one automatic reload, then loud
  {
    const { ctx, page } = await newPage(browser);
    let loads = 0;
    page.on('load', () => { loads++; });
    await page.route(/\/assets\/Auth-[^/]+\.js$/, r => r.abort());
    await page.goto(BASE + '/auth', { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    const s = await state(page);
    check('chunk: screen renders after one reload', s.screenVisible && !s.mounted, `screen=${s.screenVisible} rootVisible=${s.mounted} loads=${loads}`);
    check('chunk: reloaded exactly once', loads === 2, `loads=${loads}`);
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await page.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }

  await browser.close();
} catch (e) {
  console.log('INSTRUMENT ERROR: ' + (e && e.message));
  exit = 2;
} finally {
  preview.kill();
  if (process.platform === 'win32' && preview.pid) spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
}

const failed = results.filter(r => !r.ok).length;
console.log(`boot-failure: ${results.length} checks, ${failed} failed${STRIP ? ' (STRIP_GUARD=1, red proof)' : ''}`);
if (exit === 0 && results.length === 0) exit = 2;
process.exit(exit || (failed ? 1 : 0));
