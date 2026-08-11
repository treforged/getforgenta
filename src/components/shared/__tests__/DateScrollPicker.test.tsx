// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import DateScrollPicker from '../DateScrollPicker';

// The bug this pins: the picker initialised its columns from `value` once and
// never synced when the parent changed it programmatically — the maintenance
// form's interval preset re-projected the due date into form state while the
// picker kept displaying the mount-time date. It also emitted onChange
// unconditionally on mount, writing a date the user never chose into an
// untouched optional field.

// jsdom implements neither smooth scrolling nor Element.scrollTo; the picker
// only uses it to animate columns, which is irrelevant to what these tests pin.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

function selectedLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.font-semibold')).map(
    el => el.textContent ?? '',
  );
}

afterEach(cleanup);

describe('DateScrollPicker', () => {
  it('displays the date it was given', () => {
    const { container } = render(
      <DateScrollPicker value="2026-08-11" onChange={() => {}} />,
    );
    expect(selectedLabels(container)).toEqual(['Aug', '11', '2026']);
  });

  it('does NOT emit onChange on mount when a value is provided', () => {
    const onChange = vi.fn();
    render(<DateScrollPicker value="2026-08-11" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('backfills today via onChange when mounted with an empty value', () => {
    const onChange = vi.fn();
    render(<DateScrollPicker value="" onChange={onChange} />);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(onChange).toHaveBeenCalledWith(today);
  });

  it('updates the displayed columns when the parent changes the value', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <DateScrollPicker value="2026-08-11" onChange={onChange} />,
    );
    act(() => {
      rerender(<DateScrollPicker value="2027-02-11" onChange={onChange} />);
    });
    expect(selectedLabels(container)).toEqual(['Feb', '11', '2027']);
    // Syncing to the parent's own value must not echo anything back —
    // an echo of the stale composed date would undo the parent's update.
    expect(onChange).not.toHaveBeenCalledWith('2026-08-11');
  });

  it('still emits when the user picks a different day', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <DateScrollPicker value="2026-08-11" onChange={onChange} />,
    );
    // Day column: click the "12" item.
    act(() => {
      getByText('12').click();
    });
    expect(onChange).toHaveBeenCalledWith('2026-08-12');
  });
});
