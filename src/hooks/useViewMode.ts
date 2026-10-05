import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { useProfile } from '@/hooks/useSupabaseData';
import { resolveViewMode, type ViewMode } from '@/lib/view-mode';

/**
 * The Simple | Advanced switch. The change shows at once (the cached profile is updated first),
 * then it is saved to the user's own profile row so phone and web agree.
 *
 * Demo and partner view: the switch still works for looking, and nothing is written - the
 * profile write is refused there for every other setting too.
 *
 * A failed save puts the old mode back and says so; it never leaves the screen claiming a
 * choice the database does not hold.
 */
export function useViewMode(): { mode: ViewMode; setMode: (next: ViewMode) => void } {
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { isPartnerView } = useViewedProfile();
  const qc = useQueryClient();
  const mode = resolveViewMode((profile as { view_mode?: unknown }).view_mode);
  const key = ['profile', isDemo ? 'demo' : user?.id];

  const setMode = useCallback((next: ViewMode) => {
    if (next === mode) return;
    const prev = mode;
    qc.setQueryData(key, (old: Record<string, unknown> | undefined) => ({ ...(old ?? {}), view_mode: next }));
    if (isDemo || isPartnerView || !user) return;
    void supabase.from('profiles').update({ view_mode: next }).eq('user_id', user.id).then(({ error }) => {
      if (!error) return;
      qc.setQueryData(key, (old: Record<string, unknown> | undefined) => ({ ...(old ?? {}), view_mode: prev }));
      toast.error(`Could not save your view: ${error.message}`);
    });
    // `key` is derived from isDemo and user.id, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isDemo, isPartnerView, user, qc]);

  return { mode, setMode };
}
