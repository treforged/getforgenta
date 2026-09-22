#!/usr/bin/env node
/**
 * check:share-card - renders the debt-free share card in a REAL browser and asserts it.
 *
 * jsdom has no canvas, so a unit test cannot see this image at all. This script loads the real
 * modules through the Vite dev server (no sign-in needed; nothing here reads user data) and:
 *   1. renders three cards (a far date, "this month", paid) and requires each PNG to be exactly
 *      1080x1350 with visible ink: pixels in the headline band must differ from the background;
 *   2. requires a spec carrying a money figure to be REFUSED by the renderer itself;
 *   3. POSITIVE CONTROL: a blank headline must read as "no ink", so a zero from step 1 means
 *      something;
 *   4. writes the frames to --out so a person can look at them.
 *
 * Needs the dev server on http://localhost:8080 (npm run dev). Exit 0 pass, 1 fail, 2 instrument.
 * Does NOT cover: the share sheet itself (native and navigator.share need a device or a user
 * gesture), colour taste, or anything about the button that will open it.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SHARE_CARD_BASE ?? 'http://localhost:8080';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : null;

const browser = await chromium.launch();
let failed = 0;
try {
  const page = await browser.newPage();
  const res = await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  if (!res) {
    console.log(`INSTRUMENT: dev server not reachable at ${BASE}`);
    process.exit(2);
  }

  const result = await page.evaluate(async () => {
    const { buildDebtFreeCard } = await import('/src/lib/share-card.ts');
    const { renderShareCard, CARD_W, CARD_H } = await import('/src/lib/share-card-render.ts');
    const today = new Date(2026, 8, 22);

    async function measure(spec) {
      const blob = await renderShareCard(spec);
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      // Headline band: y 500..620, x 96..900. Background there is the gradient; count pixels
      // brighter than any background value (text is #f5f7fa, background channels stay < 0x40).
      const d = ctx.getImageData(96, 500, 804, 120).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 0x80 && d[i + 1] > 0x80) ink++;
      const reader = new FileReader();
      const dataUrl = await new Promise((r) => { reader.onload = () => r(reader.result); reader.readAsDataURL(blob); });
      return { w: bmp.width, h: bmp.height, type: blob.type, ink, dataUrl };
    }

    const cards = {};
    for (const [name, eta] of [['far', 7], ['this-month', 1], ['paid', 0]]) {
      cards[name] = await measure(buildDebtFreeCard(eta, today));
    }
    const blank = await measure({ ...buildDebtFreeCard(7, today), headline: '' });

    let refused = null;
    try {
      await renderShareCard({ ...buildDebtFreeCard(7, today), subline: '$4,210 left' });
      refused = false;
    } catch (e) {
      refused = String(e.message);
    }
    return { cards, blank, refused, W: CARD_W, H: CARD_H };
  });

  if (result.blank.ink !== 0) {
    console.log(`CONTROL FAILED: a blank headline measured ${result.blank.ink} ink pixels - the ink counter cannot tell text from background`);
    process.exit(2);
  }
  console.log('control: blank headline -> 0 ink pixels (the counter can say "nothing drawn")');

  for (const [name, c] of Object.entries(result.cards)) {
    const ok = c.w === result.W && c.h === result.H && c.type === 'image/png' && c.ink > 500;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${c.w}x${c.h} ${c.type}, ${c.ink} ink pixels in the headline band`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `share-card-${name}.png`), Buffer.from(c.dataUrl.split(',')[1], 'base64'));
    }
  }

  const refusedOk = typeof result.refused === 'string' && result.refused.includes('money figure');
  if (!refusedOk) failed++;
  console.log(`${refusedOk ? 'PASS' : 'FAIL'} a card carrying "$4,210 left" is refused by the renderer: ${result.refused}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'share card: all checks passed');
process.exit(failed ? 1 : 0);
