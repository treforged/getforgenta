import { registerPlugin } from '@capacitor/core';

// Ask 98cbf494: after Face ID, iOS re-activated the app 2.3 s late, and the native privacy cover
// waited for that activation. This tells AppDelegate the unlocked page has painted, so the cover
// comes off then. AppDelegate.jsUnlockPainted refuses while the app is in the background.
export interface AppCoverPlugin {
  /** Builds that predate it reject with "not implemented"; callers ignore that. */
  unlocked(): Promise<void>;
}

class AppCoverWeb implements AppCoverPlugin {
  async unlocked(): Promise<void> {
    // A browser has no native cover.
  }
}

export const AppCover = registerPlugin<AppCoverPlugin>('AppCover', {
  web: () => new AppCoverWeb(),
});
