import { useState, useEffect, useCallback, useRef } from 'react';
import { useProfile } from './useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { DEFAULT_LAYOUT, mergeSavedLayout, type WidgetConfig } from '@/lib/dashboard-widgets';

export function useDashboardLayout() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { data: profile, loading } = useProfile();
  const [layout, setLayoutState] = useState<WidgetConfig[]>(DEFAULT_LAYOUT);
  const [isCustomizing, setCustomizing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    const raw = profile?.dashboard_layout;
    setLayoutState(mergeSavedLayout(raw));
  }, [profile, loading]);

  const persist = useCallback(
    (newLayout: WidgetConfig[]) => {
      if (isDemo || !user) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await supabase
          .from('profiles')
          .update({ dashboard_layout: newLayout as unknown as Json })
          .eq('user_id', user.id);
      }, 800);
    },
    [isDemo, user],
  );

  const setLayout = useCallback(
    (newLayout: WidgetConfig[]) => {
      setLayoutState(newLayout);
      persist(newLayout);
    },
    [persist],
  );

  /**
   * ⚠️ THIS DELIBERATELY DOES NOT TOUCH `initialized`. It used to set it back to false, and that
   * one line made the reset racy in a way the user sees.
   *
   * `initialized` exists to stop the effect above re-stamping the profile's saved layout over
   * local state. Clearing it RE-ARMS exactly that. The write below is debounced 800ms, so any
   * profile refetch landing inside that window hands back the PRE-RESET row, the effect applies
   * it, and the layout the user just reset snaps back on screen - while the pending write still
   * puts DEFAULT_LAYOUT in the database. Screen and database then disagree until a reload.
   *
   * The line bought nothing: `setLayout` already sets state AND persists. Removing it is the
   * whole fix. Pinned by `useDashboardLayout.resetSticks.test.tsx`, which reproduces the race
   * with a refetch that returns identical contents in a new object - which is what a refetch is.
   *
   * This matters more than a tidy-up right now: since 2026-09-17 this button is the ONLY route a
   * user with a saved layout has to the current default, and the two profiles that have one are
   * the CEO's and the review account's.
   */
  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT);
  }, [setLayout]);

  const visibleWidgets = layout.filter(w => w.visible).map(w => w.id);

  return { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout };
}
