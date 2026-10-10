// @vitest-environment jsdom
/**
 * The fast screen's bank option (2026-10-10, Tre: "part of premium is linking accounts tho").
 * - "Connect your bank" sits above the manual fields, with the free-first-link note for a free account;
 * - after a successful link: "Bank connected", the checking field goes (the bank has it), pay stays
 *   required, and a free account sees ONE Premium line that opens /premium (no price on this screen);
 * - a Premium account sees no Premium line.
 * PlaidLinkButton is stubbed to a button that reports success: the real one needs Plaid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let premium = false;
const navigate = vi.fn();
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => navigate }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.test', user_metadata: {} } }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: premium }) }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'update', 'insert']) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (r: (v: unknown) => void) => r({ data: null, error: null });
  return { supabase: { from: () => chain } };
});
vi.mock('@/components/shared/PlaidLinkButton', () => ({
  default: ({ onSuccess, label }: { onSuccess: (a: unknown[]) => void; label?: string }) => (
    <button type="button" onClick={() => onSuccess([])}>{label ?? 'Link'}</button>
  ),
}));
vi.mock('@/components/shared/AkoyaFallbackPrompt', () => ({ default: () => null }));
vi.mock('@/components/shared/ReferenceAccountButton', () => ({ default: () => null }));
vi.mock('@/components/rules/RulesFoundCard', () => ({ default: () => null }));

import Onboarding from '../Onboarding';

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/onboarding']}><Onboarding /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { localStorage.clear(); navigate.mockClear(); premium = false; });

describe('fast screen: connect your bank', () => {
  it('free account: the bank option leads, with the free-first-link note, above the manual fields', () => {
    mount();
    const bank = screen.getByTestId('quick-bank');
    expect(bank.textContent).toContain('Connect your bank');
    expect(bank.textContent).toContain('Your first one is free.');
    const pay = screen.getByLabelText('Pay per check, before tax ($)');
    expect(bank.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('quick-bank-premium')).toBeNull();
  });

  it('after a link: connected, checking hidden, pay still required, ONE Premium line to /premium, no price', () => {
    mount();
    expect(screen.getByLabelText('Money in checking right now ($)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect your bank' }));
    expect(screen.getByTestId('quick-bank-linked').textContent).toContain('Bank connected');
    expect(screen.queryByLabelText('Money in checking right now ($)')).toBeNull();
    expect((screen.getByTestId('quick-save') as HTMLButtonElement).disabled).toBe(true);
    const line = screen.getByTestId('quick-bank-premium');
    expect(line.textContent).toContain('Link more banks and cards with Premium');
    expect(line.textContent).not.toMatch(/\$|\d/);
    fireEvent.click(line);
    expect(navigate).toHaveBeenCalledWith('/premium');
  });

  it('premium account: no free note and no Premium line after linking', () => {
    premium = true;
    mount();
    expect(screen.getByTestId('quick-bank').textContent).not.toContain('Your first one is free');
    fireEvent.click(screen.getByRole('button', { name: 'Connect your bank' }));
    expect(screen.queryByTestId('quick-bank-premium')).toBeNull();
  });
});
