// @vitest-environment jsdom
// e1b0fffc: index.html carries the landing copy as plain HTML for crawlers that run no JS.
// It must say what the rendered landing says (copy that differs from the page is cloaking),
// and it must stay OUTSIDE #root, because the boot guard counts #root's children.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import landing from '../../locales/en/landing.json';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const block = doc.getElementById('seo-landing');
const text = (block?.textContent ?? '').replace(/\s+/g, ' ');

const REQUIRED: string[] = [
  landing.hero.titleLine1, landing.hero.titleAccent, landing.hero.subtitle,
  landing.hero.startFree, landing.hero.seeDemo,
  ...(['track', 'secure', 'automate'] as const).flatMap((k) => [landing.pillars[k].title, landing.pillars[k].desc]),
  landing.features.heading, landing.features.subheading,
  ...(['cashFlow', 'analytics', 'debt', 'savings', 'carFund', 'premium'] as const)
    .flatMap((k) => [landing.features[k].title, landing.features[k].desc]),
  landing.founder.quote, landing.cta.heading, landing.cta.subheading, landing.cta.button,
];

describe('static landing text in index.html', () => {
  it('exists and carries real words (control)', () => {
    expect(block).not.toBeNull();
    expect(text.split(' ').length).toBeGreaterThan(150);
  });

  it.each(REQUIRED)('contains landing.json copy: %s', (s) => {
    expect(text).toContain(s);
  });

  it('every list item is a landing.json title + desc, nothing invented', () => {
    const items = [...(block?.querySelectorAll('li') ?? [])].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(items.length).toBe(9);
    for (const item of items) expect(REQUIRED.some((t) => REQUIRED.some((d) => item === `${t} ${d}`))).toBe(true);
  });

  it('sits OUTSIDE #root, so the boot guard is not blinded', () => {
    const root = doc.getElementById('root');
    expect(root).not.toBeNull();
    expect(root!.childElementCount).toBe(0);
    expect(root!.contains(block)).toBe(false);
  });

  it('is removed by the boot guard on mount, so users never see it twice', () => {
    expect(html).toMatch(/function hideSplash\(\)[^\n]*'seo-landing'/);
  });
});
