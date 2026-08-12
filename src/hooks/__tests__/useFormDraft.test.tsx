// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import {
  useFormDraft,
  readFormDraft,
  writeFormDraft,
  clearFormDraft,
  clearAllFormDrafts,
  draftStorageKey,
  DRAFT_MAX_AGE_MS,
  type FormDraft,
} from '../useFormDraft';

type Values = { name: string; amount: string };
const EMPTY: Values = { name: '', amount: '' };

/**
 * A stand-in for a page with a modal form. `remount` is how a refresh, a tab
 * close and a navigate-away all look from the hook's side: the component tree
 * is gone and a new one is built from storage alone.
 */
function Harness({ formKey = 'test', enabled = true }: { formKey?: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);

  const { restored, discard } = useFormDraft<Values>({
    formKey,
    open,
    values,
    editId,
    enabled,
    onRestore: (draft: FormDraft<Values>) => {
      setValues(draft.values);
      setEditId(draft.editId);
      setOpen(true);
    },
  });

  return (
    <div>
      <span data-testid="open">{open ? 'open' : 'closed'}</span>
      <span data-testid="name">{values.name}</span>
      <span data-testid="amount">{values.amount}</span>
      <span data-testid="editId">{editId ?? '-'}</span>
      <span data-testid="restored">{restored ? 'yes' : 'no'}</span>
      <button onClick={() => { setOpen(true); setEditId(null); setValues(EMPTY); }}>open</button>
      <button onClick={() => { setOpen(true); setEditId('acct-9'); }}>open-edit</button>
      <button onClick={() => setValues(v => ({ ...v, name: 'Chase Checking' }))}>type-name</button>
      <button onClick={() => setValues(v => ({ ...v, amount: '1234.56' }))}>type-amount</button>
      <button onClick={() => setOpen(false)}>close</button>
      <button onClick={() => { discard(); setValues(EMPTY); setEditId(null); }}>discard</button>
    </div>
  );
}

function click(label: string) {
  act(() => { screen.getByText(label).click(); });
}

