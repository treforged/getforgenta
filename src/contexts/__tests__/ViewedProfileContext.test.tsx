// @vitest-environment jsdom
/**
 * The partner-view lens (docs/partner-linking-design.md §2). The properties under test are
 * the SECURITY properties, not the ergonomics:
 *
 *  - default is ALWAYS self — a fresh mount can never open on someone else's money;
 *  - the lens is session-scoped React state and never touches device persistence
 *    (source-locked below, because a regression here survives every behavioural test);
 *  - an account change (sign-out, different user) resets the lens;
 *  - demo mode cannot enter partner view at all.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/react';

let USER_ID: string | undefined = 'owner-1';
let isDemo = false;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: USER_ID ? { id: USER_ID } : null, loading: false }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo }) }));

import { ViewedProfileProvider, useViewedProfile } from '../ViewedProfileContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ViewedProfileProvider>{children}</ViewedProfileProvider>
);

beforeEach(() => {
  USER_ID = 'owner-1';
  isDemo = false;
});

describe('ViewedProfileContext — the read lens', () => {
  it('defaults to self: viewedUserId is the signed-in user, isPartnerView false', () => {
    const { result } = renderHook(() => useViewedProfile(), { wrapper });
    expect(result.current.viewedUserId).toBe('owner-1');
    expect(result.current.isPartnerView).toBe(false);
  });

  it('switchTo points the lens at the partner; switchBack returns it to self', () => {
    const { result } = renderHook(() => useViewedProfile(), { wrapper });
    act(() => result.current.switchTo('partner-2'));
    expect(result.current.viewedUserId).toBe('partner-2');
    expect(result.current.isPartnerView).toBe(true);
    act(() => result.current.switchBack());
    expect(result.current.viewedUserId).toBe('owner-1');
    expect(result.current.isPartnerView).toBe(false);
  });

  it('switching to your own id (or an empty id) is not partner view', () => {
    const { result } = renderHook(() => useViewedProfile(), { wrapper });
    act(() => result.current.switchTo('owner-1'));
    expect(result.current.isPartnerView).toBe(false);
    act(() => result.current.switchTo(''));
    expect(result.current.isPartnerView).toBe(false);
    expect(result.current.viewedUserId).toBe('owner-1');
  });

  it('a user change resets the lens to self — the lens never survives an account switch', () => {
    const { result, rerender } = renderHook(() => useViewedProfile(), { wrapper });
    act(() => result.current.switchTo('partner-2'));
    expect(result.current.isPartnerView).toBe(true);
    USER_ID = 'owner-9';
    rerender();
    expect(result.current.isPartnerView).toBe(false);
    expect(result.current.viewedUserId).toBe('owner-9');
  });

  it('demo mode cannot enter partner view', () => {
    isDemo = true;
    const { result } = renderHook(() => useViewedProfile(), { wrapper });
    act(() => result.current.switchTo('partner-2'));
    expect(result.current.isPartnerView).toBe(false);
  });

  it('without a provider the default context fails closed (no partner view, no viewed id)', () => {
    const { result } = renderHook(() => useViewedProfile());
    expect(result.current.viewedUserId).toBeUndefined();
    expect(result.current.isPartnerView).toBe(false);
  });

  it('SOURCE LOCK: the lens is session-scoped — no device persistence of any kind', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/contexts/ViewedProfileContext.tsx'),
      'utf8',
    );
    // Comments mention these words on purpose (they explain the rule), so strip comments first.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|usePersistedState|@capacitor\/preferences/);
  });
});
