#!/usr/bin/env node
// Renders docs/simple-view/simple-mock.html to test-results/detail-load/simple-mock.png and prints,
// per phone, the same three numbers measure-detail-load.mjs reads from the live app (ask 7515c3fa).
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1720, height: 900 } });
await p.goto(pathToFileURL(resolve('docs/simple-view/simple-mock.html')).href);
const h = await p.evaluate(() => document.body.scrollHeight);
await p.setViewportSize({ width: 1720, height: h });
await p.screenshot({ path: 'test-results/detail-load/simple-mock.png' });
const rows = await p.evaluate(() => [...document.querySelectorAll('.col')].map((c) => {
  const ph = c.querySelector('.ph');
  return {
    screen: c.querySelector('.cap').textContent,
    cards: ph.querySelectorAll('.card').length,
    figures: (ph.innerText.match(/\$\s?-?[\d,]+(\.\d+)?/g) || []).length,
    screens: +(ph.getBoundingClientRect().height / 844).toFixed(1),
  };
}));
console.table(rows);
if (rows.length !== 4 || rows.some((r) => r.cards < 1)) { console.error('CONTROL FAILED'); process.exit(2); }
await b.close();
