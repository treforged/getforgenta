#!/usr/bin/env node
/**
 * Writes dist/_headers for a Cloudflare Workers static-assets deploy (ask 8a5268d9).
 * Runs AFTER `vite build`, only from `npm run build:cloudflare`, so the Vercel build
 * (`npm run build`) never sees it and serves nothing new.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { headersFileFromVercel } from './lib/cloudflare-assets.mjs';

if (!existsSync('dist/index.html')) {
  console.error('cloudflare-prepare: dist/index.html missing - run vite build first');
  process.exit(2);
}
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const text = headersFileFromVercel(vercel);
writeFileSync('dist/_headers', text);
console.log(`cloudflare-prepare: dist/_headers written (${text.split('\n').filter((l) => l.startsWith('/')).length} rules)`);
