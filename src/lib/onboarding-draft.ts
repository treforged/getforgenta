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
  } catch { /* ignore */ }
}
