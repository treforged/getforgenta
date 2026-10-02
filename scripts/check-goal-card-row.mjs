#!/usr/bin/env node
/**
 * check-goal-card-row.mjs - on a phone (390x844, /demo, no credentials) each goal card's copy / edit / delete
 * buttons share the amount's row instead of a line of their own (Tre, 2026-10-02, f20e814d: "the blank band above
 * the copy/edit/delete icons"). Prints each card's height. Measured: 323 -> 282px and 267 -> 226px (41px each).
 * CONTROL: at least one goal card with an Edit button must be found, or exit 2. Proven red on the pre-fix card.
 * USAGE: node scripts/check-goal-card-row.mjs   EXITS: 0 pass . 1 icons on their own row . 2 could not test
 */
import { chromium } from '@playwright/test';
const tag = process.argv[2] || 'run';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.setItem('tre_cookie_consent', JSON.stringify({ version: '1.0', decidedAt: new Date().toISOString(), essential: true, analytics: false, marketing: false })));
await p.goto('http://localhost:8080/demo', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
await p.goto('http://localhost:8080/goals', { waitUntil: 'domcontentloaded' });
for (let t = 0; t < 12; t++) { if (await p.getByRole('button', { name: /^Edit / }).count()) break; await p.waitForTimeout(1500); }
for (let i = 0; i < 6 && (await p.locator('[role="dialog"]').count()); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
const rows = await p.evaluate(() => [...document.querySelectorAll('.card-forged')].filter(c => c.querySelector('button[aria-label^="Edit "]') && c.querySelector('h3')).map(c => {
  const r = c.getBoundingClientRect();
  const edit = c.querySelector('button[aria-label^="Edit "]').getBoundingClientRect();
  const amt = c.querySelector('.font-display').getBoundingClientRect();
  return { name: c.querySelector('h3').textContent, height: Math.round(r.height), editTop: Math.round(edit.top - r.top), amountTop: Math.round(amt.top - r.top), iconsOnAmountRow: Math.abs((edit.top + edit.bottom) / 2 - (amt.top + amt.bottom) / 2) < 30 };
}));
console.log(tag, JSON.stringify(rows));
const first = p.locator('.card-forged', { has: p.locator('button[aria-label^="Edit "]') }).first();
await first.scrollIntoViewIfNeeded();
await first.screenshot({ path: `test-results/f20e814d-goal-card-${tag}.png` });
await b.close();
if (!rows.length) { console.error('FAIL: no goal card with an Edit button was found.'); process.exit(2); }
const bad = rows.filter(r => !r.iconsOnAmountRow);
if (bad.length) { console.error(`FAIL: ${bad.length} goal card(s) put the actions on their own row: ${bad.map(r => r.name).join(', ')}`); process.exit(1); }
console.log(`PASS: ${rows.length} goal card(s), actions on the amount row.`);
