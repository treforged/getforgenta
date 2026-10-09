/**
 * The no-save-nudge email, as pure text (moved out of no-save-nudge/index.ts so it can be tested).
 *
 * Proposal D (Tre "yes" via Sam, 2026-10-09): the ask used to be "Finish setup" with a link to the
 * full wizard. It is now the one-minute thing: log one purchase with the + (five taps), with a link
 * that opens quick add straight away (`/dashboard?quickadd=1`, src/lib/quick-add-link.ts), and
 * adding pay as the second step. No postal line (decision 0e582396 still stands for this email).
 */

export const NUDGE_SUBJECT = "Your Forgenta plan is one minute away";

export function quickAddLink(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/dashboard?quickadd=1`;
}

/**
 * `unsubscribeUrl` is the one-click link when EMAIL_UNSUBSCRIBE_SECRET is set; without it the
 * footer keeps the reply-to-unsubscribe line, so the live nudge keeps working either way.
 */
export function buildNudgeText(appUrl: string, contact: string, unsubscribeUrl: string | null): string {
  return [
    "Hi,",
    "",
    "You made a Forgenta account, but nothing is saved in it yet.",
    "",
    "The quickest start: log one thing you bought. Press + at the bottom of the screen, pick a category, type the amount. About five taps.",
    "",
    `Add a purchase: ${quickAddLink(appUrl)}`,
    "",
    "Then add how much you get paid, and Forgenta shows how much is safe to spend before your next payday.",
    "",
    "Questions? Reply to this email. A person reads it.",
    "",
    "Tre",
    "Forgenta",
    "",
    "---",
    unsubscribeUrl
      ? `You get this email because you made a Forgenta account. Unsubscribe in one click: ${unsubscribeUrl}`
      : `You get this email because you made a Forgenta account. To stop these emails, reply with "unsubscribe" or write to ${contact}.`,
    "",
    "TRE Forged LLC",
  ].join("\n");
}
