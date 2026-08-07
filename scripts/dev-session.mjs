#!/usr/bin/env node
/**
 * dev-session.mjs — keep local verification sessions on ONE signed-in origin.
 *
 * Why this exists: Supabase persists the session in localStorage, and localStorage
 * is scoped PER ORIGIN. A dev server that lands on port 8081 because 8080 was busy
 * is a different origin, and therefore a signed-OUT app — even though the browser
 * profile is signed in on 8080. This script guarantees the canonical origin is the
 * one that is serving, so a session signed in once stays usable by later sessions.
 *
 * It deliberately does NOT touch credentials. It never types a password, never
 * reads or writes an access/refresh token, and never persists anything to disk.
 * The sign-in itself is manual, once, by Tre; everything after that rides on the
 * browser profile's own localStorage plus Supabase's autoRefreshToken.
 *
 * Usage:
 *   node scripts/dev-session.mjs check   # is the canonical origin serving?
 *   node scripts/dev-session.mjs up      # ensure it is (starts the dev server if not)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const HOST = 'localhost';
const PORT = 8080;
const ORIGIN = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;
const PROBE_TIMEOUT_MS = 3_000;

/** True when something is already answering HTTP on the canonical origin. */
async function isServing() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${ORIGIN}/`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start `npm run dev` detached so it outlives this process, then wait for the
 * origin to answer. Returns true once it is serving, false on timeout.
 */
async function start() {
  // Launch vite through node directly rather than `npm run dev`. On Windows,
  // Node refuses to spawn `npm.cmd` without `shell: true` (EINVAL, the
  // CVE-2024-27980 mitigation), and turning the shell on to work around that
  // is not worth it. `npm run dev` is exactly this binary anyway.
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

  if (!existsSync(viteBin)) {
    console.error('Cannot find node_modules/vite/bin/vite.js — run `npm install` first.');
    return false;
  }

  const child = spawn(process.execPath, [viteBin], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (error) => {
    console.error(`Failed to launch the dev server: ${error.message}`);
  });
  child.unref();

  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isServing()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return false;
}

function reportServing() {
  console.log(`OK    ${ORIGIN} is serving.`);
  console.log('');
  console.log('Next (browser side, agent does this — never scripted):');
  console.log(`  1. Open ${ORIGIN} in the Claude-controlled Chrome.`);
  console.log('  2. Read the Supabase auth key from localStorage to confirm sign-in.');
  console.log('  3. If signed out, ask Tre to sign in manually ONCE. Do not type credentials.');
  console.log('  4. Leave the tab parked and open — that is what keeps the token fresh.');
}

async function main() {
  const command = process.argv[2] ?? 'check';

  if (command !== 'check' && command !== 'up') {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: node scripts/dev-session.mjs [check|up]');
    process.exitCode = 2;
    return;
  }

  if (await isServing()) {
    reportServing();
    return;
  }

  if (command === 'check') {
    console.log(`DOWN  Nothing is serving ${ORIGIN}.`);
    console.log('Run: node scripts/dev-session.mjs up');
    process.exitCode = 1;
    return;
  }

  console.log(`Starting the dev server on ${ORIGIN} ...`);

  if (await start()) {
    reportServing();
    return;
  }

  console.error(`FAILED  ${ORIGIN} did not come up within ${READY_TIMEOUT_MS / 1000}s.`);
  console.error('Check whether another process holds port 8080; vite is pinned to it');
  console.error('(strictPort) precisely so it can never drift to a signed-out origin.');
  process.exitCode = 1;
}

await main();
