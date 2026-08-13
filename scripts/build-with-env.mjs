/**
 * Builds another checkout of this repo using THIS tree's `.env.local`.
 *
 *   node scripts/build-with-env.mjs <target-root>
 *
 * Why this exists: comparing a before/after bundle needs both commits built
 * under identical conditions, and a `git worktree` does not carry gitignored
 * files — so the older checkout has no `.env.local` and its build produces a
 * bundle that crashes on `Missing environment variable: VITE_SUPABASE_URL`.
 * That difference alone moved a measured total by 248 kB and would have been
 * reported as a regression caused by the code.
 *
 * The values are read and passed straight into the child process environment.
 * They are never printed and never written to a second file on disk, so no
 * copy of the secrets outlives this process. Vite picks up `VITE_`-prefixed
 * variables from `process.env` at build time, which is what makes this work
 * without an `.env.local` in the target tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/build-with-env.mjs <target-root>');
  process.exit(2);
}

const envPath = path.resolve('.env.local');
if (!fs.existsSync(envPath)) {
  console.error(`no .env.local at ${envPath}`);
  process.exit(2);
}

const injected = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let value = t.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (key.startsWith('VITE_')) injected[key] = value;
}

// Names only — never the values.
console.log(`injecting ${Object.keys(injected).length} VITE_ vars: ${Object.keys(injected).join(', ')}`);

const child = spawn('npm', ['--prefix', target, 'run', 'build'], {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, ...injected },
});
child.on('exit', code => process.exit(code ?? 1));
