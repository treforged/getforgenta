// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SurplusRankingSection, { type SurplusRankingSectionProps } from '../SurplusRankingSection';
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
const setLiabilityRanked = vi.hoisted(() => vi.fn());
const ranking = vi.hoisted(() => ({
  rows: [] as SurplusRankRow[],
  cards: [] as { id: string; name: string }[],
  liabilities: [] as { id: string; name: string; surplus_sort_order?: number | null }[],
  saving: false,
  loading: false,
  readOnly: false,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsTouch: () => isTouch.value,
}));

vi.mock('@/hooks/useSurplusRanking', () => ({
  useSurplusRanking: () => ({ ...ranking, commit, setCardSeparated, setLiabilityRanked }),
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

function setup(
  rows: SurplusRankRow[] = THREE,
  patch: Partial<typeof ranking> = {},
  props: SurplusRankingSectionProps = {},
) {
  Object.assign(ranking, { rows, cards: [], liabilities: [], saving: false, loading: false, readOnly: false }, patch);
  return render(<MemoryRouter><SurplusRankingSection {...props} /></MemoryRouter>);
}

beforeEach(() => {
  isTouch.value = false;
  commit.mockClear();
  setLiabilityRanked.mockClear();
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
  // ⚠️ THE ANSWER IS NOW "THE SAME ONE, EVERYWHERE" (Tre, 2026-08-26: "make the reorganizer arrows
  // instead. especially so its easier on mobile"). The desktop-only drag handle is gone: it was a
  // 16px target needing a press, a travel and a release, and it was the one control here a phone
  // could not use — so the list had two reorder gestures and only one of them was ever tested on a
  // phone. These two tests used to assert exactly that split.
  it('paints the rank buttons on a pointer device, and no drag handle', () => {
    setup();
    expect(screen.getByLabelText('Move Savings up')).not.toBeNull();
    expect(screen.getByLabelText('Move Savings down')).not.toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('paints the same rank buttons on touch', () => {
    isTouch.value = true;
    setup();
    expect(screen.getByLabelText('Move Savings up')).not.toBeNull();
    expect(screen.getByLabelText('Move Savings down')).not.toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('gives every reorder arrow the app\'s 44px tap target — the whole reason it is arrows', () => {
    setup();
    for (const label of ['Move Savings up', 'Move Savings down']) {
      expect(screen.getByLabelText(label).className).toContain('icon-btn');
    }
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

describe('SurplusRankingSection — the section is there before the list is worth ranking', () => {
  // Tre, 2026-08-24: "dont require an initial goal to show 'Where the extra money goes'. it should
  // always be there". It used to return null below two rows, so a user with no goals never saw the
  // feature and had nothing to tell them what would populate it. Only the load hides it now.
  const CARDS_ONLY = [row(CARDS_ROW_ID, 'Credit cards', 0, 'cards')];

  it('renders nothing while loading', () => {
    const { container } = setup(THREE, { loading: true });
    expect(container.firstChild).toBeNull();
  });

  it('shows the heading and the one row when the cards are all there is', () => {
    const { container } = setup(CARDS_ONLY);
    expect(screen.getByText('Where the extra money goes')).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(screen.getByText('Credit cards')).toBeTruthy();
  });

  it('says how the list grows instead of telling you to tick a box that is not there', () => {
    setup(CARDS_ONLY);
    expect(screen.getByText(/Savings goals, car funds and loans you add will show up here/)).toBeTruthy();
    expect(screen.queryByText(/Tick/)).toBeNull();
  });

  // ⚠️ Both of these assert the ROW IS THERE first. "No drag handle" is vacuously true of a
  // section that rendered nothing at all, so without that line these two passed against the very
  // gate this change removes.
  it('offers no drag handle on a single row, on a pointer device', () => {
    const { container } = setup(CARDS_ONLY);
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });

  it('offers no rank buttons on a single row, on touch', () => {
    isTouch.value = true;
    const { container } = setup(CARDS_ONLY);
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(screen.queryByLabelText('Move Credit cards up')).toBeNull();
    expect(screen.queryByLabelText('Move Credit cards down')).toBeNull();
  });

  it('still renders the section with no rows at all, minus the row', () => {
    const { container } = setup([]);
    expect(screen.getByText('Where the extra money goes')).toBeTruthy();
    expect(screen.getByText(/Savings goals, car funds and loans you add will show up here/)).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('keeps the demo read-only, rendered rather than hidden, on a single row', () => {
    setup(CARDS_ONLY, { readOnly: true });
    expect(screen.getByText('Where the extra money goes')).toBeTruthy();
    expect(screen.getByText(/use it with your own data/)).toBeTruthy();
  });

  it('brings the reorder controls back as soon as there are two rows', () => {
    isTouch.value = true;
    setup(THREE);
    expect(screen.getByText('Where the extra money goes')).toBeTruthy();
    expect(screen.getByLabelText('Move Savings up')).toBeTruthy();
    expect(screen.getByText(/Tick/)).toBeTruthy();
    expect(screen.queryByText(/Savings goals, car funds and loans you add will show up here/)).toBeNull();
  });
});

// ── NON-CC LIABILITIES ───────────────────────────────────────────────────────
//
// Tre, 2026-08-24: "other debts like student loans should operate like credit cards. they should
// also show in the reorder section for goals." A student loan is rankable, draggable and splittable
// exactly like everything else here — but it CANNOT carry an "Auto extra" checkbox, because
// `accounts` has no `auto_extra` column to persist one. `setSurplusRankAutoExtra` refuses a
// liability for that reason, so a checkbox rendered here would move on screen, write nothing, and
// silently revert on the next refetch. Being on the list IS the opt-in; the way off it is Remove.
describe('SurplusRankingSection — a student loan is a ranked row, not a checkbox', () => {
  const WITH_LOAN = [
    row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'),
    row('acct-sl', 'Student Loan', 1, 'liability'),
    row('g1', 'Savings', 2),
  ];

  it('renders the liability row with the reorder affordances the other rows get', () => {
    isTouch.value = true;
    const { container } = setup(WITH_LOAN);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('Student Loan')).toBeTruthy();
    expect(screen.getByLabelText('Move Student Loan up')).toBeTruthy();
    expect(screen.getByLabelText('Move Student Loan down')).toBeTruthy();
    // The control says what it does to the MONEY now, not the mechanic (Tre, 2026-08-27:
    // "make what that link icon does clearer"). Still the same button on the same row.
    expect(screen.getByLabelText('Share this money between Student Loan and the row above it')).toBeTruthy();
  });

  it('offers NO auto-extra toggle on the liability row, and still offers one on the goal', () => {
    setup(WITH_LOAN);
    expect(screen.queryByLabelText('Auto extra for Student Loan')).toBeNull();
    expect(screen.getByLabelText('Auto extra for Savings')).toBeTruthy();
  });

  it('says the debt is paid DOWN, not filled', () => {
    setup(WITH_LOAN);
    expect(screen.getByText(/\$500 owed · extra principal/)).toBeTruthy();
  });

  it('takes the liability off the list with Remove, without touching the order', () => {
    setup(WITH_LOAN);
    fireEvent.click(screen.getByLabelText('Take Student Loan off the ranked list'));
    expect(setLiabilityRanked).toHaveBeenCalledWith('acct-sl', false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('offers an unranked liability as a button that puts it on the list', () => {
    setup(THREE, { liabilities: [{ id: 'acct-sl', name: 'Student Loan', surplus_sort_order: null }] });
    const add = screen.getByLabelText('Add Student Loan to the ranked list');
    fireEvent.click(add);
    expect(setLiabilityRanked).toHaveBeenCalledWith('acct-sl', true);
  });

  it('does not offer one that is already ranked', () => {
    setup(WITH_LOAN, { liabilities: [{ id: 'acct-sl', name: 'Student Loan', surplus_sort_order: 1 }] });
    expect(screen.queryByLabelText('Add Student Loan to the ranked list')).toBeNull();
  });

  it('offers nothing to click in read-only demo mode', () => {
    setup(WITH_LOAN, {
      readOnly: true,
      liabilities: [{ id: 'acct-2', name: 'Mortgage', surplus_sort_order: null }],
    });
    expect(screen.queryByLabelText('Add Mortgage to the ranked list')).toBeNull();
    expect(screen.queryByLabelText('Take Student Loan off the ranked list')).toBeNull();
  });
});

// ── ALWAYS REQUIRE A SELECTION (Tre, 2026-08-26) ─────────────────────────────
//
// "always require a selection for rank credit cards. default is as one group which follows the
// method selected in debt tab." Two failures this pins: the control being HIDDEN in the state a
// user most needs it (one block, one card, nothing pulled out), and a MIXED list — some cards on
// their own, some sharing a spot — reading as a settled arrangement when it is an unanswered
// question left behind by the retired per-card control.

describe('SurplusRankingSection — the card-rank mode always asks', () => {
  it('shows the control whenever there is a card at all, including the one-block-one-card state '
    + 'that used to hide it', () => {
    setup([row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'), row('g1', 'Savings', 1)], {
      cards: [{ id: 'v', name: 'Visa' }],
    });
    expect(screen.getByText('As one group')).not.toBeNull();
    expect(screen.getByText('One row each')).not.toBeNull();
  });

  it('shows NO control for a user with no credit cards — a question about nothing', () => {
    setup(THREE, { cards: [] });
    expect(screen.queryByText('As one group')).toBeNull();
  });

  it('presses exactly one button when the list is settled', () => {
    setup([row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'), row('g1', 'Savings', 1)], {
      cards: [{ id: 'v', name: 'Visa' }],
    });
    expect(screen.getByText('As one group').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('One row each').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Choose one')).toBeNull();
  });

  it('presses NEITHER button on a mixed list, marks it "Choose one", and says the app reads an '
    + 'unanswered list as one group', () => {
    setup([
      row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'),
      row('solo', 'Discover', 1, 'card'),
      row('g1', 'Savings', 2),
    ], { cards: [{ id: 'solo', name: 'Discover' }, { id: 'blocked', name: 'Visa' }] });
    expect(screen.getByText('As one group').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('One row each').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Choose one')).not.toBeNull();
    expect(screen.getByText(/treat it as one group/)).not.toBeNull();
  });

  it('gives both mode buttons a bigger tap target than the 20px they had', () => {
    setup([row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'), row('g1', 'Savings', 1)], {
      cards: [{ id: 'v', name: 'Visa' }],
    });
    for (const label of ['As one group', 'One row each']) {
      expect(screen.getByText(label).className).toContain('min-h-[36px]');
    }
  });
});

// ── A CONTRIBUTION THAT HAS NOT STARTED FUNDS NOTHING ────────────────────────
//
// Found on live data 2026-08-27: a goal read "On track for Jul 2027" while its
// `contribution_start_date` was 2027-11-21 — four months AFTER the date it was claiming to hit —
// because the schedule credited its monthly contribution from month 0. The savings-growth chart on
// the same page had it right, so the panel and the chart said different things about one goal.
//
// Every case below is the SAME goal and the SAME money; only the start date moves.
describe('SurplusRankingSection — the verdict respects the contribution start date', () => {
  // Aug 2026. Jul 2027 is month index 11 from here, and Nov 2027 is month index 15.
  const ASOF = '2026-08-27';
  const MOVE_FUND = [
    row(CARDS_ROW_ID, 'Credit cards', 0, 'cards'),
    { ...row('g1', 'Move fund', 1), targetDate: '2027-07-01' },
  ];
  // Nothing ranked to this goal at all, so the ONLY money in the schedule is its own contribution
  // and the verdict turns purely on when that starts.
  const NO_RANKED_EXTRA = new Map([['g1', new Array(60).fill(0)]]);
  const CAPACITY = new Array(60).fill(200);

  const forStart = (startDate: string | null): SurplusRankingSectionProps => ({
    asOf: ASOF,
    autoExtraByTarget: NO_RANKED_EXTRA,
    ownMonthlyByTarget: { g1: { monthly: 100, startDate } },
    capacityByMonth: CAPACITY,
  });

  it('reads "on track" when the contribution is already running — the inert case, unchanged', () => {
    setup(MOVE_FUND, {}, forStart(null));
    // $100/mo from month 0 puts $1,200 in by Jul 2027 against $500 needed.
    expect(screen.getByText('On track for Jul 2027')).toBeTruthy();
  });

  it('reads exactly the same for a start date already passed', () => {
    setup(MOVE_FUND, {}, forStart('2020-01-01'));
    expect(screen.getByText('On track for Jul 2027')).toBeTruthy();
  });

  it('does NOT read "on track" when the contribution starts after the target date', () => {
    setup(MOVE_FUND, {}, forStart('2027-11-21'));
    expect(screen.queryByText('On track for Jul 2027')).toBeNull();
    // Nothing lands before Nov 2027 (index 15), so $500 is reached at index 19 — eight months past
    // the Jul 2027 deadline, with the whole $500 still missing on the day it was wanted.
    expect(screen.getByText('8 months late — $500 short at Jul 2027')).toBeTruthy();
  });

  it('withholds only the months BEFORE the start, not the contribution itself', () => {
    // Same goal, start date one month out. It still lands well before Jul 2027, so a fix that
    // simply dropped the contribution whenever a start date existed would fail here.
    setup(MOVE_FUND, {}, forStart('2026-09-01'));
    expect(screen.getByText('On track for Jul 2027')).toBeTruthy();
  });

  // The banner and the rows share ONE schedule (`inputsById`) precisely so they cannot disagree;
  // these two pin that the start date reaches both of them and not just the row.
  it('stays silent in the banner while the goal is genuinely on track', () => {
    setup(MOVE_FUND, {}, forStart(null));
    expect(screen.queryByText(/does not reach its own date/)).toBeNull();
  });

  it('prices the same shortfall in the banner as the row it sits above', () => {
    setup(MOVE_FUND, {}, forStart('2027-11-21'));
    expect(screen.getByText('1 target does not reach its own date — $500 short in total.')).toBeTruthy();
  });
});
