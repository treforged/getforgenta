// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

/**
 * First-run walk, 2026-10-01: a brand-new user landed on the dashboard to a "Settings saved" toast.
 * One source was this dialog's SILENT branch, which records the release as seen for a user who has
 * not onboarded yet. A silent bookkeeping write must use the quiet mutation, never the toasting one.
 */
const quiet = vi.fn();
const loud = vi.fn();
const profile = { onboarding_completed: false, tour_flags: {} as Record<string, boolean> };

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: profile, loading: false, update: { mutate: loud }, updateQuiet: { mutate: quiet } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? '' }) }));

import { WhatsNewDialog } from '../WhatsNewDialog';
import { CURRENT_RELEASE, whatsNewFlag } from '@/lib/whats-new';

beforeEach(() => { quiet.mockClear(); loud.mockClear(); });

describe("What's New silent branch (first-run toast)", () => {
  it('records the release for a not-yet-onboarded user through the QUIET write', async () => {
    render(<WhatsNewDialog />);
    await waitFor(() => expect(quiet).toHaveBeenCalledWith({ tour_flags: { [whatsNewFlag(CURRENT_RELEASE.version)]: true } }));
    expect(loud).not.toHaveBeenCalled();
  });
});
