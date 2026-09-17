import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';

/**
 * Typeahead for the Find-someone field (Tre, 2026-09-17: *"while searching for usernames, pop-up
 * suggestions of already created accounts"*).
 *
 * ⚠️ THE SERVER DECIDES WHO IS SUGGESTIBLE, AND IT IS PUBLIC PROFILES ONLY.
 * `suggest_profiles_by_username` is `SECURITY DEFINER`, requires an authenticated caller, demands
 * a two-character PREFIX, excludes the caller, escapes the caller's own wildcards and returns at
 * most 8 rows carrying a username and display name and nothing else.
 *
 * WHY THAT MATTERS MORE THAN THE FEATURE: a prefix search over every account IS account
 * enumeration. The existing `find_profile_by_username` is exact-match by design and
 * `follow_profiles` was written so it cannot enumerate - so a careless typeahead would have
 * quietly undone both. A private account stays findable by EXACT username and is never suggested,
 * because otherwise this feature downgrades a privacy setting somebody already chose.
 *
 * ⚠️ MEASURED 2026-09-17, AND IT IS THE FIRST THING TO KNOW WHEN THIS LOOKS BROKEN: `visibility`
 * DEFAULTS TO `'private'`, and at the time of writing **zero** profiles are public. So this
 * returns nothing for everybody until people opt in, and that is the feature behaving correctly
 * rather than failing. Do not "fix" an empty dropdown by widening the filter.
 *
 * MINIMUM PREFIX IS ENFORCED IN BOTH PLACES. Here it saves a round trip; in SQL it is the actual
 * rule, because the client is what an attacker controls.
 */

export const MIN_PREFIX = 2;
const DEBOUNCE_MS = 200;

export interface UsernameSuggestion {
  user_id: string;
  username: string;
  display_name: string | null;
}

/** Debounced so typing a name is one query, not one per keystroke. */
function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function useUsernameSuggestions(prefix: string): {
  suggestions: UsernameSuggestion[];
  loading: boolean;
} {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const settled = useDebounced(prefix.trim().toLowerCase(), DEBOUNCE_MS);
  const longEnough = settled.length >= MIN_PREFIX;

  const query = useQuery({
    queryKey: ['username-suggestions', settled],
    enabled: !isDemo && !!user && longEnough,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<UsernameSuggestion[]> => {
      const { data, error } = await supabase.rpc('suggest_profiles_by_username', {
        p_prefix: settled,
      });
      if (error) throw error;
      return (data ?? []) as UsernameSuggestion[];
    },
  });

  return {
    suggestions: longEnough ? (query.data ?? []) : [],
    // A disabled query is not loading - it has no work to do.
    loading: query.isLoading && longEnough && !isDemo && !!user,
  };
}
