import { CATEGORY_GROUPS, CATEGORY_EMOJI, type Category } from '@/lib/types';

/**
 * The ONE category option list. Every `<select>` that offers categories renders
 * this, so the 26 options are grouped the same way on every tab.
 *
 * Before 2026-09-14 there were five separate flat lists of 26 options across
 * BankActivity, Transactions (three of them) and BudgetControl. Nobody builds
 * five pickers on purpose - they arrive one screen at a time, each reasonable
 * alone, and then drift. The count IS the acceptance evidence: one.
 */
export default function CategoryOptions({ exclude }: { exclude?: readonly Category[] }) {
  const skip = new Set<string>(exclude ?? []);
  return (
    <>
      {CATEGORY_GROUPS.map(group => {
        const shown = group.categories.filter(c => !skip.has(c));
        if (shown.length === 0) return null;
        return (
          <optgroup key={group.label} label={group.label}>
            {shown.map(c => (
              <option key={c} value={c}>{`${CATEGORY_EMOJI[c] ?? ''} ${c}`.trim()}</option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/**
 * The same grouping as data, for `FormModal`'s field-driven selects, which take
 * options rather than children. `group` is what makes FormModal emit optgroups.
 */
export function categoryFieldOptions(exclude?: readonly Category[]) {
  const skip = new Set<string>(exclude ?? []);
  return CATEGORY_GROUPS.flatMap(g =>
    g.categories
      .filter(c => !skip.has(c))
      .map(c => ({ value: c, label: `${CATEGORY_EMOJI[c] ?? ''} ${c}`.trim(), group: g.label })),
  );
}
