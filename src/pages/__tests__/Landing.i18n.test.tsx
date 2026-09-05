// @vitest-environment jsdom
//
// PRESSES THE LANGUAGE SWITCHER. A smoke render would prove the Landing page still
// mounts, which is not the claim being made — the claim is that a person can change
// the language and the page changes with them. So this mounts the real page with the
// real i18next instance, reads the English copy, fires a change on the select, and
// reads the Spanish copy back out of the DOM.
//
// ⚠️ jsdom is legitimate HERE and would not be for a layout claim: every assertion below
// is text content and an attribute, both of which jsdom reports truthfully. Nothing here
// depends on scrollHeight, clientHeight or any measured geometry — see CLAUDE.md's gate.
//
// The catalogue-parity test at the bottom is the one that catches the slow failure: a key
// added to one locale and forgotten in the other renders the raw key on screen, and nobody
// reading English would ever see it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import en from '@/locales/en/landing.json';
import es from '@/locales/es/landing.json';

vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemo: false, setIsDemo: vi.fn() }),
}));

// framer-motion's `whileInView` needs an IntersectionObserver, and the stat counters
// register one of their own. jsdom has neither.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

import Landing from '@/pages/Landing';
import i18n, { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '@/lib/i18n';

function renderLanding() {
  return render(<MemoryRouter><Landing /></MemoryRouter>);
}

describe('Landing — the language switcher actually changes the page', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', NoopObserver);
    localStorage.clear();
    return i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders English before anybody touches the control', () => {
    renderLanding();
    expect(screen.getByText(en.hero.titleAccent)).toBeTruthy();
    // `getAllBy`: the call to action repeats its label in the nav and the hero.
    expect(screen.getAllByText(en.cta.button, { exact: false }).length).toBeGreaterThan(0);
  });

  it('switches the page to Spanish when the control is used', () => {
    renderLanding();

    // Sanity: the Spanish headline must not already be on screen, or the assertion
    // after the switch would pass without the switch having done anything.
    expect(screen.queryByText(es.features.heading)).toBeNull();

    const select = screen.getAllByLabelText('Language')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'es' } });

    expect(screen.getByText(es.features.heading)).toBeTruthy();
    expect(screen.getByText(es.hero.titleAccent)).toBeTruthy();
    expect(screen.getAllByText(es.cta.button, { exact: false }).length).toBeGreaterThan(0);
    // …and the English it replaced is gone, not merely joined.
    expect(screen.queryByText(en.features.heading)).toBeNull();
  });

  it('translates the accessible names on the store badges, not only the visible copy', () => {
    renderLanding();
    fireEvent.change(screen.getAllByLabelText('Language')[0], { target: { value: 'es' } });
    expect(screen.getByLabelText(es.hero.appStoreAria)).toBeTruthy();
    expect(screen.getByAltText(es.hero.playStoreAlt)).toBeTruthy();
  });

  it('remembers the choice and tells assistive tech which language the document is in', () => {
    renderLanding();
    fireEvent.change(screen.getAllByLabelText('Language')[0], { target: { value: 'es' } });

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    // No RTL language ships yet, so `dir` must stay ltr rather than being left unset.
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('interpolates the year into the footer instead of printing the placeholder', () => {
    renderLanding();
    fireEvent.change(screen.getAllByLabelText('Language')[0], { target: { value: 'es' } });

    const year = String(new Date().getFullYear());
    const footer = screen.getByText(new RegExp(`${year}.*TRE Forged LLC`));
    expect(footer.textContent).not.toContain('{{year}}');
  });
});

describe('the two catalogues have to stay the same shape', () => {
  const leaves = (obj: unknown, prefix = ''): string[] => {
    if (typeof obj !== 'object' || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>)
      .flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  };

  it('has no key present in one locale and missing from the other', () => {
    expect(leaves(es).sort()).toEqual(leaves(en).sort());
  });

  it('has no empty string standing in for a translation', () => {
    const blanks = Object.entries({ en, es }).flatMap(([lang, cat]) =>
      leaves(cat)
        .filter(path => !String(path.split('.').reduce<unknown>((d, k) => (d as Record<string, unknown>)[k], cat)).trim())
        .map(path => `${lang}:${path}`),
    );
    expect(blanks).toEqual([]);
  });

  it('keeps the {{year}} placeholder in every locale, so no footer loses its date', () => {
    for (const cat of [en, es]) expect(cat.footer.rights).toContain('{{year}}');
  });

  it('offers every shipped locale in the switcher, so none can be unreachable', () => {
    expect(SUPPORTED_LANGUAGES.map(l => l.code).sort()).toEqual(['en', 'es']);
  });
});
