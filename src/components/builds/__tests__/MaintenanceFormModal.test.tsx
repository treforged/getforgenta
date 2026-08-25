// @vitest-environment jsdom
//
// Two of Tre's 2026-08-24 notes land on this one modal:
//
//   *"the dropdown for logging service isnt selectable if the keyboard is up."*
//   *"make the odometer optional if it isnt already."*
//
// The dropdown was a native `<datalist>`, drawn by the platform rather than by the page, so
// nothing here could position it, size it or lift it above a software keyboard. It is now
// ordinary DOM inside the modal's own scrollable body. The test that keeps it that way is the
// one asserting NO datalist survives: a well-meaning "restore the native autocomplete" would
// silently bring the unreachable popup back.
//
// The odometer turned out to be optional already, so what is pinned here is the guarantee
// rather than a change: a service can be saved with the odometer cleared, and it reaches
// `onSave` as null rather than 0. A zero would be a reading nobody took.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import MaintenanceFormModal, { type MaintenanceFormValues } from '../MaintenanceFormModal';

// jsdom implements neither smooth scrolling nor Element.scrollTo, and the modal mounts two
// `DateScrollPicker`s. Same stub `DateScrollPicker.test.tsx` uses.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

function open(over: Partial<React.ComponentProps<typeof MaintenanceFormModal>> = {}) {
  const onSave = vi.fn();
  render(
    <MaintenanceFormModal
      open log={null} lastOdometer={91900} transactions={[]} paymentSourceOptions={[]}
      onClose={vi.fn()} onSave={onSave} {...over}
    />,
  );
  return { onSave };
}

const serviceInput = () => screen.getByRole('combobox') as HTMLInputElement;
const presetList = () => document.getElementById('maintenance-service-presets');
const submit = () => screen.getByRole('button', { name: /^log service$/i });

/** A labelled number field, by its uppercase label text. */
function numberField(label: string): HTMLInputElement {
  const el = screen.getByText(label);
  const input = el.parentElement?.querySelector('input');
  if (!input) throw new Error(`${label} input not found`);
  return input as HTMLInputElement;
}

afterEach(() => { cleanup(); });

describe('MaintenanceFormModal - the service picker is page DOM, not a platform popup', () => {
  it('renders no <datalist> at all', () => {
    open();
    expect(document.querySelectorAll('datalist').length).toBe(0);
    expect(serviceInput().getAttribute('list')).toBeNull();
  });

  it('shows the suggestions immediately on a new entry', () => {
    open();
    const list = presetList();
    expect(list).not.toBeNull();
    expect(within(list!).getByText('Oil Change')).toBeTruthy();
  });

  it('starts closed when EDITING an existing entry, whose service is already chosen', () => {
    open({
      log: {
        id: 'l1', build_id: 'b1', user_id: 'u1', service: 'Oil Change', service_date: '2026-08-01',
        odometer: 90000, cost: 62, vendor: null, notes: null, interval_months: 6,
        interval_miles: 5000, next_due_date: null, next_due_odometer: null,
        created_at: '2026-08-01T00:00:00Z',
      },
    });
    expect(presetList()).toBeNull();
  });

  it('reopens on a tap even when the field already holds focus', () => {
    open();
    expect(presetList()).not.toBeNull();
    fireEvent.keyDown(serviceInput(), { key: 'Escape' });
    expect(presetList()).toBeNull();
    // A tap on an already-focused input fires no focus event, and the field is `autoFocus`ed,
    // so `onClick` is the only thing that can bring the list back without typing.
    fireEvent.click(serviceInput());
    expect(presetList()).not.toBeNull();
  });

  it('suggests nothing once the text matches no preset, rather than a stale list', () => {
    open();
    fireEvent.change(serviceInput(), { target: { value: 'Rebuild the diff' } });
    expect(presetList()).toBeNull();
  });

  it('filters as you type and still applies the preset intervals when one is picked', () => {
    open();
    fireEvent.change(serviceInput(), { target: { value: 'brake' } });
    const labels = [...presetList()!.querySelectorAll('button')].map(b => b.textContent ?? '');
    expect(labels.some(l => l.includes('Brake Pads'))).toBe(true);
    expect(labels.some(l => l.includes('Oil Change'))).toBe(false);

    fireEvent.click(within(presetList()!).getByText('Brake Pads'));
    expect(serviceInput().value).toBe('Brake Pads');
    // Brake Pads is 30,000 miles with no month interval (src/lib/car-maintenance.ts).
    expect(numberField('Every (miles)').value).toBe('30000');
    // Picking closes the list rather than leaving one redundant suggestion behind.
    expect(presetList()).toBeNull();
  });

  it('keeps every option a 44px tap target', () => {
    open();
    for (const b of presetList()!.querySelectorAll('button')) {
      expect(b.className).toContain('min-h-[44px]');
    }
  });
});

describe('MaintenanceFormModal - the odometer is optional', () => {
  it('does not mark the odometer required, and only marks the service', () => {
    open();
    expect(screen.getByText('Service *')).toBeTruthy();
    expect(screen.getByText('Odometer').textContent).toBe('Odometer');
    expect(numberField('Odometer').required).toBe(false);
  });

  it('saves with the odometer cleared, as null and never 0', () => {
    const { onSave } = open();
    fireEvent.change(serviceInput(), { target: { value: 'Coolant top-up' } });
    fireEvent.change(numberField('Odometer'), { target: { value: '' } });
    fireEvent.click(submit());

    expect(onSave).toHaveBeenCalled();
    const values = onSave.mock.calls[0][0] as MaintenanceFormValues;
    expect(values.service).toBe('Coolant top-up');
    expect(values.odometer).toBeNull();
    expect(values.cost).toBeNull();
    expect(values.next_due_odometer).toBeNull();
  });

  it('still refuses to save with no service, which is the one required field', () => {
    const { onSave } = open();
    fireEvent.change(serviceInput(), { target: { value: '' } });
    fireEvent.click(submit());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Service is required')).toBeTruthy();
  });
});
