import { describe, it, expect } from 'vitest';
import { relinkPrompt, brokenLinkItems, type RelinkPromptInput } from '../relink-prompt';

const healthy: RelinkPromptInput = {
  provider: 'plaid', connectionStatus: 'active',
  neverSynced: false, noAccounts: false, missingLiabilities: false, consentRequired: false,
};

describe('relinkPrompt', () => {
  it('a healthy Plaid link shows no prompt', () => {
    expect(relinkPrompt(healthy)).toBeNull();
  });

  it('reauth_required says syncing has stopped, even when everything else looks fine', () => {
    expect(relinkPrompt({ ...healthy, connectionStatus: 'reauth_required' })).toEqual({
      message: 'Your bank asked you to sign in again. Balances stop updating until you re-link.',
      label: 'Re-link',
    });
  });

  it('a failed sync says the balances may be stale', () => {
    expect(relinkPrompt({ ...healthy, connectionStatus: 'error' })?.message)
      .toBe('The last sync failed. Balances may be out of date - re-link to try again.');
  });

  it('a broken link outranks a statement-consent request', () => {
    const p = relinkPrompt({ ...healthy, connectionStatus: 'reauth_required', consentRequired: true });
    expect(p?.label).toBe('Re-link');
  });

  it('keeps the earlier prompts unchanged', () => {
    expect(relinkPrompt({ ...healthy, neverSynced: true })?.message).toBe('Sync pulled no accounts — re-link to try again.');
    expect(relinkPrompt({ ...healthy, consentRequired: true })?.label).toBe('Allow statement data');
    expect(relinkPrompt({ ...healthy, noAccounts: true, consentRequired: true })?.label).toBe('Re-link');
    expect(relinkPrompt({ ...healthy, missingLiabilities: true })?.message)
      .toBe('Re-link to auto-populate APR and minimum payment from your bank.');
  });

  it('Akoya never gets a re-link prompt (update mode is Plaid-only)', () => {
    expect(relinkPrompt({ ...healthy, provider: 'akoya', connectionStatus: 'reauth_required' })).toBeNull();
  });
});

describe('brokenLinkItems', () => {
  it('keeps only Plaid rows that need a sign-in or failed, and never mutates the input', () => {
    const items = [
      { id: 'a', provider: 'plaid', connection_status: 'active' as const },
      { id: 'b', provider: 'plaid', connection_status: 'reauth_required' as const },
      { id: 'c', provider: 'plaid', connection_status: 'error' as const },
      { id: 'd', provider: 'akoya', connection_status: 'reauth_required' as const },
    ];
    expect(brokenLinkItems(items).map(i => i.id)).toEqual(['b', 'c']);
    expect(items).toHaveLength(4);
  });
});
