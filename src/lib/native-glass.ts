/**
 * JS half of the native iOS glass bridge.
 *
 * BRIDGE SMOKE TEST ONLY at this stage - `isSupported` is the whole surface, and there is no
 * visual effect behind it yet. See `ios/App/App/GlassEffectPlugin.swift`.
 *
 * `supported: false` means USE THE CSS FALLBACK. That fallback is what web, Android and every
 * iOS below 26 get, it is what ships today (`--panel-glass`, `cdede2f0`), and it must keep
 * working - do not let it rot while the native path is built.
 */
import { registerPlugin } from '@capacitor/core';

export interface NativeGlassSupport {
  /** True only on iOS 26+, where UIGlassEffect exists. */
  supported: boolean;
  /** `UIDevice.current.systemVersion`, or '' off-device. */
  iosVersion: string;
  /** The caller's own token, handed back unchanged. The round-trip proof. */
  echo: string;
}

export interface NativeGlassPlugin {
  isSupported(options?: { echo?: string }): Promise<NativeGlassSupport>;
}

/**
 * Web/Android fallback. It must NEVER throw: every caller is expected to ask, get
 * `supported: false`, and fall through to CSS.
 */
class NativeGlassWeb implements NativeGlassPlugin {
  isSupported(options?: { echo?: string }): Promise<NativeGlassSupport> {
    return Promise.resolve({
      supported: false,
      iosVersion: '',
      echo: options?.echo ?? '',
    });
  }
}

export const NativeGlass = registerPlugin<NativeGlassPlugin>('GlassEffect', {
  web: () => new NativeGlassWeb(),
});
