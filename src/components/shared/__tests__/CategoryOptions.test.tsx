// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import CategoryOptions, { categoryFieldOptions } from '../CategoryOptions';
import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/types';

/**
 * Asserts the options are IN the rendered tree, not merely that the component
 * was built - "a control constructed but never added reads as present". jsdom
 * is a fair instrument here because these are counts and text, not geometry.
 */
describe('CategoryOptions renders the whole grouped list', () => {
  afterEach(cleanup);

  const renderSelect = (node: React.ReactNode) => {
    const { container } = render(<select>{node}</select>);
    return container.querySelector('select')!;
  };

  it('renders one optgroup per group and every category exactly once', () => {
    const select = renderSelect(<CategoryOptions />);
    const groups = [...select.querySelectorAll('optgroup')];
    const options = [...select.querySelectorAll('option')];

    expect(groups.map(g => g.getAttribute('label'))).toEqual(CATEGORY_GROUPS.map(g => g.label));
    // The count is the assertion: a picker missing one option throws nothing.
    expect(options).toHaveLength(CATEGORIES.length);
    expect([...options].map(o => o.value).sort()).toEqual([...CATEGORIES].sort());
  });

  it('every option sits inside an optgroup, none loose', () => {
    const select = renderSelect(<CategoryOptions />);
    const loose = [...select.querySelectorAll('option')].filter(o => o.parentElement?.tagName !== 'OPTGROUP');
    expect(loose.map(o => o.value)).toEqual([]);
  });

  it('exclude removes exactly what it names and nothing else', () => {
    const select = renderSelect(<CategoryOptions exclude={['Income']} />);
    const values = [...select.querySelectorAll('option')].map(o => o.value);
    expect(values).not.toContain('Income');
    expect(values).toHaveLength(CATEGORIES.length - 1);
  });

  it('labels carry the emoji, so none renders a bare leading space', () => {
    const select = renderSelect(<CategoryOptions />);
    const bad = [...select.querySelectorAll('option')]
      .filter(o => o.textContent === o.value || o.textContent?.startsWith(' '));
    expect(bad.map(o => o.value)).toEqual([]);
  });

  it('categoryFieldOptions carries a group for every option', () => {
    const opts = categoryFieldOptions();
    expect(opts).toHaveLength(CATEGORIES.length);
    expect(opts.filter(o => !o.group)).toEqual([]);
  });
});
