/**
 * Records the animation work against real production bundles.
 *
 * Three runs of the SAME interaction — enter demo, open /builds, watch the
 * skeleton become content and the build total settle:
 *
 *   before          — the bundle built from the commit BEFORE Motion was
 *                     adopted, served from a second checkout
 *   after           — this tree, a normal browser
 *   after-reduced   — this tree, Playwright's `reducedMotion: 'reduce'`, which
 *                     sets the real `prefers-reduced-motion: reduce` media
 *                     feature rather than stubbing a matchMedia call
 *
 * The third run is the accessibility proof: if the count-up, the skeleton
 * cross-fade or the row entrance still animate under it, the library is
 * ignoring the OS setting and this work is an accessibility regression shipped
 * as polish. The first run is what makes the claim a BEFORE/AFTER rather than
 * an on/off — reduced motion is a good stand-in for the old behaviour, but it
 * is a stand-in, and the brief asked to see the real thing.
 *
 * The total is sampled from visible text, not from the `count-up` test id,
 * because that test id does not exist on the before commit and a comparison
 * has to read both sides the same way.
 *
 * ⚠️ The first run of this script reported "no animation anywhere", including
 * on the after build, and that was the INSTRUMENT rather than the app: it
 * sampled the header's "Total Budget", which at the time was still a plain
 * `toLocaleString()` and could not animate on any commit. Both halves are
 * fixed — the header now counts, and the sampler now runs INSIDE the page on
 * `requestAnimationFrame` instead of round-tripping a `body.innerText` regex
 * per sample, which was slow enough to miss a sub-second count entirely.
 *
 * Demo mode is used deliberately: no password, no personal data, and it is the
 * only way to drive a signed-in-shaped page unattended.
 *
 *   node scripts/capture-motion-evidence.mjs [--before-root <path>]
 *
 * The before checkout must already be built (see scripts/build-with-env.mjs —
 * a worktree has no .env.local of its own and its bundle will not boot).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'handoff/evidence/2026-08-12-animation';

const argOf = name => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const BEFORE_ROOT = argOf('--before-root');

function startPreview(root, port) {
  return spawn('npm', ['--prefix', root, 'run', 'preview', '--', '--port', String(port)], {
    shell: true,
    stdio: 'ignore',
  });
}

async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** Enter demo mode and get to /builds, clicking the way a person would. */
async function toBuilds(page, base, settleMs = 2500, beforeClick) {
  await page.goto(`${base}/auth`, { waitUntil: 'domcontentloaded' });
  // The cookie banner is an overlay and silently intercepts the click on
  // "Try Demo" — this cost a full run before it was spotted.
  const reject = page.getByRole('button', { name: /reject non-essential/i });
  if (await reject.count()) await reject.click();
  const demo = page.getByRole('button', { name: /try demo/i });
  await demo.waitFor({ timeout: 20000 });
  await demo.click();
  // Demo is in-memory with no route of its own, so a hard navigate drops back
  // to /auth. Move by clicking the app's own navigation.
  await page.waitForTimeout(1500);
  const link = page.getByRole('link', { name: 'Builds', exact: true }).first();
  await link.waitFor({ timeout: 20000 });
  if (beforeClick) await beforeClick();
  await link.click();
  await page.waitForTimeout(settleMs);
}

/**
 * Records every distinct value the build total takes, from inside the page.
 *
 * ONE instrument for all three runs, and it depends on nothing the after
 * commit added: it finds the leaf element whose text is exactly
 * `Total Budget` and reads its next sibling, which is the figure. That markup
 * is identical on both commits, so the before and after runs are read the same
 * way and neither can be favoured by the measurement.
 *
 * It samples on `requestAnimationFrame`, so a count that lasts 600 ms is seen
 * roughly 36 times rather than the handful of times a Playwright round trip
 * per sample would manage. Only CHANGES are stored, each with the frame's
 * timestamp — so `values.length === 1` means the number was never anything but
 * its final value, which is precisely the "it jumped" claim.
 */
