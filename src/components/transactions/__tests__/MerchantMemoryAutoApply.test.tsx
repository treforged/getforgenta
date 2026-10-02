// @vitest-environment jsdom
//
// The Dashboard runner must never run in the demo or a partner view: `setCategory` refuses both,
// and its onError would put an error toast on the Dashboard for a write nobody asked for.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ isDemo: false, isPartnerView: false, panel: vi.fn() }));

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: mocks.isDemo }) }));
vi.mock('@/contexts/ViewedProfileContext', () => ({ useViewedProfile: () => ({ isPartnerView: mocks.isPartnerView }) }));
vi.mock('@/hooks/useSupabaseData', () => ({ useSyncedTransactionReviews: () => ({ setCategory: { mutateAsync: vi.fn() } }) }));
vi.mock('../MerchantMemoryPanel', () => ({
  default: (props: { background?: boolean }) => { mocks.panel(props); return null; },
}));

import MerchantMemoryAutoApply from '../MerchantMemoryAutoApply';

beforeEach(() => { mocks.isDemo = false; mocks.isPartnerView = false; mocks.panel.mockClear(); });
afterEach(cleanup);

describe('MerchantMemoryAutoApply', () => {
  it('mounts the panel in background mode for the signed-in owner (control)', () => {
    render(<MerchantMemoryAutoApply />);
    expect(mocks.panel).toHaveBeenCalled();
    expect(mocks.panel.mock.calls[0][0]).toMatchObject({ background: true });
  });

  it('does nothing in the demo', () => {
    mocks.isDemo = true;
    render(<MerchantMemoryAutoApply />);
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it('does nothing in a partner view', () => {
    mocks.isPartnerView = true;
    render(<MerchantMemoryAutoApply />);
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});
