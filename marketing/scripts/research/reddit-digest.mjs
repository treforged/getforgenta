#!/usr/bin/env node
/**
 * Condense the raw RSS dump into something a human can read in one sitting.
 * Dedupes by permalink, drops link-only posts, and prints the money sentences.
 *
 * Usage: node marketing/scripts/research/reddit-digest.mjs marketing/research/raw/<file>.json [minChars]
 */
import { readFileSync } from 'node:fs';

const [, , file, minCharsArg] = process.argv;
const minChars = Number(minCharsArg ?? 220);
const rows = JSON.parse(readFileSync(file, 'utf8'));

const seen = new Set();
let kept = 0;
const errors = rows.filter((r) => r.error);

for (const r of rows) {
  if (r.error || !r.link || seen.has(r.link)) continue;
  seen.add(r.link);
  const text = (r.text ?? '').replace(/^submitted by\s*\/u\/\S+\s*/i, '').trim();
  if (text.length < minChars) continue;
  kept += 1;
  process.stdout.write(
    `\n### [${r.sub}] ${r.title}\n${r.link}\n${r.date?.slice(0, 10) ?? ''} | u/${r.author}\n${text.slice(0, 900)}\n`,
  );
}

process.stderr.write(
  `\n-- ${rows.length} rows, ${seen.size} unique posts, ${kept} with >=${minChars} chars of text, ${errors.length} fetch errors\n`,
);
