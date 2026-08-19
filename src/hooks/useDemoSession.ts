/**
 * One place that knows how the demo is entered, and how it is left.
 *
 * Demo mode is in-memory React state (`DemoContext`) with no route and no flag. Until 2026-08-18
 * the only way in was the "Try Demo" button on `/auth`, and the only way OUT was signing out —
 * which is fine for a visitor who was never signed in, and wrong for the case Tre asked for: a new
 * user looking at a reference account WHILE setting their own up. Entering demo signed in renders
 * the fixture data over the live session and changes nothing on the server, so leaving it is a
 * plain `setIsDemo(false)`, never a sign-out.
 *
 * `isPreview` is the predicate that separates the two audiences, and it lives here so the banner,
 * the sidebar and the mobile menu cannot answer it three different ways: a signed-out visitor is
 * shown "Sign Up Free", a signed-in user is shown the way back to their own account.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';

export interface DemoSession {
  /** The app is rendering fixture data. */
  isDemo: boolean;
  /** Fixture data is being shown to someone who already has a real account of their own. */
  isPreview: boolean;
  /** Turn the reference account on and land on the Dashboard, where it reads best. */
  enterDemo: () => void;
  /**
   * Hand the signed-in user back their own account. `/dashboard` and not the current path because
   * a user still mid-setup is sent on to `/onboarding` by the route gate the moment the flag drops,
   * and landing that redirect from a known page beats landing it from a deep demo route.
   */
  leaveDemo: () => void;
}

export function useDemoSession(): DemoSession {
  const { isDemo, setIsDemo } = useDemo();
  const { user } = useAuth();
  const navigate = useNavigate();

  const enterDemo = useCallback(() => {
    setIsDemo(true);
    navigate('/dashboard');
  }, [setIsDemo, navigate]);

  const leaveDemo = useCallback(() => {
    setIsDemo(false);
    navigate('/dashboard', { replace: true });
  }, [setIsDemo, navigate]);

  return { isDemo, isPreview: isDemo && !!user, enterDemo, leaveDemo };
}
