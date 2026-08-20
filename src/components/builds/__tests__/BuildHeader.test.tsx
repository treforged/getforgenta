// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BuildHeader from '../BuildHeader';
import type { CarBuild, CarBuildPhase, CarBuildItem } from '@/lib/types';

// The header's Total Budget is the largest figure on /builds, and it is the one
// the animation brief actually named. It was missed on the first pass — the
// evidence capture sampled it, found a number that never moved, and reported
// "reduced motion is not honoured" when what it had really found was a total
// still rendered as a plain string.
//
// So this file pins the two things that would let that regress quietly: that
// the number goes through CountUp at all, and that doing so did not cost the
// honesty guarantee — the accessible value is the true total, never a frame of
// the count.

vi.mock('@/hooks/use-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

const build: CarBuild = {
  id: 'b1',
  user_id: 'u1',
  name: 'Project Ledger',
  year: 2016,
  make: 'Subaru',
  model: 'WRX',
  notes: null,
  sort_order: 0,
  share_token: null,
  maintenance_public: false,
  pricing_public: true,
  photos: null,
  car_fund_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

const phase = (id: string, hidden = false): CarBuildPhase => ({
  id,
  build_id: 'b1',
  user_id: 'u1',
  title: id,
  sort_order: 0,
  hidden,
  created_at: '2026-01-01T00:00:00Z',
});

const item = (id: string, phase_id: string, price: number | null): CarBuildItem => ({
  id,
  phase_id,
  build_id: 'b1',
  user_id: 'u1',
  name: id,
  brand: null,
  price,
  link: null,
  completed: false,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
});

afterEach(() => {
  cleanup();
});

describe('BuildHeader — the total counts, and the accessible value stays true', () => {
  it('renders the total through CountUp', () => {
    render(<BuildHeader build={build} phases={[phase('p1')]} items={[item('i1', 'p1', 1200)]} />);
    expect(screen.getByTestId('count-up')).not.toBeNull();
  });

  it('exposes the real total to assistive tech from the first frame', () => {
    render(
      <BuildHeader
        build={build}
        phases={[phase('p1')]}
        items={[item('i1', 'p1', 1200), item('i2', 'p1', 340)]}
      />,
    );

    // Not "$0", and not a frame of the count. A screen reader user is told what
    // the build costs, immediately.
    expect(screen.getByTestId('count-up').getAttribute('aria-label')).toBe('$1,540');
    expect(screen.getByTestId('count-up').getAttribute('data-count-value')).toBe('1540');
  });

  it('counts only the items in visible phases, as the figure always has', () => {
    render(
      <BuildHeader
        build={build}
        phases={[phase('p1'), phase('p2', true)]}
        items={[item('i1', 'p1', 1000), item('i2', 'p2', 9999)]}
      />,
    );
    expect(screen.getByTestId('count-up').getAttribute('aria-label')).toBe('$1,000');
  });

  it('leaves the TBD caveat outside the counter', () => {
    // Interpolating toward a caveat is meaningless, and a priceless item must
    // not silently read as $0 in the total.
    render(
      <BuildHeader
        build={build}
        phases={[phase('p1')]}
        items={[item('i1', 'p1', 500), item('i2', 'p1', null)]}
      />,
    );
    expect(screen.getByTestId('count-up').getAttribute('aria-label')).toBe('$500');
    expect(screen.getByText('+ TBD items')).not.toBeNull();
  });
});
