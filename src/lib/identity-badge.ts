/**
 * WHOSE MONEY AM I LOOKING AT.
 *
 * ⚠️ NOTHING IN THE CHROME ANSWERED THIS UNTIL 2026-09-06. There was no avatar, no account
 * indicator and no initials component anywhere in `src/` — verified by grep, not by memory. On
 * one's own account that is a small cost. **In partner view it is not**: the app renders somebody
 * else's finances with the same layout, the same colours and the same numbers formatting, and the
 * only thing distinguishing them was a banner a person had to notice. `docs/navigation-jakobs-law.md`
 * ranks this first of five, by encounters per session rather than by how wrong it is.
 *
 * ── IT NEVER INVENTS A NAME ──────────────────────────────────────────────────
 * ⚠️ The whole value of this badge is that it is TRUE. A label the app guessed is worse than no
 * label, because a person reads a guess as a fact and a wrong identity on a finance screen is the
 * single most expensive thing this chrome can say. So when there is nothing real to show, the
 * result carries `known: false` and a deliberately non-committal label — never a placeholder name,
 * never an email split into a plausible-looking first name.
 *
 * ── INITIALS COME FROM A NAME, OR FROM AN EMAIL, IN THAT ORDER ───────────────
 * An email's local part is a real, self-chosen string, so its first character is honest. It is not
 * a name, though, so it never becomes the LABEL — only the initials, where a single letter cannot
 * be misread as somebody's identity.
 */

export type IdentityKind = 'own' | 'partner' | 'demo';

export interface IdentityInput {
  isDemo: boolean;
  isPartnerView: boolean;
  /** `usePartnerLinkStatus().partnerLabel` — null when the partner has set no display name. */
  partnerLabel?: string | null;
  /** The signed-in user's own `profiles.display_name`. */
  displayName?: string | null;
  /** The signed-in user's auth email. Used for INITIALS only, never for the label. */
  email?: string | null;
}

export interface ResolvedIdentity {
  /** What the badge says. Short enough for a 44px control at 390px. */
  label: string;
  /** One or two characters. Empty string when there is nothing honest to derive one from. */
  initials: string;
  kind: IdentityKind;
  /** False when no real name was available — the label is a fallback, not somebody's name. */
  known: boolean;
  /** The accessible name, which spells out the relationship the two-letter badge cannot. */
  title: string;
}

/** Trim, collapse whitespace, and treat an all-whitespace string as absent. */
function clean(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * First letter of the first two words, uppercased. A single-word name gives one letter rather than
 * two — taking the second letter of the same word ("Tr" for "Tre") reads as a truncation, not as
 * initials.
 */
export function initialsFrom(name: string): string {
  const words = clean(name).split(' ').filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The one place the chrome decides whose account it is showing. */
export function resolveIdentity(input: IdentityInput): ResolvedIdentity {
  // Demo is checked FIRST and unconditionally. The demo persona is not a person, and a partner
  // lens is never active inside it (`ViewedProfileContext` forces `isPartnerView` false in demo),
  // so ordering these the other way would be a bug waiting for a context change.
  if (input.isDemo) {
    return { label: 'Demo', initials: 'D', kind: 'demo', known: true, title: 'Viewing the demo account' };
  }

  if (input.isPartnerView) {
    const partner = clean(input.partnerLabel);
    // ⚠️ A partner with no display name still has to be VISIBLY not you. "Partner" is a
    // relationship rather than a name, so it is honest and it still answers the question the
    // badge exists to answer. `known: false` marks it as a fallback.
    return partner
      ? { label: partner, initials: initialsFrom(partner), kind: 'partner', known: true, title: `Viewing ${partner}'s account` }
      : { label: 'Partner', initials: '', kind: 'partner', known: false, title: "Viewing your partner's account" };
  }

  const own = clean(input.displayName);
  if (own) {
    return { label: own, initials: initialsFrom(own), kind: 'own', known: true, title: `Signed in as ${own}` };
  }

  // No display name. The email's first character is a real character the person chose, so it is an
  // honest initial — but the email never becomes the label, because an address is not a name.
  const localPart = clean(input.email).split('@')[0];
  const initial = localPart ? localPart[0].toUpperCase() : '';
  return { label: 'You', initials: initial, kind: 'own', known: false, title: 'Signed in to your own account' };
}
