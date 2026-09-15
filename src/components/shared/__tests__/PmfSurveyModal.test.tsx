// @vitest-environment jsdom
//
// THE SEAN ELLIS SURVEY - the presses, and the two orderings that matter.
//
// ⚠️ EVERY ASSERTION HERE IS THAT SOMETHING CHANGED, not that nothing threw. A modal whose buttons
// all resolve to the same view passes every smoke test ever written, and this portfolio has
// shipped exactly that (forged-glass's dead Conversation tab). So the follow-up case asserts the
// follow-up text is PRESENT and the question is GONE, and the non-disappointed case asserts the
// modal closed.
//
// ⚠️ AND THE `upsert` ASSERTION IS THE SUBSTANCE, NOT PLUMBING. If the sentiment write does not
// happen before the follow-up step, then everyone who picks an answer and closes the modal without
// typing is silently dropped - which biases the proportion toward people who write, not people who
// feel. That is the one defect here that would look like a working survey.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PmfSurveyModal from '../PmfSurveyModal';
import { PMF_FOLLOW_UP, PMF_QUESTION, PMF_SEEN_FLAG, PMF_SURVEY_VERSION } from '@/lib/pmf-survey';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn((_row: Record<string, unknown>, _opts?: Record<string, unknown>): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null })),
  update: vi.fn((_patch: Record<string, unknown>) => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) })),
  profileUpdate: vi.fn((_patch: Record<string, unknown>) => ({ eq: () => Promise.resolve({ error: null }) })),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/components/shared/ModalShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pmf_responses') return { upsert: mocks.upsert, update: mocks.update };
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { tour_flags: { other: true } } }) }) }),
          update: mocks.profileUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

beforeEach(() => { mocks.upsert.mockClear(); mocks.update.mockClear(); mocks.profileUpdate.mockClear(); mocks.toastError.mockClear(); });
afterEach(cleanup);

describe('PmfSurveyModal', () => {
  it('asks the Sean Ellis question with exactly the three canonical answers', () => {
    render(<PmfSurveyModal onDismiss={vi.fn()} />);
    expect(screen.getByText(PMF_QUESTION)).toBeTruthy();
    expect(screen.getAllByRole('radio').map((b) => b.textContent)).toEqual([
      'Very disappointed', 'Somewhat disappointed', 'Not disappointed',
    ]);
  });

  it('records the sentiment BEFORE the follow-up, so closing without typing still counts', async () => {
    render(<PmfSurveyModal onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText('Very disappointed'));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      user_id: 'u1', survey_version: PMF_SURVEY_VERSION, sentiment: 'very_disappointed',
    });
  });

  it('CHANGES THE VIEW for "very disappointed": the follow-up appears and the question goes', async () => {
    render(<PmfSurveyModal onDismiss={vi.fn()} />);
    expect(screen.queryByText(PMF_FOLLOW_UP)).toBeNull();
    fireEvent.click(screen.getByText('Very disappointed'));
    await waitFor(() => expect(screen.getByText(PMF_FOLLOW_UP)).toBeTruthy());
    expect(screen.queryByText(PMF_QUESTION)).toBeNull();
  });

  it('does NOT ask the follow-up of anyone else - it would collect a list from people who would miss nothing', async () => {
    const onDismiss = vi.fn();
    render(<PmfSurveyModal onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Not disappointed'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(screen.queryByText(PMF_FOLLOW_UP)).toBeNull();
  });

  it('marks the account as ASKED even when it is closed unanswered, MERGING the existing flags', async () => {
    const onDismiss = vi.fn();
    render(<PmfSurveyModal onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(mocks.upsert).not.toHaveBeenCalled();
    // The merge is the part worth asserting: rebuilding tour_flags wholesale would drop every
    // other key in it - the what's-new record, the tour steps, the derived country.
    expect(mocks.profileUpdate.mock.calls[0][0]).toEqual({
      tour_flags: { other: true, [PMF_SEEN_FLAG]: true },
    });
  });

  it('writes the free text to the row it already created, not a second row', async () => {
    render(<PmfSurveyModal onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText('Very disappointed'));
    await waitFor(() => expect(screen.getByLabelText(PMF_FOLLOW_UP)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(PMF_FOLLOW_UP), { target: { value: 'the forecast' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0]).toEqual({ would_miss: 'the forecast' });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  // ⚠️ THE REGRESSION TEST FOR THE DEFECT THAT ACTUALLY SHIPPED INTO A LIVE RUN. The modal advanced
  // to the follow-up while the write was being REFUSED (UPDATE had been revoked, and an upsert is
  // INSERT ... ON CONFLICT DO UPDATE). It looked like a working survey and recorded nothing.
  it('does NOT advance when the write is refused - a silent failure must not look like an answer', async () => {
    mocks.upsert.mockImplementationOnce(() => Promise.resolve({ error: { message: 'permission denied' } }));
    render(<PmfSurveyModal onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText('Very disappointed'));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.queryByText(PMF_FOLLOW_UP)).toBeNull();
    expect(screen.getByText(PMF_QUESTION)).toBeTruthy();
  });
});