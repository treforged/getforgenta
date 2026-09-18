// The public handle people connect by — Tre, 2026-09-13: "maybe, like, a username that only one
// person can use", and "maybe we should do usernames instead or or make that an option to add
// people by usernames".
//
// ⚠️ A USERNAME IS PUBLIC BY CONSTRUCTION, and that is the whole reason this file has rules rather
// than a length check. It is the one string in this app a stranger is meant to be able to type, so
// everything it can leak, it leaks to anyone. It must therefore never be DERIVED from an email, a
// real name, or anything the user has not chosen to publish — the app never suggests one, and the
// claim form starts empty. That is a rule about the UI, stated here because this is where someone
// will come looking for it.
//
// ⚠️ AND IT IS NOT `display_name`. That field is already populated for most users, frequently with
// a real first name, and is shown only to a partner or an accepted friend. Reusing it as the
// connect-by handle would publish a name people never agreed to publish. Separate column,
// separate promise.
//
// This file is PURE: no I/O, so every rule below is testable without a database. Uniqueness itself
// is the database's job (a unique index on `lower(username)`), because two people can claim the
// same handle in the same second and only Postgres can arbitrate that.

/**
 * The canonical form stored and compared: trimmed and lower-cased.
 *
 * ⚠️ CALLERS MUST NORMALISE BEFORE WRITING — the database refuses anything else. The column's
 * CHECK is `^[a-z][a-z0-9_]*$`, so `Tre_Forged` is rejected outright rather than silently stored
 * in a second casing. Measured against the live constraint on 2026-09-13, not assumed: an update
 * with an upper-case handle raises `check_violation`.
 *
 * That makes the storage canonical by construction, and it is why `lower(username)` in the unique
 * index can never disagree with this function.
 */
export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Handles nobody may claim.
 *
 * ⚠️ THESE ARE IMPERSONATION RISKS, NOT RUDE WORDS. A user called `support` or `forgenta` can ask
 * another user for anything and be believed, and that costs more than a squatted name. Kept short
 * and specific for that reason: a long profanity list is a different problem with a different
 * failure mode, and pretending this list solves it would be the mistake.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'security', 'billing',
  'forgenta', 'treforged', 'team', 'staff', 'official', 'system', 'moderator',
  'null', 'undefined', 'anonymous', 'deleted',
]);
// ⚠️ EVERY ENTRY ABOVE MUST BE CLAIMABLE BUT FOR BEING RESERVED, and a test asserts it. `me` and
// `you` were in this list and are two characters, so they were rejected as too-short and could
// never reach the reserved check — dead entries that read as protection. Anything shorter than
// USERNAME_MIN, or carrying a character the pattern refuses, is already unclaimable and belongs
// nowhere near this list: putting it here invites the next person to "strengthen" the list with
// more words that also do nothing.

/**
 * Words no handle may CONTAIN.
 *
 * ⚠️ SUBSTRING-MATCHED, WHICH IS WHY THE LIST IS SHORT AND SPECIFIC. Every entry was chosen
 * because no ordinary English word contains it. The ones deliberately LEFT OUT are the lesson:
 * `rapist` is in `therapist`, `pedo` is in `torpedo`, `spic` is in `spice` and `suspicion`,
 * `cock` is in `cocktail` and `peacock`, `ass` is in `class` and `pass`, `anal` is in `analysis`,
 * `cum` is in `document`. A filter that refuses `therapist_jo` is a filter Tre hears about, and
 * the negative control in the tests pins every one of those.
 *
 * ⚠️ IT IS NOT A COMPLETE PROFANITY FILTER AND MUST NOT BE READ AS ONE. It covers slurs and the
 * hardest profanity — the strings whose cost is that they appear on somebody ELSE's screen. Mild
 * profanity, non-English, and anything spelled creatively enough will pass.
 */
export const BANNED_SUBSTRINGS: readonly string[] = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore',
  'bitch', 'bastard', 'dickhead', 'cocksucker', 'wanker', 'twat', 'slut',
  'pussy', 'kike', 'chink', 'tranny', 'pedophile', 'paedophile', 'molest',
  'porn', 'dildo', 'jizz', 'nazi', 'hitler', 'kkk', 'incel',
];

/** Digit-for-letter substitutions, so `sh1t` and `n4zi` are the words they are pronounced as. */
export function foldLeet(value: string): string {
  const map: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };
  return value.replace(/[013457]/g, (ch) => map[ch] ?? ch);
}

