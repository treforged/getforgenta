import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The pre-commit Semgrep pass (ask 77cfda79). The planted files are WRITTEN AT RUNTIME
 * into a temp dir, so this test file carries no injectable call and the hook does not
 * refuse the commit that adds its own tests.
 *
 * Semgrep lives in a private venv on the dev machine and NOT in CI, so the scanning
 * cases skip in CI and say so. The fail-closed case runs everywhere.
 */
const SCRIPT = resolve(__dirname, '../semgrep-staged.mjs');
const REPO = resolve(__dirname, '../..');
const venv = join(homedir(), '.claude', 'tools', 'semgrep-venv');
const HAVE = [join(venv, 'Scripts', 'semgrep.exe'), join(venv, 'bin', 'semgrep')].some(existsSync);
if (!HAVE) console.warn('semgrep-staged.test: semgrep venv not found - scanning cases SKIPPED, not passed');

function scan(files, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', REPO, '--files', ...files], {
    encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true,
  });
  return { code: r.status, err: r.stderr };
}

function plant(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-plant-'));
  const p = join(dir, name);
  writeFileSync(p, body);
  return { p, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const q = 'query';
const concat = `import { Pool } from 'pg';\nconst pool = new Pool();\nexport const f = (id: string) => pool.${q}("SELECT * FROM users WHERE id = '" + id + "'");\n`;
const templ = 'export const g = (sql: any, id: string) => sql.unsafe(`select * from profiles where id = \'${id}\'`);\n';
const safe = `import { Pool } from 'pg';\nconst pool = new Pool();\nexport const h = (id: string) => pool.${q}('SELECT * FROM users WHERE id = $1', [id]);\n`;

describe('semgrep-staged', () => {
  it.skipIf(!HAVE)('REFUSES a planted concatenated SQL query (exit 1)', () => {
    const a = plant('planted.ts', concat);
    try { const r = scan([a.p]); expect(r.code).toBe(1); expect(r.err).toMatch(/raw-sql-concatenation/); } finally { a.done(); }
  }, 120_000);

  it.skipIf(!HAVE)('REFUSES a planted interpolated sql.unsafe (exit 1)', () => {
    const a = plant('planted.ts', templ);
    try { expect(scan([a.p]).code).toBe(1); } finally { a.done(); }
  }, 120_000);

  it.skipIf(!HAVE)('passes a parameterised query (exit 0), so it does not cry wolf', () => {
    const a = plant('safe.ts', safe);
    try { const r = scan([a.p]); expect(r.code).toBe(0); expect(r.err).toMatch(/examined 1 file/); } finally { a.done(); }
  }, 120_000);

  it('FAILS CLOSED when semgrep cannot run (exit 2, never 0)', () => {
    const a = plant('safe.ts', safe);
    try { expect(scan([a.p], { SEMGREP_BIN: join(tmpdir(), 'no-such-semgrep') }).code).toBe(2); } finally { a.done(); }
  }, 120_000);
});
