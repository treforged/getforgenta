// @vitest-environment jsdom
//
// Tre, 2026-08-24: *"the text in the maintenance log gets cut off instead of wrapping."*
//
// The Coming Due row carried `truncate` on the service name AND `shrink-0` on the due summary,
// so at 390px the name lost every argument for space: "Transmission Fluid" rendered as
// "Transmi...". Nothing was moved or removed to fix it, per the house rule that a page which
// had the answer still has it. The row wraps instead.
//
// These assert the CLASSES rather than measured pixels on purpose: jsdom does no layout, so a
// width assertion here would be a number invented by the test. The pixel proof for this change
// is the 390x844 render, not this file. What this file can pin, and what regressed before, is
// that the truncating class is gone and the wrapping one is present.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MaintenanceLog from '../MaintenanceLog';
import type { CarMaintenanceLog } from '@/lib/types';

vi.mock('@/hooks/use-reduced-motion', () => ({ usePrefersReducedMotion: () => true }));

const log = (over: Partial<CarMaintenanceLog> & Pick<CarMaintenanceLog, 'id' | 'service'>): CarMaintenanceLog => ({
  build_id: 'b1', user_id: 'u1', service_date: '2026-08-01', odometer: 91900, cost: 148.5,
  vendor: null, notes: null, interval_months: null, interval_miles: null,
  next_due_date: null, next_due_odometer: null, created_at: '2026-08-01T00:00:00Z',
  ...over,
});

const LONG = 'Transmission Fluid and Differential Service';

function renderLog(logs: CarMaintenanceLog[]) {
  render(
    <MaintenanceLog logs={logs} transactions={[]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
  );
}

afterEach(() => { cleanup(); });

describe('MaintenanceLog - long text wraps instead of being cut off', () => {
  it('renders a long service name in full in the history row', () => {
    renderLog([log({ id: 'l1', service: LONG })]);
    const el = screen.getByText(LONG);
    expect(el.className).not.toContain('truncate');
    expect(el.className).toContain('wrap-break-word');
  });

  it('renders a long service name in full in the Coming Due row, un-truncated', () => {
    // Overdue by date, so it appears in Coming Due as well as in the history.
    renderLog([log({ id: 'l1', service: LONG, next_due_date: '2020-01-01' })]);
    const shown = screen.getAllByText(LONG);
    expect(shown.length).toBeGreaterThan(1);
    for (const el of shown) {
      expect(el.className).not.toContain('truncate');
      expect(el.className).toContain('wrap-break-word');
    }
  });

  it('lets the due summary wrap rather than pinning it at full width', () => {
    renderLog([log({ id: 'l1', service: LONG, next_due_date: '2020-01-01', next_due_odometer: 120000 })]);
    const due = screen.getAllByText(/^Due /)[0];
    // `shrink-0` is what made the name give up its space first.
    expect(due.className).not.toContain('shrink-0');
    expect(due.className).toContain('wrap-break-word');
  });

  it('keeps an unbroken vendor or note from running under the price column', () => {
    renderLog([log({ id: 'l1', service: 'Oil Change', vendor: 'A'.repeat(60), notes: 'B'.repeat(80) })]);
    expect(screen.getByText(new RegExp('A{60}')).className).toContain('wrap-break-word');
    expect(screen.getByText('B'.repeat(80)).className).toContain('wrap-break-word');
  });

  it('gives the row edit and delete buttons a 44px tap target', () => {
    renderLog([log({ id: 'l1', service: 'Oil Change' })]);
    expect(screen.getByTitle('Edit service').className).toContain('icon-btn');
    expect(screen.getByTitle('Delete service').className).toContain('icon-btn');
  });
});
