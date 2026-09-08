import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * THE GATE ITSELF IS TESTED, BECAUSE AN UNPROVEN GATE IS A FALSE GREEN.
 *
 * Tre, 2026-09-02, on the in-page debug console he wants for iPhone testing: *"for security make
 * sure exposure can never happen, then i will enable it."* He named the standard himself, and it
 * has three parts: the guarantee must be a BUILD-TIME check (a runtime `if` still ships the code),
 * it must be SEEN to go red on purpose, and it must fail if it finds no bundle to check.
 *
 * `scripts/check-no-debug-console.mjs` satisfies all three and is wired into three CI workflows.
 * This file is the second part — proof that it actually fails — because the whole point of that
 * script is to be the thing standing between a refactor and account takeover, and a check nobody
 * has watched fail is exactly what this repo's own testing rules call a green that proves nothing.
 *
 * THE STAKES, so nobody weakens this later: `localStorage` in this app holds the Supabase auth
 * session JWT. An in-page console exposes it to anyone who opens the page. That is account
 * takeover on a personal-finance app, not a debug convenience.
 *
 * These cases were run by hand on 2026-09-08 and committed rather than left in a transcript,
 * because a check that lives in the repo runs again and a clever command protects one commit.
 */

const SCRIPT = 'scripts/check-no-debug-console.mjs';
let root: string;

/** Exit code of the gate against `dir`. Never throws, so a pass and a fail are both readable. */
function gate(dir: string): number {
  try {
    execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

function bundle(name: string, contents: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.js'), contents);
  return dir;
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'debug-console-gate-')); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('the debug-console gate FAILS when it should', () => {
  // The defect it exists for: a console reaching the production bundle.
  it('fails on eruda in a bundle', () => {
    expect(gate(bundle('eruda-hit', 'var a=1;eruda.init();'))).toBe(1);
  });

  it('fails on vConsole in a bundle', () => {
    expect(gate(bundle('vconsole-hit', 'new VConsole();'))).toBe(1);
  });

  // ⚠️ Tre's third condition, and the one most checks get wrong: a check that inspects nothing
  // must NOT pass. A missing build directory and a clean build look identical at exit 0.
  it('fails when there is no build output at all', () => {
    expect(gate(join(root, 'does-not-exist'))).toBe(1);
  });

  it('fails when the directory exists but is empty', () => {
    const dir = join(root, 'empty');
    mkdirSync(dir, { recursive: true });
    expect(gate(dir)).toBe(1);
  });

  // The output layout changing is a real way this silently stops checking anything.
  it('fails when there are files but NOT ONE JavaScript bundle', () => {
    const dir = join(root, 'no-js');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    expect(gate(dir)).toBe(1);
  });
});

describe('the debug-console gate PASSES when it should', () => {
  it('passes on a clean bundle', () => {
    expect(gate(bundle('clean', 'var a=1;console.log(a);'))).toBe(0);
  });

  // A gate that cries wolf gets disabled by the next person in a hurry, which is how a real
  // guarantee dies. The marker patterns use word-ish boundaries precisely to avoid this.
  it('does NOT cry wolf on an unrelated identifier that merely contains the marker', () => {
    expect(gate(bundle('near-miss', 'var erudaX=1;var myconsoles=2;'))).toBe(0);
  });
});