/**
 * `f_u_c_k` is the word. `cash_item` is not.
 *
 * ⚠️ THIS IS WHY UNDERSCORES ARE NOT SIMPLY STRIPPED. Removing every underscore joins two innocent
 * halves into a banned string — `cash_item` becomes `cashitem`, which contains `shit`, and
 * `miss_hit` becomes `misshit`. Both are names a real person would pick. So the collapse only
 * fires on the pattern that is actually evasion: three or more consecutive single-character
 * segments, which is what spelling a word out one letter at a time looks like.
 */
export function collapseSpacedUnderscores(value: string): string {
  const parts = value.split('_');
  let run = 0;
  for (const part of parts) {
    run = part.length === 1 ? run + 1 : 0;
    if (run >= 3) return value.replace(/_/g, '');
  }
  return value;
}

/** Whether any spelling of this handle carries a banned word. */
export function containsBannedWord(raw: string | null | undefined): boolean {
  const value = normalizeUsername(raw);
  const collapsed = collapseSpacedUnderscores(value);
  const candidates = [value, foldLeet(value), collapsed, foldLeet(collapsed)];
  return candidates.some((candidate) => BANNED_SUBSTRINGS.some((word) => candidate.includes(word)));
}

export type UsernameProblem =
  | 'too-short'
  | 'too-long'
  | 'bad-characters'
  | 'must-start-with-letter'
  | 'reserved'
  | 'banned';

/**
 * Why this handle cannot be claimed, or null when it can.
 *
 * ⚠️ RETURNS A REASON, NOT A BOOLEAN. The caller has to tell the user what to change; a `false`
 * forces it to re-derive that, and the two answers drift. The reasons are also what the tests
 * assert on, so a rule cannot be quietly relaxed into a different one while staying "invalid".
 *
 * ⚠️ ORDER IS DELIBERATE. Length is checked before characters so a 40-character string is reported
 * as too long rather than as containing something odd forty characters in — the first thing wrong
 * with it should be the first thing said.
 */
export function usernameProblem(raw: string | null | undefined): UsernameProblem | null {
  const value = normalizeUsername(raw);
  if (value.length < USERNAME_MIN) return 'too-short';
  if (value.length > USERNAME_MAX) return 'too-long';
  // Letters, digits and underscore only. No dots or hyphens: they are the characters that make two
  // different handles look identical in a sentence, which is the impersonation shape again.
  if (!/^[a-z0-9_]+$/.test(value)) return 'bad-characters';
  // A leading digit or underscore reads as an id rather than a name, and `_admin` is one glance
  // away from `admin`.
  if (!/^[a-z]/.test(value)) return 'must-start-with-letter';
  if (RESERVED_USERNAMES.has(value)) return 'reserved';
  if (containsBannedWord(value)) return 'banned';
  return null;
}

/** Whether this handle is claimable, ignoring whether anyone else already has it. */
export function isValidUsername(raw: string | null | undefined): boolean {
  return usernameProblem(raw) === null;
}

/** What to show the person who typed it. One sentence, and it says what to do next. */
export function usernameProblemMessage(problem: UsernameProblem): string {
  switch (problem) {
    case 'too-short': return `Usernames are at least ${USERNAME_MIN} characters.`;
    case 'too-long': return `Usernames are at most ${USERNAME_MAX} characters.`;
    case 'bad-characters': return 'Use letters, numbers and underscores only.';
    case 'must-start-with-letter': return 'Usernames start with a letter.';
    case 'reserved': return 'That username is not available.';
    // ⚠️ THE SAME SENTENCE AS 'reserved' AND 'taken', ON PURPOSE — see
    // USERNAME_UNAVAILABLE_MESSAGE below. Naming the rule tells a scraper which rule it hit.
    case 'banned': return 'That username is not available.';
  }
}

/**
 * ⚠️ THE SAME SENTENCE FOR "TAKEN" AND "RESERVED", ON PURPOSE.
 *
 * A lookup that distinguishes "nobody has this" from "somebody does" lets anyone walk the list and
 * map the user base — the enumeration problem, and a username is the one field designed to be
 * guessable. `'That username is not available.'` is true of both, so the claim form can be helpful
 * without answering the question a scraper is really asking.
 *
 * This does NOT make enumeration impossible on its own: timing, and the number of attempts, still
 * leak. Rate limiting is the other half and belongs at the edge function, not here. Said plainly
 * so nobody reads this constant as the whole defence.
 */
export const USERNAME_UNAVAILABLE_MESSAGE = 'That username is not available.';
