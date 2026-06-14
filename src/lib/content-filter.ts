const BLOCKED_WORDS: RegExp[] = [
  /\bfuck\b/gi, /\bfucking\b/gi, /\bfucker\b/gi, /\bfucked\b/gi,
  /\bshit\b/gi, /\bshitty\b/gi,
  /\basshole\b/gi, /\bass\b/gi, /\basses\b/gi,
  /\bbitch\b/gi, /\bbitches\b/gi,
  /\bcunt\b/gi, /\bcunts\b/gi,
  /\bdick\b/gi, /\bdicks\b/gi,
  /\bcock\b/gi, /\bcocks\b/gi,
  /\bpussy\b/gi, /\bpussies\b/gi,
  /\bnigger\b/gi, /\bnigga\b/gi,
  /\bfaggot\b/gi, /\bfag\b/gi,
  /\bwhore\b/gi, /\bwhores\b/gi,
  /\bslut\b/gi, /\bsluts\b/gi,
  /\bbastard\b/gi,
  /\bdamn\b/gi,
  /\bcrap\b/gi,
  /\bporn\b/gi, /\bporno\b/gi,
  /\bsex\b/gi, /\bsexual\b/gi,
  /\bnude\b/gi, /\bnudes\b/gi, /\bnaked\b/gi,
  /\bnsfw\b/gi,
  /\bkill\s+yourself\b/gi, /\bkys\b/gi,
  /\bretard\b/gi, /\bretarded\b/gi,
];

const BLOCKED_DOMAIN_FRAGMENTS = [
  'porn', 'xxx', 'adult', 'nsfw', 'hentai', 'xvideos', 'xhamster',
  'pornhub', 'onlyfans', 'chaturbate', 'cam4', 'livejasmin', 'stripchat',
  'redtube', 'youporn', 'spankbang', 'xnxx', 'tube8',
  // scam patterns
  'bit.ly', 'tinyurl', 'shorturl', 'rebrand.ly', 'cutt.ly',
  'free-iphone', 'win-prize', 'claim-reward', 'get-rich',
];

export const LIMITS = {
  // Builds
  buildName: 60,
  buildNotes: 500,
  itemName: 100,
  itemBrand: 150,
  itemLink: 500,
  phaseTitle: 60,
  // User identity
  username: 40,
  // AI
  aiPrompt: 500,
  // Financial records
  goalName: 60,
  vehicleName: 60,
  ruleName: 60,
  ruleNotes: 300,
  transactionNote: 200,
  planName: 60,
  planNotes: 300,
  debtName: 60,
} as const;

export function filterProfanity(text: string): { clean: string; flagged: boolean } {
  let flagged = false;
  let clean = text;
  for (const re of BLOCKED_WORDS) {
    if (re.test(clean)) {
      flagged = true;
      clean = clean.replace(re, '***');
    }
  }
  return { clean, flagged };
}

export function isSafeUrl(url: string): { safe: boolean; reason?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { safe: true };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { safe: false, reason: 'Invalid URL — must start with http:// or https://' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: 'Only http:// and https:// links are allowed' };
  }
  const host = parsed.hostname.toLowerCase();
  for (const fragment of BLOCKED_DOMAIN_FRAGMENTS) {
    if (host.includes(fragment)) {
      return { safe: false, reason: 'That link is not allowed' };
    }
  }
  return { safe: true };
}
