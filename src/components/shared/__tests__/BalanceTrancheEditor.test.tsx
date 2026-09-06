// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import BalanceTrancheEditor from '../BalanceTrancheEditor';
import { tranchesToRows, type TrancheFormRow } from '@/lib/tranche-form';

// DateScrollPicker animates its columns with scrollTo, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

afterEach(cleanup);

const STORED = [{
  id: 'discover-bt-2026-06',
  label: 'Prime Visa transfer',
  balance: 5037.73,
  apr: 7.99,
  promo_end_date: '2028-01-04',
}];

function inputsOf(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input'));
}

describe('BalanceTrancheEditor', () => {
  it('renders a stored tranche back into its boxes', () => {
    const { container } = render(
      <BalanceTrancheEditor rows={tranchesToRows(STORED)} onChange={() => {}} accountBalance="10316.73" />,
    );
    // label, balance, apr, min_payment, monthly_fee, then the fixed-term checkbox (whose value
    // attribute is the browser default 'on' whether or not it is ticked). The last two arrived
    // 2026-09-06 with the Pay Over Time fields.
    expect(inputsOf(container).map(i => i.value)).toEqual(
      ['Prime Visa transfer', '5037.73', '7.99', '', '', 'on'],
    );
    expect(screen.getByText('Tier 1')).toBeTruthy();
  });

  it('adds a blank row and removes an existing one', () => {
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    const rows = tranchesToRows(STORED);
    const { rerender } = render(
      <BalanceTrancheEditor rows={rows} onChange={onChange} accountBalance="10316.73" />,
    );

    fireEvent.click(screen.getByText('Add Rate Tier'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(2);
    expect(added[1].balance).toBe('');

    rerender(<BalanceTrancheEditor rows={added} onChange={onChange} accountBalance="10316.73" />);
    fireEvent.click(screen.getByLabelText('Remove tier 1'));
    expect(onChange.mock.calls[1][0]).toEqual([added[1]]);
  });

  it('edits one row without touching its neighbour', () => {
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    const rows: TrancheFormRow[] = [
      { id: 'a', label: 'BT', balance: '100', apr: '0', promo_end_date: '', min_payment: '', monthly_fee: '', fixed_term: false },
      { id: 'b', label: 'Purchases', balance: '200', apr: '16.6', promo_end_date: '', min_payment: '', monthly_fee: '', fixed_term: false },
    ];
    const { container } = render(
      <BalanceTrancheEditor rows={rows} onChange={onChange} accountBalance="300" />,
    );
    // ⚠️ SELECTED BY VALUE, NOT BY INDEX. This line used to read `inputsOf(container)[5]`,
    // computed from four inputs per row — and adding the Pay Over Time fields silently moved it
    // onto a different box. A positional index into a form is a test that breaks for a reason
    // unrelated to what it checks.
    const rowTwoBalance = inputsOf(container).find(i => i.value === '200')!;
    fireEvent.change(rowTwoBalance, { target: { value: '250' } });
    expect(onChange.mock.calls[0][0]).toEqual([
      rows[0], { ...rows[1], balance: '250' },
    ]);
  });

  it('shows the soft note ONLY when the tiers outrun the balance, and never blocks', () => {
    const rows = tranchesToRows(STORED);
    const { rerender } = render(
      <BalanceTrancheEditor rows={rows} onChange={() => {}} accountBalance="10316.73" />,
    );
    expect(screen.queryByTestId('tranche-overage-note')).toBeNull();

    rerender(<BalanceTrancheEditor rows={rows} onChange={() => {}} accountBalance="5000" />);
    const note = screen.getByTestId('tranche-overage-note');
    expect(note.textContent).toContain('$5,037.73');
    expect(note.textContent).toContain('$5,000.00');
    // A note, not a barrier: nothing here is disabled and the rows stay editable.
    expect(note.querySelectorAll('button')).toHaveLength(0);
  });

  it('a blank balance box raises no false alarm', () => {
    render(<BalanceTrancheEditor rows={tranchesToRows(STORED)} onChange={() => {}} accountBalance="" />);
    expect(screen.queryByTestId('tranche-overage-note')).toBeNull();
  });
});

// ── THE PAY OVER TIME CONTROLS, PRESSED ────────────────────────────────────────────────────────
//
// ⚠️ `monthly_fee` and `fixed_term` existed on the stored shape, were parsed, were normalised and
// had their own test file — and had NO INPUT, so a Chase Pay Over Time fee could not be entered at
// all and `tranche-form.ts` would have erased one written by hand. This asserts the controls exist
// AND that typing in them reaches `onChange`; rendering a box that changes nothing is the failure
// mode this repo keeps meeting.
//
// jsdom is legitimate here: a value, a checkbox and a callback. No geometry.

describe('the Pay Over Time fields', () => {
  const rowsWith = (over: Partial<TrancheFormRow> = {}): TrancheFormRow[] => ([{
    id: 'a', label: 'PayPal Zettle', balance: '1322.50', apr: '0',
    promo_end_date: '', min_payment: '124.06', monthly_fee: '', fixed_term: false, ...over,
  }]);

  const feeBox = () => screen.getByPlaceholderText('e.g. 13.85') as HTMLInputElement;
  const fixedTermBox = () => screen.getByRole('checkbox') as HTMLInputElement;

  it('⚠️ typing a fee reaches onChange — the control is not decorative', () => {
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    render(<BalanceTrancheEditor rows={rowsWith()} onChange={onChange} accountBalance="1322.50" />);
    fireEvent.change(feeBox(), { target: { value: '13.85' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].monthly_fee).toBe('13.85');
  });

  it('⚠️ ticking fixed term sends a BOOLEAN, not the string "true"', () => {
    // Every other field on a row is a string. Sending "true" here would sit in the payload as a
    // truthy string that `parseTranches` reads as `!== true` — false — and the flag would silently
    // never take effect.
    const onChange = vi.fn<(rows: TrancheFormRow[]) => void>();
    render(<BalanceTrancheEditor rows={rowsWith()} onChange={onChange} accountBalance="1322.50" />);
    fireEvent.click(fixedTermBox());
    expect(onChange.mock.calls[0][0][0].fixed_term).toBe(true);
  });

  it('shows a stored fee rather than an empty box', () => {
    render(<BalanceTrancheEditor rows={rowsWith({ monthly_fee: '13.85', fixed_term: true })}
      onChange={vi.fn()} accountBalance="1322.50" />);
    expect(feeBox().value).toBe('13.85');
    expect(fixedTermBox().checked).toBe(true);
  });

  it('says out loud that a 0% plan with a fee is not free', () => {
    // A disabled-looking number box with no explanation is how somebody enters the instalment here
    // by mistake. The two fields are different money and the copy has to say so.
    render(<BalanceTrancheEditor rows={rowsWith()} onChange={vi.fn()} accountBalance="1322.50" />);
    expect(screen.getByText(/A 0% plan\s+with a fee is not free/i)).toBeTruthy();
  });
});
