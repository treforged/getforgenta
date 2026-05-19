const { chromium } = require('C:/Users/tvonh/Desktop/webappredesign/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const SRC_DATA = 'data:image/png;base64,' + fs.readFileSync('C:/Users/tvonh/Desktop/webappredesign/public/forgentalogoLG.png').toString('base64');
const RES = 'C:/Users/tvonh/Desktop/webappredesign/android/app/src/main/res';

const sizes = [
  { dir: 'mipmap-mdpi',    px: 48  },
  { dir: 'mipmap-hdpi',    px: 72  },
  { dir: 'mipmap-xhdpi',   px: 96  },
  { dir: 'mipmap-xxhdpi',  px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

(async () => {
  const browser = await chromium.launch();

  for (const { dir, px } of sizes) {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setViewportSize({ width: px, height: px });

    await page.setContent(`<!DOCTYPE html><html>
<head><style>* { margin:0; padding:0; } body { width:${px}px; height:${px}px; overflow:hidden; background:transparent; }</style></head>
<body><canvas id="c" width="${px}" height="${px}"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const ctx = document.getElementById('c').getContext('2d');
  ctx.drawImage(img, 0, 0, ${px}, ${px});
  document.title = 'done';
};
img.src = '${SRC_DATA}';
</script></body></html>`);

    await page.waitForFunction(() => document.title === 'done', { timeout: 10000 });

    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: px, height: px }, omitBackground: true });

    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const dest = path.join(RES, dir, name);
      fs.writeFileSync(dest, buf);
    }
    console.log(`${dir}: ${px}x${px} ✓`);
    await page.close();
  }

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
