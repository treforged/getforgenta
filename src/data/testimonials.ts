/**
 * Approved testimonials shown on the landing page (ask 4f473837).
 *
 * ⚠️ REAL AND CONSENTED ONLY. Every entry comes from a submission Ruby reviewed, with the person's
 * written consent to publish their words and the name shown. Never write, edit or "tidy" a quote:
 * a changed quote is an invented review. This list is EMPTY until the first approval, and the
 * landing page shows nothing while it is.
 *
 * `rewarded: true` means the person received the testimonial reward (3 free months of Premium,
 * grant_testimonial_reward, ask a868f7c3). The page then shows a disclosure under the quote,
 * because the FTC Endorsement Guides require it for any review given in exchange for something.
 */

export interface Testimonial {
  /** Stable id, e.g. the submission reference. */
  id: string;
  /** Their words, verbatim. */
  quote: string;
  /** The name they agreed to show (first name + last initial is fine). */
  name: string;
  /** True when they received the free-months reward. Drives the disclosure. */
  rewarded: boolean;
}

export const TESTIMONIALS: readonly Testimonial[] = [];
