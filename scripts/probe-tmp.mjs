import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const ROOT = process.argv[2] || '.';
const PORT = Number(process.argv[3] || 4174);
const BASE = 'http://localhost:' + PORT;

const p = spawn('npm', ['--prefix', ROOT, 'run', 'preview', '--', '--port', String(PORT)], {
  shell: true,
  stdio: 'ignore',
});

const wait = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

try {
  if (!(await wait())) throw new Error('no server on ' + BASE);
  const b = await chromium.launch();
  const pg = await (await b.newContext()).newPage();
  const errs = [];
  pg.on('console', m => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 200));
  });
  pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 300)));

  await pg.goto(BASE + '/auth', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2000);
  console.log('URL:', pg.url());
  console.log('BODY:', JSON.stringify((await pg.locator('body').innerText()).slice(0, 300)));

  const rej = pg.getByRole('button', { name: /reject non-essential/i });
  if (await rej.count()) await rej.click();
  const demo = pg.getByRole('button', { name: /try demo/i });
  console.log('DEMO BUTTON COUNT:', await demo.count());
  if (await demo.count()) {
    await demo.click();
    await pg.waitForTimeout(2500);
    console.log('AFTER DEMO URL:', pg.url());
    const link = pg.getByRole('link', { name: 'Builds', exact: true }).first();
    console.log('BUILDS LINK COUNT:', await link.count());
    if (await link.count()) {
      await link.click();
      await pg.waitForTimeout(2500);
      console.log('BUILDS BODY:', JSON.stringify((await pg.locator('body').innerText()).slice(0, 400)));
      console.log('COUNT-UP NODES:', await pg.getByTestId('count-up').count());
    }
  }
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 6)));
  await b.close();
} finally {
  p.kill();
}
