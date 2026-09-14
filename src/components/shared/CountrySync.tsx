import { useDerivedCountry } from '@/hooks/useDerivedCountry';

/**
 * Fills `profiles.country_code` from the browser's own locale and time zone. Renders nothing.
 *
 * ⚠️ MOUNTED IN BOTH APP BRANCHES ON PURPOSE. `App.tsx` has a NATIVE tree and a WEB tree, and this
 * repo has already shipped a feature into one of two surfaces and had it look complete — the app
 * lock was written, exported, documented and rendered by NOTHING until 2026-09-06. A companion
 * test asserts the mount COUNT is two, so removing one branch is a red gate rather than a quiet
 * regression that only shows up on somebody's phone.
 *
 * The rules about when it writes — once, only into a blank, never over an opt-out — live in
 * `useDerivedCountry` beside the reasoning for each.
 */
export default function CountrySync() {
  useDerivedCountry();
  return null;
}
