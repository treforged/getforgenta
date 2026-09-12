import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDir, exitCodeFor, MIN_KEY_CHARS, ALLOW_MARKER } from '../check-no-leaked-keys.mjs';

/**
 * ⚠️ EVERY CREDENTIAL-SHAPED STRING HERE IS BUILT AT RUNTIME, never written as a
 * literal. A guard whose own tests trip it teaches the next person to loosen the
 * guard — and that is the one change that would make it useless. Concatenation and
 * `repeat()` keep this file clean to any scanner, including this one.
 */
const SECRET_PREFIX = 'sb_' + 'secret_';
const PUBLISHABLE_PREFIX = 'sb_' + 'publishable_';
const KEY_BODY = 'A1b2C3d4E5f6G7h8J9k0'; // 20 chars — exactly MIN_KEY_CHARS
const FAKE_SECRET = SECRET_PREFIX + KEY_BODY + 'MNOP';
const FAKE_PUBLISHABLE = PUBLISHABLE_PREFIX + KEY_BODY + 'QRST';

// supabase-js's REAL detection literal, reproduced exactly. This is the line that a
// prefix-matching scanner flags on every clean build of this repo.
const LIBRARY_LITERAL =
  'const isNewApiKey = (key) => key.startsWith("' + PUBLISHABLE_PREFIX + '") || key.startsWith("' + SECRET_PREFIX + '");';

let root;
const dirs = {};

function fixture(name, files) {
  const d = join(root, name);
  mkdirSync(join(d, 'assets'), { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(d, 'assets', f), body, 'utf8');
  dirs[name] = d;
  return d;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'leaked-keys-'));

  // THE TWO-SIDED CASE, IN ONE FILE. If the scanner matched prefixes it would report
  // two findings here; if it were blind to key values it would report none. Only a
  // value-matching scanner reports exactly one.
  fixture('both-sides', {
    'app.js': [
      LIBRARY_LITERAL,
      'const pub = "' + FAKE_PUBLISHABLE + '";',
      'const oops = "' + FAKE_SECRET + '";',
    ].join('\n'),
  });

  fixture('clean', {
    'app.js': [LIBRARY_LITERAL, 'const pub = "' + FAKE_PUBLISHABLE + '";'].join('\n'),
  });

  fixture('allowed', {
    'app.js': [
      'const pub = "' + FAKE_PUBLISHABLE + '";',
      'const fixtureOnly = "' + FAKE_SECRET + '"; // ' + ALLOW_MARKER,
    ].join('\n'),
  });

  // A publishable key on one line, a secret on another: the escape must NOT leak from
  // the allowed line to its neighbour.
  fixture('allow-is-per-line', {
    'app.js': [
      'const ok = "' + FAKE_SECRET + '"; // ' + ALLOW_MARKER,
      'const pub = "' + FAKE_PUBLISHABLE + '";',
      'const notOk = "' + FAKE_SECRET + '";',
    ].join('\n'),
  });

  fixture('empty', {});

  // A bundle with no key of ANY kind. For a Supabase app this means the scan was
  // pointed somewhere wrong, and it must not read as a pass.
  fixture('no-keys-at-all', { 'app.js': 'export const x = 1;\n' });

  fixture('jwt-service-role', {
    'app.js': (() => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const tok = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + b64({ role, iss: 'supabase' }) + '.sig_' + 'x'.repeat(12);
      return [
        'const pub = "' + FAKE_PUBLISHABLE + '";',
        'const anonKey = "' + tok('anon') + '";',
        'const bad = "' + tok('service_role') + '";',
      ].join('\n');
    })(),
  });
});

afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('check-no-leaked-keys — a prefix is not a key', () => {
  it('THE LOAD-BEARING CASE: catches the key VALUE and ignores the library literal in the same file', () => {
    const r = scanDir(dirs['both-sides']);
    // Exactly one. Two would mean it matched the library's prefix literal; zero would
    // mean it cannot see a real key at all.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('supabase secret key');
    expect(exitCodeFor(r)).toBe(1);
  });

  it('does not fire on an ordinary clean bundle — a gate wrong on normal work gets bypassed', () => {
    const r = scanDir(dirs['clean']);
    expect(r.findings).toHaveLength(0);
    expect(r.publishable).toBe(1);
    expect(exitCodeFor(r)).toBe(0);
  });

  it('requires at least MIN_KEY_CHARS after the prefix', () => {
    const shortDir = fixture('too-short', {
      'app.js': 'const pub = "' + FAKE_PUBLISHABLE + '";\nconst s = "' + SECRET_PREFIX + 'abc";',
    });
    expect(MIN_KEY_CHARS).toBeGreaterThanOrEqual(20);
    expect(scanDir(shortDir).findings).toHaveLength(0);
  });
});

describe('check-no-leaked-keys — the escape is per LINE, never per file', () => {
  it('honours the marker on the line it sits on', () => {
    expect(scanDir(dirs['allowed']).findings).toHaveLength(0);
  });

  it('does NOT extend the escape to other lines in the same file', () => {
    const r = scanDir(dirs['allow-is-per-line']);
    // The marked line is exempt; the unmarked one is not. A file-wide escape would
    // report zero — which is the excuse a real leak would hide behind.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].line).toBe(3);
  });
});

describe('check-no-leaked-keys — "could not look" is not "nothing found"', () => {
  it('exits 2 when there is nothing to scan', () => {
    expect(exitCodeFor(scanDir(dirs['empty']))).toBe(2);
  });

  it('exits 2 when a directory does not exist at all', () => {
    expect(exitCodeFor(scanDir(join(root, 'does-not-exist')))).toBe(2);
  });

  it('exits 2 when no key of any kind is present — a Supabase bundle always has one', () => {
    const r = scanDir(dirs['no-keys-at-all']);
    expect(r.findings).toHaveLength(0);
    expect(r.textScanned).toBeGreaterThan(0);
    // Zero findings AND zero keys is evidence about nothing, so it must not be 0.
    expect(exitCodeFor(r)).toBe(2);
  });
});

describe('check-no-leaked-keys — JWTs are judged by their role claim', () => {
  it('passes an anon token and fails a service_role one in the same bundle', () => {
    const r = scanDir(dirs['jwt-service-role']);
    expect(r.jwts.map(j => j.role).sort()).toEqual(['anon', 'service_role']);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe('JWT with role=service_role');
    expect(exitCodeFor(r)).toBe(1);
  });
});
