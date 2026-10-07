#!/usr/bin/env node
/**
 * deploy-function.mjs - THE way to deploy an edge function from this repo: `npm run deploy:fn -- <name> [<name>...]`.
 * Refuses (exit 1) any name on supabase/functions/DEPLOY-DENY.json or whose folder carries a
 * PRODUCTION-IS-TOMBSTONED.md, BEFORE anything is deployed - a bare `supabase functions deploy` re-created the
 * deleted reddit-scout on 2026-10-07 with its real body. All names are checked first; one refusal deploys none.
 * The CLI gets an argument array (no shell), so a name cannot inject a command.
 */
import { spawnSync } from 'node:child_process';
import { deployRefusal } from './lib/deploy-deny.mjs';

const names = process.argv.slice(2);
if (!names.length) { console.error('usage: npm run deploy:fn -- <function> [<function>...]'); process.exit(2); }
const refused = names.map((n) => deployRefusal(n)).filter(Boolean);
if (refused.length) { for (const r of refused) console.error(`REFUSED: ${r}`); process.exit(1); }
for (const n of names) {
  const r = spawnSync('npx', ['supabase', 'functions', 'deploy', n, '--project-ref', 'mdtosrbfkextcaezuclh', '--agent', 'no', '--output-format', 'text'],
    { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`deploy of ${n} failed (exit ${r.status})`); process.exit(r.status || 1); }
}
console.log(`deployed: ${names.join(', ')}. Read each back with get_edge_function; a version of 1 means you just CREATED it.`);
