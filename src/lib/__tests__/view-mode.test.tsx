// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { resolveViewMode, simpleHomeWidgets, type ViewMode } from '@/lib/view-mode';
import { ViewModeSwitch } from '@/components/shared/ViewModeSwitch';
import { WIDGET_META } from '@/lib/dashboard-widgets';

describe('resolveViewMode', () => {
  it('reads only the exact string simple as Simple; null and junk are Advanced', () => {
    expect(resolveViewMode('simple')).toBe('simple');
    expect(resolveViewMode('advanced')).toBe('advanced');
    expect(resolveViewMode(null)).toBe('advanced');
    expect(resolveViewMode(undefined)).toBe('advanced');
    expect(resolveViewMode('SIMPLE')).toBe('advanced');
  });
});

describe('simpleHomeWidgets', () => {
  it('keeps the user order and drops the heavy cards', () => {
    const all = WIDGET_META.map((m) => m.id);
    const kept = simpleHomeWidgets(all);
    expect(kept).toEqual(['monthly_snapshot', 'upcoming_week', 'debt_recommendations', 'goal_progress']);
    expect(kept.length).toBeLessThan(all.length);
  });

  it('never shows a widget the user hid', () => {
    expect(simpleHomeWidgets(['goal_progress', 'net_worth_trend'])).toEqual(['goal_progress']);
  });
});

function Harness() {
  const [mode, setMode] = useState<ViewMode>('advanced');
  return (
    <>
      <ViewModeSwitch mode={mode} onChange={setMode} />
      <p data-testid="shown">{mode}</p>
    </>
  );
}

describe('ViewModeSwitch', () => {
  it('pressing Simple then Advanced moves the checked state and the mode both ways', () => {
    render(<Harness />);
    const simple = screen.getByRole('tab', { name: 'Simple' });
    const advanced = screen.getByRole('tab', { name: 'Advanced' });
    expect(advanced.getAttribute('aria-selected')).toBe('true');
    expect(simple.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(simple);
    expect(screen.getByTestId('shown').textContent).toBe('simple');
    expect(simple.getAttribute('aria-selected')).toBe('true');
    expect(advanced.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(advanced);
    expect(screen.getByTestId('shown').textContent).toBe('advanced');
    expect(advanced.getAttribute('aria-selected')).toBe('true');
  });
});
