import { useUsernameSuggestions, MIN_PREFIX } from '@/hooks/useUsernameSuggestions';

/**
 * The suggestion list under the Find-someone field.
 *
 * ⚠️ IT SAYS WHY IT IS EMPTY, RATHER THAN JUST BEING EMPTY. `visibility` defaults to `'private'`
 * and, measured 2026-09-17, **no** profile is public yet - so for now this renders nothing for
 * everybody. A dropdown that is silently blank reads as a broken feature and invites somebody to
 * "fix" it by widening the filter, which would turn a typeahead into account enumeration. So when
 * a long-enough prefix returns no rows, it says that only public accounts appear here.
 *
 * It is a plain list rather than a combobox on purpose: it does not steal focus, does not trap the
 * keyboard, and the field still works exactly as it did for somebody who ignores it. A full
 * listbox would need managed focus, aria-activedescendant and typeahead semantics - real work that
 * this is not pretending to have done.
 */
export function UsernameSuggestions({
  prefix,
  onPick,
}: {
  prefix: string;
  onPick: (username: string) => void;
}) {
  const { suggestions, loading } = useUsernameSuggestions(prefix);
  const longEnough = prefix.trim().length >= MIN_PREFIX;

  if (!longEnough || loading) return null;

  if (suggestions.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid="username-suggestions-empty">
        No public accounts match. Only accounts set to public appear here — you can still find a
        private account by typing its exact username.
      </p>
    );
  }

  return (
    <ul className="mt-1 space-y-0.5" data-testid="username-suggestions">
      {suggestions.map(s => (
        <li key={s.user_id}>
          <button
            type="button"
            onClick={() => onPick(s.username)}
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors flex items-baseline gap-2 min-w-0"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <span className="font-medium shrink-0">@{s.username}</span>
            {s.display_name && (
              // `min-w-0` + `truncate`: a display name is user-supplied and can be long, and this
              // row sits in the narrow Account column - see check:account-rows for what an
              // unconstrained string does to a narrow column at large text.
              <span className="text-muted-foreground truncate min-w-0">{s.display_name}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
