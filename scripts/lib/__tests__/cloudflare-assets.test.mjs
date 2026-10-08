import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { headersFileFromVercel, toCloudflarePath } from '../cloudflare-assets.mjs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

describe('toCloudflarePath', () => {
  it('translates the three shapes vercel.json uses', () => {
    expect(toCloudflarePath('/(.*)')).toBe('/*');
    expect(toCloudflarePath('/assets/(.*)')).toBe('/assets/*');
    expect(toCloudflarePath('/.well-known/apple-app-site-association')).toBe(
      '/.well-known/apple-app-site-association',
    );
  });
  it('throws on a shape it cannot translate, rather than dropping the rule', () => {
    expect(() => toCloudflarePath('/((?!assets/).*)')).toThrow(/no translation/);
    expect(() => toCloudflarePath('/:path*')).toThrow(/no translation/);
  });
});

describe('headersFileFromVercel (the real vercel.json)', () => {
  const text = headersFileFromVercel(vercel);
  it('carries every header value verbatim, CSP included', () => {
    for (const rule of vercel.headers) {
      for (const { key, value } of rule.headers) expect(text).toContain(`  ${key}: ${value}`);
    }
  });
  it('emits one block per Vercel rule', () => {
    const rules = text.split('\n').filter((l) => l.startsWith('/'));
    expect(rules).toEqual(['/.well-known/apple-app-site-association', '/assets/*', '/index.html', '/*']);
  });
  it('refuses a conditional rule and an over-long line (controls)', () => {
    expect(() => headersFileFromVercel({ headers: [{ source: '/x', has: [{}], headers: [] }] })).toThrow(/conditional/);
    const long = { headers: [{ source: '/x', headers: [{ key: 'K', value: 'v'.repeat(2000) }] }] };
    expect(() => headersFileFromVercel(long)).toThrow(/chars/);
  });
});
