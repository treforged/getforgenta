import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deployRefusal } from '../deploy-deny.mjs';

describe('deployRefusal (the real functions folder)', () => {
  it('refuses reddit-scout, which production deleted', () => {
    expect(deployRefusal('reddit-scout')).toMatch(/DEPLOY-DENY/);
  });
  it('allows a live function (positive control)', () => {
    expect(deployRefusal('revenuecat-webhook')).toBeNull();
  });
  it('refuses a name that is not a function name', () => {
    expect(deployRefusal('../x')).toMatch(/not a function name/);
    expect(deployRefusal('a; rm -rf /')).toMatch(/not a function name/);
  });
  it('refuses a missing folder', () => {
    expect(deployRefusal('no-such-function')).toMatch(/no index.ts/);
  });
});

describe('a tombstone note refuses even when the deny list forgets it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-deny-'));
  writeFileSync(join(dir, 'DEPLOY-DENY.json'), '{}');
  mkdirSync(join(dir, 'ghost'));
  writeFileSync(join(dir, 'ghost', 'index.ts'), '');
  writeFileSync(join(dir, 'ghost', 'PRODUCTION-IS-TOMBSTONED.md'), '');
  it('refuses ghost', () => {
    expect(deployRefusal('ghost', dir)).toMatch(/TOMBSTONED/);
  });
});

describe('the wrapper refuses before deploying anything', () => {
  it('exits 1 on reddit-scout and names the reason', () => {
    const r = spawnSync(process.execPath, ['scripts/deploy-function.mjs', 'revenuecat-webhook', 'reddit-scout'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED: reddit-scout/);
  });
});
