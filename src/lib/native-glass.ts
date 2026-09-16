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

/** A rect in CSS points, in web view coordinates - exactly what `getBoundingClientRect` gives. */
export interface NativeGlassRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
}

export interface NativeGlassPlugin {
  isSupported(options?: { echo?: string }): Promise<NativeGlassSupport>;
  /**
   * Put a native glass surface over the web view at `rect`.
   *
   * ⚠️ IT COVERS WHAT IS UNDER IT. The native view is a SIBLING of the WKWebView, so it can
   * only be used on a surface with NO web content of its own. Anything the web app draws in that
   * rect disappears behind the material.
   *
   * ⚠️ AND THE FRAME FOLLOWS NOTHING. Scroll, resize, rotate or raise the keyboard and it
   * stays where it was put. The caller owns re-pushing the rect; that machinery is deliberately
   * not built yet (one static surface first).
   *
   * Rejects with 'Requires iOS 26' below that version - callers must check `isSupported` and fall
   * back to CSS rather than treating this as a thing that always works.
   */
  apply(options: NativeGlassRect): Promise<{ applied: boolean }>;
  /** Take a surface away. Removing an id that is not there resolves `{ removed: false }`, never throws. */
  remove(options: { id: string }): Promise<{ removed: boolean }>;
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

  /**
   * A no-op that RESOLVES `applied: false` rather than rejecting.
   *
   * A caller that already asked `isSupported` should never reach here; one that did not gets a
   * falsy answer and its CSS, instead of an unhandled rejection in the console of every browser
   * and every Android device. The honest signal is the `false`, not an exception.
   */
  apply(): Promise<{ applied: boolean }> {
    return Promise.resolve({ applied: false });
  }

  remove(): Promise<{ removed: boolean }> {
    return Promise.resolve({ removed: false });
  }
}

export const NativeGlass = registerPlugin<NativeGlassPlugin>('GlassEffect', {
  web: () => new NativeGlassWeb(),
});
