/**
 * SEO head-term and comparison pages (ask f07700ff), built by scripts/seo/build-pages.py into public/.
 *
 * Every page must be reachable by a crawler that runs no JavaScript: a unique <title>, a canonical that
 * matches its own path, FAQ JSON-LD that parses, a sitemap entry, and an internal link from /answers/.
 * A page missing from the sitemap or the answers index is a page nobody finds, and nothing else goes red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(process.cwd(), 'public');
const SLUGS = ['best-budget-app', 'simple-budget-app', 'free-budget-app', 'safe-to-spend', 'vs/ynab', 'vs/monarch', 'vs/rocket-money'];
const read = (rel: string) => readFileSync(join(PUBLIC, rel), 'utf-8');

describe('SEO pages (f07700ff)', () => {
  const sitemap = read('sitemap.xml');
  const answers = read('answers/index.html');
  const llms = read('llms.txt');

  it('control: the slug list is not empty and every file exists', () => {
    expect(SLUGS.length).toBe(7);
    for (const s of SLUGS) expect(existsSync(join(PUBLIC, s, 'index.html')), s).toBe(true);
  });

  it('each page has a unique title, a matching canonical and exactly one h1', () => {
    const titles = new Set<string>();
    for (const s of SLUGS) {
      const html = read(`${s}/index.html`);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
      expect(title.length, s).toBeGreaterThan(20);
      titles.add(title);
      expect(html).toContain(`<link rel="canonical" href="https://getforgenta.com/${s}/" />`);
      expect(html.match(/<h1>/g)?.length, s).toBe(1);
    }
    expect(titles.size).toBe(SLUGS.length);
  });

  it('each page carries FAQ JSON-LD that parses and has 3 questions', () => {
    for (const s of SLUGS) {
      const raw = read(`${s}/index.html`).match(/<script type="application\/ld\+json">(.+?)<\/script>/s)?.[1];
      expect(raw, s).toBeTruthy();
      const ld = JSON.parse(raw!);
      expect(ld['@type']).toBe('FAQPage');
      expect(ld.mainEntity).toHaveLength(3);
    }
  });

  it('each page is in the sitemap, linked from /answers/, and listed in llms.txt', () => {
    for (const s of SLUGS) {
      expect(sitemap, s).toContain(`<loc>https://getforgenta.com/${s}/</loc>`);
      expect(answers, s).toContain(`href="/${s}/"`);
      expect(llms, s).toContain(`https://getforgenta.com/${s}/`);
    }
  });

  it('the safe-to-spend worked example adds up: 1,800 - 1,200 = 600 low point, less 200 = 400', () => {
    const html = read('safe-to-spend/index.html');
    expect(1800 - 1200).toBe(600);
    expect(html).toContain('$600 &minus; $200 = <strong>$400</strong>');
    expect(1800 - 1200 + 1500).toBe(2100);
    expect(html).toContain('$2,100');
  });
});
