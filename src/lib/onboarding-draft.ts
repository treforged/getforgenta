/**
 * The setup wizard's answers, kept across a page it navigates away from.
 *
 * Written for the reference-account button (2026-08-18): looking at the demo mid-setup unmounts
 * `Onboarding`, and typed work must never be thrown away — the same rule the backdrop-tap save was
 * built on. It also fixes the older, quieter version of the same loss: a refresh, a crash, or a tab
 * closed halfway through used to empty every field.
 *
 * ⚠️ The draft is STAMPED WITH THE USER ID and a mismatched stamp is ignored, never merged. A
 * shared device must not hand one person's income to the next person's wizard.
 *
 * ⚠️ Nothing here is a claim that setup happened. Completion lives in `onboarding-state.ts` and
 * only there; this is unsent input, cleared the moment the wizard finishes or is skipped.
 */

const DRAFT_KEY = 'forgenta_onboarding_draft_v1';

interface StoredDraft<T> {
  userId: string;
  data: T;
}

/** The saved answers for this user, or null — a draft for anyone else reads as no draft at all. */
export function readOnboardingDraft<T>(userId: string | undefined): T | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || parsed.userId !== userId || !parsed.data) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeOnboardingDraft<T>(userId: string | undefined, data: T): void {
  if (!userId) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ userId, data } satisfies StoredDraft<T>));
  } catch { /* a full or blocked store costs the draft, never the wizard */ }
}

export function clearOnboardingDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(STEP_KEY);
  } catch { /* ignore */ }
}

/**
 * WHERE the user was, beside WHAT they typed (ask b3f0bbcc, 2026-10-06). The draft kept the answers
 * across a reload or an app relaunch, but the wizard always reopened on Welcome - so a person on
 * Expenses who came back saw step 1 and had every reason to think their progress was gone. The one
 * real signup measured since step tracking began stopped on Expenses after leaving the app and
 * coming back through Face ID. Stamped with the user id for the same reason as the draft.
 */
const STEP_KEY = 'forgenta_onboarding_step_v1';

export function readOnboardingStep(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(STEP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: string; step?: unknown };
    return parsed?.userId === userId && typeof parsed.step === 'string' ? parsed.step : null;
  } catch {
    return null;
  }
}

export function writeOnboardingStep(userId: string | undefined, step: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(STEP_KEY, JSON.stringify({ userId, step }));
  } catch { /* a full or blocked store costs the resume point, never the wizard */ }
}
