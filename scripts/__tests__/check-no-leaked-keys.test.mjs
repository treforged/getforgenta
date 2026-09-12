import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { scanDir, scanUrl, exitCodeFor, selfTest, MIN_KEY_CHARS, ALLOW_MARKER } from '../check-no-leaked-keys.mjs';

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

  // A bundle with no key of ANY kind. This is NOT a could-not-look condition: the
  // mobile workflows build a `dist/` that is never executed on a device (capacitor
  // server.url points at the hosted site) and CI holds no VITE_SUPABASE_* secrets, so
  // a keyless bundle is the normal, correct output there.
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

  it('PASSES a bundle with no key of any kind — liveness is "did I read", not "did I find"', () => {
    const r = scanDir(dirs['no-keys-at-all']);
    expect(r.findings).toHaveLength(0);
    expect(r.publishable).toBe(0);
    expect(r.jwts).toHaveLength(0);
    expect(r.textScanned).toBeGreaterThan(0);
    // The old rule returned 2 here and blocked every mobile build on 2026-09-12. It
    // read something, and it found nothing wrong. That is a pass.
    expect(exitCodeFor(r)).toBe(0);
  });

  it('still exits 2 when files exist but none is text-like', () => {
    const d = fixture('binary-only', { 'logo.png': 'not really a png' });
    const r = scanDir(d);
    expect(r.filesScanned).toBeGreaterThan(0);
    expect(r.textScanned).toBe(0);
    expect(exitCodeFor(r)).toBe(2);
  });
});

describe('check-no-leaked-keys — the self-test is the liveness proof', () => {
  it('finds a key it planted itself, against a fixture production cannot change', () => {
    expect(selfTest()).toBe(true);
  });

  it('is a DISCRIMINATING check: a value-blind scanner would fail it', () => {
    // The self-test asserts exactly one finding, so a scanner that matched the library
    // prefix literal (two findings) or saw no key at all (zero) both fail it. Proven
    // here by the same fixture shape, scanned for real.
    const r = scanDir(dirs['both-sides']);
    expect(r.findings).toHaveLength(1);
    expect(r.publishable).toBe(1);
  });
});

describe('check-no-leaked-keys — the LIVE deployment, which is the bundle users execute', () => {
  /**
   * The local `dist/` is not what runs on a device (capacitor `server.url`), so this
   * mode is the one with coverage meaning. Served over real HTTP rather than mocked:
   * a mock that agreed with the code would prove nothing about fetching.
   */
  const serve = (routes) => new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const body = routes[req.url.split('?')[0]];
      if (body === undefined) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });

  const page = (...srcs) => '<!doctype html><html><head>'
    + srcs.map(s => `<script type="module" src="${s}"></script>`).join('')
    + '</head><body></body></html>';

  it('passes a clean deployment and counts index.html plus every same-origin asset', async () => {
    const { srv, base } = await serve({
      '/': page('/assets/app.js', '/assets/vendor.js'),
      '/assets/app.js': 'const pub = "' + FAKE_PUBLISHABLE + '";',
      '/assets/vendor.js': LIBRARY_LITERAL,
    });
    try {
      const r = await scanUrl(base);
      expect(r.findings).toHaveLength(0);
      expect(r.publishable).toBe(1);
      expect(r.textScanned).toBe(3); // index + 2 assets
      expect(r.target).toContain(base);
      expect(exitCodeFor(r)).toBe(0);
    } finally { srv.close(); }
  });

  it('FAILS on a secret key in a shipped chunk, naming the URL and line', async () => {
    const { srv, base } = await serve({
      '/': page('/assets/app.js'),
      '/assets/app.js': 'const pub = "' + FAKE_PUBLISHABLE + '";\nconst oops = "' + FAKE_SECRET + '";',
    });
    try {
      const r = await scanUrl(base);
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0].kind).toBe('supabase secret key');
      expect(r.findings[0].file).toBe(`${base}/assets/app.js`);
      expect(r.findings[0].line).toBe(2);
      expect(exitCodeFor(r)).toBe(1);
    } finally { srv.close(); }
  });

  it('⚠️ A PARTIAL READ IS NOT A PASS — one unfetchable chunk forces exit 2', async () => {
    // The chunks that DID load are clean, so a scanner that let them stand in for the
    // whole bundle would report a confident green over the one file it never saw.
    const { srv, base } = await serve({
      '/': page('/assets/app.js', '/assets/missing.js'),
      '/assets/app.js': 'const pub = "' + FAKE_PUBLISHABLE + '";',
    });
    try {
      const r = await scanUrl(base);
      expect(r.findings).toHaveLength(0);
      expect(r.fetchErrors).toBe(1);
      expect(r.textScanned).toBeGreaterThan(0);
      expect(exitCodeFor(r)).toBe(2);
    } finally { srv.close(); }
  });

  it('exits 2 when the deployment is unreachable rather than reporting it clean', async () => {
    const { srv, base } = await serve({});
    srv.close();
    await new Promise(r => srv.on('close', r));
    const r = await scanUrl(base);
    expect(r.textScanned).toBe(0);
    expect(exitCodeFor(r)).toBe(2);
  });

  it('ignores third-party scripts — a bundle we do not ship is not ours to judge', async () => {
    const { srv, base } = await serve({
      '/': '<!doctype html><script src="https://cdn.example.com/x.js"></script>'
        + '<script type="module" src="/assets/app.js"></script>',
      '/assets/app.js': 'const pub = "' + FAKE_PUBLISHABLE + '";',
    });
    try {
      const r = await scanUrl(base);
      expect(r.filesScanned).toBe(2); // index + the one same-origin asset
      expect(r.fetchErrors).toBe(0);
      expect(exitCodeFor(r)).toBe(0);
    } finally { srv.close(); }
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
