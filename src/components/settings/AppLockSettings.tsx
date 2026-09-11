import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { Lock, LockOpen } from 'lucide-react';
import { SettingsSectionHeading } from './SettingsSection';
import { useAppLock } from '@/hooks/useAppLock';

/**
 * The app lock's Settings entry — the only DELIBERATE route to turning a PIN on.
 *
 * ⚠️ WHY IT EXISTS. The lock itself has been mounted since 2026-09-06 (`ef2bb1b1`),
 * but until now the only way to ENABLE it was an automatic prompt fired from the
 * `SIGNED_IN` handler in AppLockContext, and that prompt is a one-shot:
 * `dismissSetupModal` writes `forged:lock_setup_prompted`, which nothing clears
 * except signing out. Two consequences, and both leave a mounted feature that a
 * person cannot actually use:
 *
 *   1. Dismiss the sheet once and you could never set a PIN again.
 *   2. The prompt listens for `SIGNED_IN` and NOT `INITIAL_SESSION`. A returning
 *      user who stays signed in only ever gets `INITIAL_SESSION`, so they may never
 *      have been offered it at all — and the native idle leash moving to seven days
 *      on 2026-09-11 makes `SIGNED_IN` rarer still. This repo has been bitten by
 *      that exact event distinction twice before, in RevenueCat and in push
 *      registration; AuthContext carries the comment about it.
 *
 * NATIVE ONLY, deliberately, matching where the lock is mounted: a PIN over a
 * browser tab is not the control a shared computer needs, and the 10-minute idle
 * sign-out stays the right answer on web.
 */
export function AppLockSettings() {
  const { ready, lockEnabled, lockType, biometricAvailable, openSetupModal, disableLock } = useAppLock();

  // Rendering nothing on web is the same decision App.tsx makes when it mounts the
  // provider for native only. A control that cannot do anything is worse than an
  // absent one: it invites a press and then reports nothing.
  if (!Capacitor.isNativePlatform()) return null;

  // `ready` is false only while the native provider restores its state. Showing the
  // "off" wording during that window would tell a user with a PIN that they have
  // none, so hold the section rather than assert something that may be wrong.
  if (!ready) return null;

  const handleDisable = async () => {
    try {
      await disableLock();
      toast.success('App lock turned off');
    } catch {
      toast.error('Could not turn the app lock off');
    }
  };

  return (
    <div className="space-y-2">
      <SettingsSectionHeading
        icon={lockEnabled ? Lock : LockOpen}
        title="App lock"
        tone={lockEnabled ? 'active' : 'default'}
        badge={lockEnabled ? (lockType === 'biometric' ? 'Biometric' : 'PIN') : undefined}
        description={
          lockEnabled
            ? 'This phone asks for your PIN when the app reopens.'
            : 'Require a PIN when the app reopens on this phone.'
        }
      />
      {lockEnabled ? (
        <button type="button" className="btn btn-ghost" onClick={handleDisable}>
          Turn off app lock
        </button>
      ) : (
        <button type="button" className="btn" onClick={openSetupModal}>
          {biometricAvailable ? 'Set a PIN or use biometrics' : 'Set a PIN'}
        </button>
      )}
    </div>
  );
}
