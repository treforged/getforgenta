// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import BuyItDialog from '../BuyItDialog';
import { toLocalDateStr } from '@/lib/scheduling';
import type { CarFund } from '@/lib/types';

// "I bought it" on a car still being saved for. /demo's Civic is planned for 2030; the dialog
// opened with Loan Start 2030-10-01 but First Payment and Interest Start a month after TODAY, so
// Confirm with the defaults untouched was refused ("Interest start date cannot be before loan
// start date"). The defaults must agree with each other.

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const base = {
  id: 'cf1', user_id: 'u1', vehicle_name: 'Civic', target_price: 28000, tax_fees: 1800,
  down_payment_goal: 5590, current_saved: 1240, saved_source: 'fixed', saved_percent: 0,
  monthly_insurance: 150, expected_apr: 5.9, loan_term_months: 60, phase: 'saving',
  loan_amount: 0, loan_start_date: null, payment_start_date: null, interest_start_date: null,
  insurance_start_date: null, actual_monthly_payment: 0, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, planned_purchase_date: null,
} as unknown as CarFund;

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const renderDialog = (cf: CarFund, onConfirm = vi.fn()) =>
  render(<BuyItDialog cf={cf} accountOptions={[]} autoLoanAccountOptions={[]} onConfirm={onConfirm} onClose={() => {}} />);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BuyItDialog date defaults', () => {
  it('a future planned purchase: first payment and interest start a month after the loan start', () => {
    renderDialog({ ...base, planned_purchase_date: '2030-10-01' } as CarFund);
    expect(field('Loan Start Date').value).toBe('2030-10-01');
    expect(field('First Payment Date').value).toBe('2030-11-01');
    expect(field('Interest Start Date').value).toBe('2030-11-01');
  });

  it('Confirm with every default untouched is accepted', () => {
    const onConfirm = vi.fn();
    renderDialog({ ...base, planned_purchase_date: '2030-10-01' } as CarFund, onConfirm);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(toast.error).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('no planned date: loan starts today, first payment a month from today (unchanged)', () => {
    renderDialog(base);
    const now = new Date();
    expect(field('Loan Start Date').value).toBe(toLocalDateStr(now));
    expect(field('First Payment Date').value).toBe(toLocalDateStr(new Date(new Date().setMonth(now.getMonth() + 1))));
  });

  it('a stored payment_start_date always wins', () => {
    renderDialog({ ...base, planned_purchase_date: '2030-10-01', payment_start_date: '2030-12-15' } as CarFund);
    expect(field('First Payment Date').value).toBe('2030-12-15');
  });
});
