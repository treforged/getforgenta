// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import FreeBankLinkNotice from '../FreeBankLinkNotice';

/**
 * The notice must be SILENT for everybody it is not for. Every case below that expects nothing is
 * asserting the absence of a claim about somebody's money, which is the half that actually matters:
 * telling a user with eight linked banks that their first one is free is a confident wrong
 * statement, and it would look exactly like the notice working.
 */

const state = {
  isDemo: false,
  loading: false,
  accounts: [] as Array<{ plaid_account_id: string | null; active: boolean }>,
};

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: state.accounts, loading: state.loading }),
}));

const DISMISSED_KEY = 'free-bank-link-notice-dismissed';

function renderNotice() {
  return render(
    <MemoryRouter>
      <FreeBankLinkNotice />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  state.isDemo = false;
  state.loading = false;
  state.accounts = [];
});

describe('FreeBankLinkNotice - who sees it', () => {
  it('shows for a user with no linked account', () => {
    renderNotice();
    expect(screen.getByText('Your first bank connection is free')).toBeTruthy();
    expect(screen.getByText('Connect a bank')).toBeTruthy();
  });

  it('shows for a user whose only accounts are MANUAL', () => {
    state.accounts = [{ plaid_account_id: null, active: true }];
    renderNotice();
    expect(screen.getByText('Your first bank connection is free')).toBeTruthy();
  });

  it('is SILENT for a user who already linked a bank', () => {
    state.accounts = [{ plaid_account_id: 'acc_1', active: true }];
    renderNotice();
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
  });

  it('is silent in demo, where the button would be dead', () => {
    state.isDemo = true;
    renderNotice();
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
  });

  /**
   * The flash case. Accounts arrive asynchronously, so rendering before they land would tell
   * somebody with eight linked banks that their first is free - for one frame, but wrongly.
   */
  it('is silent while accounts are still loading, rather than guessing', () => {
    state.loading = true;
    state.accounts = [];
    renderNotice();
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
  });

  it('ignores an INACTIVE linked account, which is not a live connection', () => {
    state.accounts = [{ plaid_account_id: 'acc_1', active: false }];
    renderNotice();
    expect(screen.getByText('Your first bank connection is free')).toBeTruthy();
  });
});

describe('FreeBankLinkNotice - dismissal', () => {
  it('pressing dismiss REMOVES it and records that, rather than only hiding it', () => {
    renderNotice();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    // The change a user can see...
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
    // ...and the change that makes it stay gone.
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
  });

  it('stays gone on the next mount', () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    renderNotice();
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
  });

  it('hides itself rather than crashing when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => renderNotice()).not.toThrow();
    expect(screen.queryByText('Your first bank connection is free')).toBeNull();
    spy.mockRestore();
  });
});

describe('FreeBankLinkNotice - what it claims', () => {
  it('says premium is for MORE than one, so the free link does not read as a trial', () => {
    renderNotice();
    expect(screen.getByText(/premium is for connecting more than one/i)).toBeTruthy();
  });

  it('promises no subscription, which is the whole point of the notice', () => {
    renderNotice();
    expect(screen.getByText(/with no\s+subscription/i)).toBeTruthy();
  });
});
