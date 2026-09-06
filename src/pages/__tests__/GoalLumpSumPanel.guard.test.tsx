// @vitest-environment jsdom
//
// PRESSING THE CONTROL, NOT PRINTING ITS LABEL.
//
// ⚠️ This asserts a `disabled` attribute and rendered text — no geometry, no scroll position, no
// element size — so jsdom is a legitimate harness here. The repo's standing warning is that a
// jsdom green on anything GEOMETRIC is not evidence; this is neither.
//
// ⚠️ WHY NOT A BROWSER. `GoalLumpSumPanel` renders only when `!isDemo`, so the Savings Goals page
// cannot show it in demo mode, and the dev sign-in for this desk was lost on 2026-09-05. The
// live-app check is therefore OUTSTANDING and is recorded as such rather than implied by a green
// run here.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// jest-dom's matchers are not registered in this project's vitest setup, so the DOM property is
// read directly. It is also the more literal assertion: `disabled` is what the browser acts on.
const addButton = () => screen.getByRole('button', { name: /add/i }) as HTMLButtonElement;
import { GoalLumpSumPanel } from '@/pages/SavingsGoals';
import { LUMP_SUM_AUTO_EXTRA_NOTE } from '@/lib/lump-sum-guard';

const base = {
  lumpSums: [],
  onSave: vi.fn(),
  liquidCash: 5000,
  currentAmount: 1000,
  monthlyContrib: 200,
  targetAmount: 10000,
};

describe('GoalLumpSumPanel and the auto-extra guard', () => {
  it('⚠️ DISABLES Add and explains why when the sweep is on', () => {
    render(<GoalLumpSumPanel {...base} autoExtraOn />);
    expect(addButton().disabled).toBe(true);
    expect(screen.getByText(LUMP_SUM_AUTO_EXTRA_NOTE)).toBeTruthy();
  });

  it('leaves Add usable when the sweep is off', () => {
    render(<GoalLumpSumPanel {...base} autoExtraOn={false} />);
    expect(addButton().disabled).toBe(false);
    expect(screen.queryByText(LUMP_SUM_AUTO_EXTRA_NOTE)).toBeNull();
  });

  it('⚠️ an ABSENT flag leaves it usable — never take a control away on a value you could not read', () => {
    render(<GoalLumpSumPanel {...base} />);
    expect(addButton().disabled).toBe(false);
  });

  it('does not claim "none planned yet" while the control is switched off', () => {
    // Two sentences that contradict each other — "add one" and "you cannot add one" — is how a
    // guarded empty state usually reads. It says one thing here.
    render(<GoalLumpSumPanel {...base} autoExtraOn />);
    expect(screen.queryByText(/No planned contributions yet/i)).toBeNull();
  });
});
