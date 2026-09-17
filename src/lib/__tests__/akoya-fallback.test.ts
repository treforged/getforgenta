/**
 * The two decisions that gate the Akoya fallback:
 *   1. did Plaid fail in a way Akoya could fix?
 *   2. is this an institution Akoya can actually serve?
 *
 * Getting either wrong is user-visible: too loose and we offer Akoya for
 * institutions it doesn't cover, too tight and the fallback never appears.
 */

import { describe, expect, it } from 'vitest';
import { classifyPlaidExit } from '../providers/connection-errors';
import { findAkoyaInstitution, getAkoyaInstitutionByKey } from '../../config/akoya-institutions';

describe('classifyPlaidExit', () => {
  it('treats the documented connectivity codes as institution_unavailable', () => {
    for (const code of [
      'INSTITUTION_DOWN',
      'INSTITUTION_NOT_AVAILABLE',
      'INSTITUTION_NOT_RESPONDING',
      'INSTITUTION_NO_LONGER_SUPPORTED',
    ]) {
      expect(classifyPlaidExit({ error_code: code })).toBe('institution_unavailable');
    }
  });

  it('catches unlisted members of the INSTITUTION_ERROR family', () => {
    // Plaid adds codes over time; the whole family is connectivity-shaped, so
    // an unrecognized one should still surface the fallback.
    expect(classifyPlaidExit({
      error_code: 'SOME_FUTURE_CODE',
      error_type: 'INSTITUTION_ERROR',
    })).toBe('institution_unavailable');
  });

  it('reads a clean exit as a cancellation, not an error', () => {
    expect(classifyPlaidExit(null)).toBe('user_cancelled');
    expect(classifyPlaidExit(undefined)).toBe('user_cancelled');
    expect(classifyPlaidExit({})).toBe('user_cancelled');
  });

  it('does not offer Akoya for failures Akoya would not fix', () => {
    expect(classifyPlaidExit({
      error_code: 'INVALID_CREDENTIALS',
      error_type: 'ITEM_ERROR',
    })).toBe('other');
    expect(classifyPlaidExit({
      error_code: 'INTERNAL_SERVER_ERROR',
      error_type: 'API_ERROR',
    })).toBe('other');
  });
});

/**
 * ⚠️ THE INSTITUTION LIST IS EMPTY BY DECISION SINCE 2026-09-17, so this block changed shape.
 * Tre: "remove Connect Fidelity via Akoya btw since i never bought it." Two cases here used to
 * assert that Fidelity MATCHED, and they are correctly red against the empty list. They were
 * re-aimed rather than deleted, and rather than "fixed" by putting the entry back — restoring a
 * shipped behaviour to suit a harness is the wrong direction, and this repo has caught itself
 * doing it before.
 *
 * ⚠️ AND THE COVERAGE THAT WAS LOST IS NAMED, BECAUSE SILENCE HERE WOULD BE THE REAL DEFECT.
 * With no entry in the list, `findAkoyaInstitution` returns null for EVERY input, so the cases
 * below that assert null are now trivially true — they can no longer fail, and they are no
 * longer evidence that the matcher works. Specifically UNTESTED while the list is empty:
 *   · case-insensitive matching ('FIDELITY')
 *   · multi-word institution names ('Fidelity Investments', 'Fidelity NetBenefits')
 *   · the word boundary that makes 'Infidelity Savings' a NON-match
 * Restoring any entry to `AKOYA_INSTITUTIONS` must restore those three cases in the same commit.
 * The matcher code itself is untouched and still ships.
 */
describe('findAkoyaInstitution — no institution has an Akoya route', () => {
  it('returns null for the names that used to match', () => {
    // The real discriminator while the list is empty: these four are the exact strings the
    // shipped matcher was written for, so an entry quietly returning fails here first.
    for (const name of ['Fidelity', 'FIDELITY', 'Fidelity Investments', 'Fidelity NetBenefits']) {
      expect(findAkoyaInstitution(name)).toBeNull();
    }
  });

  it('VACUOUS WHILE THE LIST IS EMPTY: returns null for institutions with no Akoya route', () => {
    expect(findAkoyaInstitution('Chase')).toBeNull();
    expect(findAkoyaInstitution('Bank of America')).toBeNull();
  });

  it('returns null when the institution is unknown', () => {
    // Plaid does not always report an institution on exit. Unlike the case above this one stays
    // meaningful with a populated list, because it exercises the null/empty guard rather than
    // the matcher.
    expect(findAkoyaInstitution(null)).toBeNull();
    expect(findAkoyaInstitution(undefined)).toBeNull();
    expect(findAkoyaInstitution('')).toBeNull();
  });

  it('VACUOUS WHILE THE LIST IS EMPTY: no substring match inside an unrelated word', () => {
    expect(findAkoyaInstitution('Infidelity Savings')).toBeNull();
  });
});

describe('getAkoyaInstitutionByKey — no key resolves', () => {
  it('returns null for the key that used to round-trip', () => {
    expect(getAkoyaInstitutionByKey('fidelity')).toBeNull();
  });

  it('VACUOUS WHILE THE LIST IS EMPTY: returns null for an unsupported key', () => {
    expect(getAkoyaInstitutionByKey('chase')).toBeNull();
  });
});