describe('useFormDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => { cleanup(); });

  describe('storage helpers', () => {
    it('round-trips a draft', () => {
      writeFormDraft('acct', { name: 'x' }, 'id-1', 1000);
      expect(readFormDraft('acct', 1000)).toEqual({ values: { name: 'x' }, editId: 'id-1', savedAt: 1000 });
    });

    it('namespaces the key so drafts cannot collide with other app storage', () => {
      writeFormDraft('acct', { name: 'x' });
      expect(localStorage.getItem(draftStorageKey('acct'))).not.toBeNull();
      expect(draftStorageKey('acct')).toBe('forgenta:draft:acct');
    });

    it('treats a draft older than the max age as abandoned, and removes it', () => {
      writeFormDraft('acct', { name: 'x' }, null, 0);
      expect(readFormDraft('acct', DRAFT_MAX_AGE_MS + 1)).toBeNull();
      expect(localStorage.getItem(draftStorageKey('acct'))).toBeNull();
    });

    it('keeps a draft that is exactly at the age limit', () => {
      writeFormDraft('acct', { name: 'x' }, null, 0);
      expect(readFormDraft('acct', DRAFT_MAX_AGE_MS)).not.toBeNull();
    });

    it('discards corrupt JSON rather than throwing at the user', () => {
      localStorage.setItem(draftStorageKey('acct'), '{not json');
      expect(readFormDraft('acct')).toBeNull();
      expect(localStorage.getItem(draftStorageKey('acct'))).toBeNull();
    });

    it('discards a well-formed object that is not a draft', () => {
      localStorage.setItem(draftStorageKey('acct'), JSON.stringify({ hello: 'world' }));
      expect(readFormDraft('acct')).toBeNull();
    });

    it('clearAllFormDrafts removes every draft and nothing else', () => {
      writeFormDraft('a', { v: 1 });
      writeFormDraft('b', { v: 2 });
      localStorage.setItem('tre:debtpayoff:activeTab', '"cards"');
      clearAllFormDrafts();
      expect(readFormDraft('a')).toBeNull();
      expect(readFormDraft('b')).toBeNull();
      expect(localStorage.getItem('tre:debtpayoff:activeTab')).toBe('"cards"');
    });
  });

  describe('the survival guarantee', () => {
    it('brings typed values back after a remount — the refresh / tab-close case', () => {
      const first = render(<Harness />);
      click('open');
      click('type-name');
      click('type-amount');
      expect(screen.getByTestId('name').textContent).toBe('Chase Checking');

      // The tab goes away mid-entry. No close, no save.
      first.unmount();

      render(<Harness />);
      expect(screen.getByTestId('open').textContent).toBe('open');
      expect(screen.getByTestId('name').textContent).toBe('Chase Checking');
      expect(screen.getByTestId('amount').textContent).toBe('1234.56');
      expect(screen.getByTestId('restored').textContent).toBe('yes');
    });

    it('brings back WHICH record was being edited, not just the text', () => {
      const first = render(<Harness />);
      click('open-edit');
      click('type-name');
      first.unmount();

      render(<Harness />);
      expect(screen.getByTestId('editId').textContent).toBe('acct-9');
    });

    it('an unmount NEVER clears the draft — that is the whole point', () => {
      const first = render(<Harness />);
      click('open');
      click('type-name');
      first.unmount();
      expect(readFormDraft<Values>('test')?.values.name).toBe('Chase Checking');
    });

    it('a mount with no draft does not create one', () => {
      render(<Harness />);
      expect(localStorage.getItem(draftStorageKey('test'))).toBeNull();
      expect(screen.getByTestId('restored').textContent).toBe('no');
    });

    it('opening a form and touching nothing leaves no draft behind', () => {
      const first = render(<Harness />);
      click('open');
      expect(localStorage.getItem(draftStorageKey('test'))).toBeNull();
      first.unmount();

      // Otherwise every visit to a page where a modal was glanced at would
      // reopen that modal claiming to have restored something.
      render(<Harness />);
      expect(screen.getByTestId('open').textContent).toBe('closed');
      expect(screen.getByTestId('restored').textContent).toBe('no');
    });

    it('does not flag "restored" when there was nothing to restore', () => {
      render(<Harness />);
      click('open');
      click('type-name');
      expect(screen.getByTestId('restored').textContent).toBe('no');
    });
  });

  describe('the discard paths', () => {
    it('an explicit close clears the draft — the user said they were done', () => {
      const first = render(<Harness />);
      click('open');
      click('type-name');
      click('close');
      expect(readFormDraft('test')).toBeNull();

      first.unmount();
      render(<Harness />);
      expect(screen.getByTestId('open').textContent).toBe('closed');
      expect(screen.getByTestId('name').textContent).toBe('');
    });

    it('"start fresh" throws the restored draft away and stops claiming a restore', () => {
      const first = render(<Harness />);
      click('open');
      click('type-name');
      first.unmount();

      render(<Harness />);
      expect(screen.getByTestId('restored').textContent).toBe('yes');
      click('discard');
      expect(screen.getByTestId('restored').textContent).toBe('no');
      expect(screen.getByTestId('name').textContent).toBe('');
      expect(readFormDraft('test')).toBeNull();
    });
  });

  describe('opt-out', () => {
    it('writes nothing when disabled (demo mode)', () => {
      render(<Harness enabled={false} />);
      click('open');
      click('type-name');
      expect(localStorage.getItem(draftStorageKey('test'))).toBeNull();
    });

    it('ignores an existing draft when disabled', () => {
      writeFormDraft<Values>('test', { name: 'leftover', amount: '1' });
      render(<Harness enabled={false} />);
      expect(screen.getByTestId('open').textContent).toBe('closed');
      expect(screen.getByTestId('name').textContent).toBe('');
    });
  });

  describe('isolation between forms', () => {
    it('one page\'s draft never surfaces in another page\'s form', () => {
      const first = render(<Harness formKey="accounts" />);
      click('open');
      click('type-name');
      first.unmount();

      render(<Harness formKey="goals" />);
      expect(screen.getByTestId('open').textContent).toBe('closed');
      expect(readFormDraft<Values>('accounts')?.values.name).toBe('Chase Checking');
    });
  });

  it('clearFormDraft is a no-op on a key with no draft', () => {
    expect(() => clearFormDraft('nothing-here')).not.toThrow();
  });
});
