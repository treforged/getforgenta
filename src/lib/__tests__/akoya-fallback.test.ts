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

describe('findAkoyaInstitution', () => {
  it('matches Fidelity by name, whatever Plaid calls it', () => {
    for (const name of ['Fidelity', 'FIDELITY', 'Fidelity Investments', 'Fidelity NetBenefits']) {
      expect(findAkoyaInstitution(name)?.key).toBe('fidelity');
    }
  });

  it('returns null for institutions with no Akoya route', () => {
    expect(findAkoyaInstitution('Chase')).toBeNull();
    expect(findAkoyaInstitution('Bank of America')).toBeNull();
  });

  it('returns null when the institution is unknown', () => {
    // Plaid does not always report an institution on exit.
    expect(findAkoyaInstitution(null)).toBeNull();
    expect(findAkoyaInstitution(undefined)).toBeNull();
    expect(findAkoyaInstitution('')).toBeNull();
  });

  it('does not match on a substring inside an unrelated word', () => {
    // The matcher is word-bounded, so "Fidelityish Credit Union" is a match but
    // an embedded run of letters is not.
    expect(findAkoyaInstitution('Infidelity Savings')).toBeNull();
  });
});

describe('getAkoyaInstitutionByKey', () => {
  it('round-trips a supported key', () => {
    expect(getAkoyaInstitutionByKey('fidelity')?.displayName).toBe('Fidelity');
  });

  it('returns null for an unsupported key', () => {
    expect(getAkoyaInstitutionByKey('chase')).toBeNull();
  });
});