const RECORDER = `
window.__totalSamples = [];
window.__resetTotalSamples = () => { window.__totalSamples = []; };
(() => {
  const readTotal = () => {
    for (const n of document.querySelectorAll('div')) {
      if (n.children.length === 0 && n.textContent.trim() === 'Total Budget') {
        const v = n.nextElementSibling;
        if (!v) return null;
        const t = v.textContent.trim();
        return /^\\$[\\d,]+$/.test(t) ? t : null;
      }
    }
    return null;
  };
  let last = null;
  const tick = () => {
    const v = readTotal();
    if (v !== null && v !== last) {
      last = v;
      window.__totalSamples.push({ t: Math.round(performance.now()), v });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

async function readSamples(page) {
  return page.evaluate(() => window.__totalSamples ?? []);
}

async function run({ label, base, reducedMotion }) {
  const dir = path.join(OUT, label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    reducedMotion,
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir, size: { width: 1440, height: 1000 } },
  });
  await context.addInitScript(RECORDER);
  const page = await context.newPage();

  const result = { label, reducedMotion, ok: false, totalAnimated: null, error: null };

  try {
    await toBuilds(page, base, 2500);
    await page.screenshot({ path: path.join(dir, 'builds.png') });
    result.countUpNodes = await page.getByTestId('count-up').count();

    // Reload and re-enter. The recorder is reinstalled by the reload and the
    // samples are cleared immediately before the click that mounts /builds, so
    // what is captured is that mount and nothing else.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await toBuilds(page, base, 2000, () => page.evaluate(() => window.__resetTotalSamples?.()));

    const samples = await readSamples(page);
    result.instrument = 'raf:Total Budget';
    result.values = samples.map(s => s.v);
    result.sampleCount = samples.length;
    result.distinctCount = new Set(result.values).size;
    // More than one value ever on screen is the count; exactly one is a jump.
    result.totalAnimated = result.distinctCount > 1;
    result.countMs = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
    result.finalValue = result.values[result.values.length - 1] ?? null;
    result.ok = samples.length > 0;
  } catch (e) {
    result.error = String(e).split('\n')[0];
  }

  const video = page.video();
  await context.close(); // video is only finalised on context close
  if (video) {
    try {
      await video.saveAs(path.join(dir, `${label}.webm`));
      await video.delete(); // drop the page@<hash>.webm original
    } catch (e) {
      result.videoError = String(e).split('\n')[0];
    }
  }
  await browser.close();
  return result;
}

const servers = [];
try {
  const runs = [];

  if (BEFORE_ROOT) {
    const port = 4174;
    const base = `http://localhost:${port}`;
    servers.push(startPreview(BEFORE_ROOT, port));
    if (!(await waitForServer(base))) throw new Error(`before preview never came up on ${base}`);
    runs.push(await run({ label: 'before', base, reducedMotion: 'no-preference' }));
  }

  const port = 4173;
  const base = `http://localhost:${port}`;
  servers.push(startPreview('.', port));
  if (!(await waitForServer(base))) throw new Error(`after preview never came up on ${base}`);
  runs.push(await run({ label: 'after', base, reducedMotion: 'no-preference' }));
  runs.push(await run({ label: 'after-reduced', base, reducedMotion: 'reduce' }));

  const byLabel = Object.fromEntries(runs.map(r => [r.label, r]));
  const before = byLabel.before;
  const after = byLabel.after;
  const reduced = byLabel['after-reduced'];

  const verdict = {
    capturedAt: new Date().toISOString(),
    runs: byLabel,
    // The three claims this evidence exists to settle.
    afterCounted: !!after?.ok && after.totalAnimated === true,
    reducedMotionHonoured:
      !!after?.ok && !!reduced?.ok && after.totalAnimated === true && reduced.totalAnimated === false,
    beforeJumped: before ? before.ok && before.totalAnimated === false : null,
  };
  fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
} finally {
  for (const s of servers) s.kill();
}
