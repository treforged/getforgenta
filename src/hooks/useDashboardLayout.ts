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

  const resetLayout = useCallback(() => {
    initialized.current = false;
    setLayout(DEFAULT_LAYOUT);
  }, [setLayout]);

  const visibleWidgets = layout.filter(w => w.visible).map(w => w.id);

  return { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout };
}
