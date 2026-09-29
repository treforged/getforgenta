// @vitest-environment jsdom
//
// Rule notes were cut at 300 chars at SAVE time (BudgetControl.tsx slice) with nothing on screen
// to say so - Tre's Rent note lost its tail on 2026-09-28. The field now caps typing and shows a
// live counter. These tests type into the real FormModal and assert what the user would see.
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FormModal, { type Field } from '../FormModal';

function Harness({ fields }: { fields: Field[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <FormModal
      title="Edit Rule"
      fields={fields}
      values={values}
      onChange={(k, v) => setValues(prev => ({ ...prev, [k]: v }))}
      onSave={() => {}}
      onClose={() => {}}
    />
  );
}

describe('FormModal text maxLength', () => {
  it('shows a live n/max counter that moves as the user types', () => {
    render(<Harness fields={[{ key: 'notes', label: 'Notes', type: 'text', maxLength: 300 }]} />);
    const counter = screen.getByTestId('field-notes-count');
    expect(counter.textContent).toBe('0/300');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'hello' } });
    expect(counter.textContent).toBe('5/300');
  });

  it('puts the cap on the input itself, so typing stops at the limit', () => {
    render(<Harness fields={[{ key: 'notes', label: 'Notes', type: 'text', maxLength: 300 }]} />);
    expect((screen.getByLabelText('Notes') as HTMLInputElement).maxLength).toBe(300);
  });

  it('adds no counter and no cap to a field that did not ask for one', () => {
    render(<Harness fields={[{ key: 'name', label: 'Name', type: 'text' }]} />);
    expect(screen.queryByTestId('field-name-count')).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).maxLength).toBe(-1);
  });
});
