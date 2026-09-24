import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanContent, verdict } from '../secret-scan.mjs';

/**
 * ⚠️ EVERY CREDENTIAL-SHAPED STRING HERE IS BUILT AT RUNTIME, never written as a
 * literal. Otherwise the guard refuses the very commit that adds its own tests,
 * and the obvious "fix" for that is to weaken the guard.
 */
const key = (prefix, len = 40) => prefix + 'A1b2C3d4E5'.repeat(Math.ceil(len / 10)).slice(0, len);
const kinds = (path, text) => scanContent(path, text).map((f) => f.kind);

describe('secret-scan: the shapes that matter here are refused', () => {
  it('OpenRouter, Cerebras and Resend keys (ask 6942ae27)', () => {
    expect(kinds('bin/x.env.txt', `OPENROUTER_API_KEY=${key('sk-or-v1-', 64)}`)).toContain('OpenRouter key');
    expect(kinds('a.ts', `const k = "${key('csk-')}"`)).toEqual(['Cerebras key']);
    expect(kinds('a.ts', `RESEND=${key('re_')}`)).toEqual(['Resend key']);
  });

  it('a CRLF line is refused exactly like an LF line', () => {
    const line = `KEY=${key('sk-or-v1-', 64)}`;
    expect(kinds('a.txt', `x\r\n${line}\r\ny\r\n`)).toEqual(['OpenRouter key']);
    expect(scanContent('a.txt', `x\r\n${line}\r\n`)[0].line).toBe(2);
  });

  it('Stripe live and Supabase secret keys', () => {
    expect(kinds('a.ts', key('sk_' + 'live_', 30))).toEqual(['Stripe secret key']);
    expect(kinds('a.ts', key('sb_' + 'secret_', 40))).toEqual(['Supabase secret key']);
  });

  it('the supabase-js detection literal (a bare prefix) is not refused', () => {
    expect(kinds('dist/a.js', 'key.startsWith("sb_' + 'secret_")')).toEqual([]);
  });
});

describe('secret-scan: ordinary getforgenta work is NOT refused', () => {
  it('.env.example is documentation, but .env and .env.local are refused', () => {
    expect(kinds('.env.example', 'VITE_SUPABASE_URL=')).toEqual([]);
    expect(kinds('.env', '')).toEqual(['env file']);
    expect(kinds('.env.local', '')).toEqual(['env file']);
  });

  it('source files ABOUT keys pass; a keys data file is refused', () => {
    expect(kinds('src/lib/projection-local-keys.ts', '')).toEqual([]);
    expect(kinds('scripts/check-no-leaked-keys.mjs', '')).toEqual([]);
    expect(kinds('scripts/__tests__/check-no-leaked-keys.test.mjs', '')).toEqual([]);
    expect(kinds('llm-keys.env', '')).toContain('keys file');
    expect(kinds('mistral-keys.txt', '')).toEqual(['keys file']);
  });

  it('the public Firebase key is allowed by VALUE, and another key in the same file is not', () => {
    // Read from the real file, so the allowlisted hash is checked against the key that ships.
    const json = readFileSync('android/app/google-services.json', 'utf8');
    expect(kinds('android/app/google-services.json', json)).toEqual([]);
    expect(kinds('android/app/google-services.json', `"current_key": "${key('AIza', 35)}"`)).toEqual(['Google API key']);
  });

  it('a placeholder line is an example, not a secret', () => {
    expect(kinds('README.md', `OPENROUTER_API_KEY=${key('sk-or-v1-', 64)} # EXAMPLE`)).toEqual([]);
  });
});

describe('secret-scan: the verdict', () => {
  it('examining zero files exits 2, never 0', () => {
    expect(verdict([]).exitCode).toBe(2);
  });
  it('clean exits 0 and dirty exits 1', () => {
    expect(verdict([{ path: 'a', findings: [] }]).exitCode).toBe(0);
    expect(verdict([{ path: 'a', findings: scanContent('a', key('csk-')) }]).exitCode).toBe(1);
  });
});
