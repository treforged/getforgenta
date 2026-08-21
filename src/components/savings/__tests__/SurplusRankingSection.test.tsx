// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SurplusRankingSection from '../SurplusRankingSection';
import { CARDS_ROW_ID, type SurplusRankRow } from '@/lib/surplus-ranking';

// The reorder animation itself cannot be asserted here — jsdom has no layout, so framer's
// `layout="position"` measures nothing and writes no transform. What CAN regress quietly, and
// what actually caused the judder Tre reported, is the CLASSNAME: the row used to carry
// `transition-all`, which includes `transform`, so the CSS transition fought framer's per-frame
// transform writes for the same property. That is a pure string and it is pinned below.
//
// The rest of the file pins the surface the arrows live on: touch gets the two rank buttons,
// a pointer gets the drag handle instead, and read-only (demo) gets neither.

const isTouch = vi.hoisted(() => ({ value: false }));
const commit = vi.hoisted(() => vi.fn());
const setCardSeparated = vi.hoisted(() => vi.fn());
const ranking = vi.hoisted(() => ({
  rows: [] as SurplusRankRow[],
  cards: [] as { id: string; name: string }[],
  saving: false,
  loading: false,
  readOnly: false,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsTouch: () => isTouch.value,
}));

vi.mock('@/hooks/useSurplusRanking', () => ({
  useSurplusRanking: () => ({ ...ranking, commit, setCardSeparated }),
}));

const row = (id: string, name: string, sortOrder: number, kind: SurplusRankRow['kind'] = 'goal'): SurplusRankRow => ({
  id,
  kind,
  name,
  sortOrder,
  autoExtra: false,
  remaining: kind === 'cards' ? null : 500,
  share: null,
  targetAmount: null,
  targetDate: null,
  createdAt: '2026-01-01T00:00:00Z',
});

const THREE = [
  row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'),
  row('g1', 'Savings', 1),
  row('g2', 'Roth IRA', 2),
];

function setup(rows: SurplusRankRow[] = THREE, patch: Partial<typeof ranking> = {}) {
  Object.assign(ranking, { rows, cards: [], saving: false, loading: false, readOnly: false }, patch);
  return render(<MemoryRouter><SurplusRankingSection /></MemoryRouter>);
}

beforeEach(() => {
  isTouch.value = false;
  commit.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('SurplusRankingSection — the row transition never widens back to `transition-all`', () => {
  it('does not put `transition-all` on any row, on pointer', () => {
    const { container } = setup();
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    for (const li of items) expect(li.className).not.toContain('transition-all');
  });

  it('does not put `transition-all` on any row, on touch', () => {
    isTouch.value = true;
    const { container } = setup();
    for (const li of container.querySelectorAll('li')) {
      expect(li.className).not.toContain('transition-all');
    }
  });

  it('keeps a narrowed transition that names no transform-adjacent property', () => {
    const { container } = setup();
    const li = container.querySelector('li')!;
    expect(li.className).toContain('transition-[background-color,border-color,box-shadow,opacity]');
    expect(li.className).not.toContain('transform');
  });
});

describe('SurplusRankingSection — which reorder control each input type gets', () => {
  it('paints the drag handle and no rank buttons on a pointer device', () => {
    setup();
    expect(screen.queryByLabelText('Move Savings up')).toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(3);
  });

  it('paints the rank buttons and no drag handle on touch', () => {
    isTouch.value = true;
    setup();
    expect(screen.getByLabelText('Move Savings up')).not.toBeNull();
    expect(screen.getByLabelText('Move Savings down')).not.toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('disables up on the first row and down on the last', () => {
    isTouch.value = true;
    setup();
    expect(screen.getByLabelText('Move Credit cards up')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Move Roth IRA down')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Move Savings up')).toHaveProperty('disabled', false);
  });

  it('commits a reordered list when a rank button is tapped', () => {
    isTouch.value = true;
    setup();
    fireEvent.click(screen.getByLabelText('Move Savings up'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].map((r: SurplusRankRow) => r.name))
      .toEqual(['Savings', 'Credit cards', 'Roth IRA']);
  });

  it('offers no reorder control at all in read-only demo mode', () => {
    isTouch.value = true;
    setup(THREE, { readOnly: true });
    expect(screen.queryByLabelText('Move Savings up')).toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });
});

describe('SurplusRankingSection — it stays hidden until there is a priority to express', () => {
  it('renders nothing while loading', () => {
    const { container } = setup(THREE, { loading: true });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the cards are the only row', () => {
    const { container } = setup([row(CARDS_ROW_ID, 'Credit cards', 0, 'cards')]);
    expect(container.firstChild).toBeNull();
  });
});
