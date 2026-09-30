/**
 * Used by the "Confirm your email" screen's Open button.
 * Unknown domains get no button rather than a guess.
 * Only fixed https URLs are returned; the email itself never goes into a URL.
 */
export interface InboxLink {
  provider: string;
  url: string;
}

const PROVIDERS: Record<string, InboxLink> = {
  // Gmail
  'gmail.com': { provider: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  'googlemail.com': { provider: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },

  // Outlook
  'outlook.com': { provider: 'Outlook', url: 'https://outlook.live.com/mail/0/inbox' },
  'hotmail.com': { provider: 'Outlook', url: 'https://outlook.live.com/mail/0/inbox' },
  'live.com': { provider: 'Outlook', url: 'https://outlook.live.com/mail/0/inbox' },
  'msn.com': { provider: 'Outlook', url: 'https://outlook.live.com/mail/0/inbox' },

  // Yahoo
  'yahoo.com': { provider: 'Yahoo Mail', url: 'https://mail.yahoo.com/' },
  'ymail.com': { provider: 'Yahoo Mail', url: 'https://mail.yahoo.com/' },

  // iCloud
  'icloud.com': { provider: 'iCloud Mail', url: 'https://www.icloud.com/mail' },
  'me.com': { provider: 'iCloud Mail', url: 'https://www.icloud.com/mail' },
  'mac.com': { provider: 'iCloud Mail', url: 'https://www.icloud.com/mail' },

  // AOL
  'aol.com': { provider: 'AOL Mail', url: 'https://mail.aol.com/' },
}

/**
 * Returns a provider-specific inbox link for a known email domain.
 * If the domain is not recognised, returns null.
 */
export function inboxLinkFor(email: string): InboxLink | null {
  const trimmedEmail = email.trim();
  const lastAt = trimmedEmail.lastIndexOf('@');
  if (lastAt === -1) {
    return null;
  }

  const rawDomain = trimmedEmail.slice(lastAt + 1);
  const domain = rawDomain.trim().toLowerCase();
  if (!domain) {
    return null;
  }

  // Own keys only: a bare lookup would resolve 'constructor' or '__proto__' through the prototype.
  const match = Object.prototype.hasOwnProperty.call(PROVIDERS, domain) ? PROVIDERS[domain] : undefined;
  if (!match) {
    return null;
  }

  // Return a new object to avoid sharing the constant reference
  return { provider: match.provider, url: match.url };
}
