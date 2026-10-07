// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';

// The experiment reaches PRODUCTION web (server.url is getforgenta.com), so the only thing that
// keeps it off every iOS 26 phone is the flag. These pin both halves: it applies when every gate
// is open, and each gate alone keeps it inert. Either half alone passes a hook that always or
// never applies.

const native = vi.hoisted(() => ({ value: true }));
const glass = vi.hoisted(() => ({
  isSupported: vi.fn(),
  apply: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
vi.mock('@/lib/native-glass', () => ({ NativeGlass: glass }));

import { useSimGlassExperiment } from '../useSimGlassExperiment';

const FLAG = 'forgenta:sim-glass-experiment';

beforeEach(() => {
  native.value = true;
  glass.isSupported.mockResolvedValue({ supported: true, iosVersion: '26.5', echo: '' });
  glass.apply.mockResolvedValue({ applied: true });
  glass.remove.mockResolvedValue({ removed: true });
  localStorage.setItem(FLAG, '1');
  // jsdom has no layout, so model the safe-area probe's height (a notch is ~59pt).
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 59 } as DOMRect);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  glass.isSupported.mockReset();
  glass.apply.mockReset();
  glass.remove.mockReset();
});

// Lets every pending promise in the hook settle before asserting an ABSENCE.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('useSimGlassExperiment', () => {
  it('applies one full-width strip over the top safe area when every gate is open', async () => {
    renderHook(() => useSimGlassExperiment());
    await waitFor(() => expect(glass.apply).toHaveBeenCalledTimes(1));
    expect(glass.apply).toHaveBeenCalledWith({
      id: 'sim-top-strip', x: 0, y: 0, width: window.innerWidth, height: 59, cornerRadius: 0,
    });
  });

  it('does nothing without the flag - the state of every real phone', async () => {
    localStorage.removeItem(FLAG);
    renderHook(() => useSimGlassExperiment());
    await settle();
    expect(glass.isSupported).not.toHaveBeenCalled();
    expect(glass.apply).not.toHaveBeenCalled();
  });

  it('does nothing on the web', async () => {
    native.value = false;
    renderHook(() => useSimGlassExperiment());
    await settle();
    expect(glass.apply).not.toHaveBeenCalled();
  });

  it('does nothing below iOS 26', async () => {
    glass.isSupported.mockResolvedValue({ supported: false, iosVersion: '18.0', echo: '' });
    renderHook(() => useSimGlassExperiment());
    await settle();
    expect(glass.apply).not.toHaveBeenCalled();
  });

  it('never throws when the bridge rejects', async () => {
    glass.isSupported.mockRejectedValue(new Error('bridge down'));
    renderHook(() => useSimGlassExperiment());
    await settle();
    expect(glass.apply).not.toHaveBeenCalled();
  });

  it('removes the strip on unmount', async () => {
    const { unmount } = renderHook(() => useSimGlassExperiment());
    await waitFor(() => expect(glass.apply).toHaveBeenCalled());
    unmount();
    expect(glass.remove).toHaveBeenCalledWith({ id: 'sim-top-strip' });
  });

  it('puts the chrome over the scroller only while the strip is on (f2bd47fd)', async () => {
    const chrome = document.createElement('div');
    chrome.id = 'top-chrome';
    chrome.getBoundingClientRect = () => ({ height: 107 }) as DOMRect;
    document.body.appendChild(chrome);
    const root = document.documentElement;
    const { unmount } = renderHook(() => useSimGlassExperiment());
    await waitFor(() => expect(glass.apply).toHaveBeenCalled());
    expect(root.classList.contains('native-glass-strip')).toBe(true);
    expect(root.style.getPropertyValue('--top-chrome-h')).toBe('107px');
    unmount();
    expect(root.classList.contains('native-glass-strip')).toBe(false);
    chrome.remove();
  });

  it('clears the flag after reading it, so a later launch without it is a normal launch', async () => {
    renderHook(() => useSimGlassExperiment());
    await waitFor(() => expect(glass.apply).toHaveBeenCalled());
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it('never sets the layout class without the flag', async () => {
    localStorage.removeItem(FLAG);
    renderHook(() => useSimGlassExperiment());
    await settle();
    expect(document.documentElement.classList.contains('native-glass-strip')).toBe(false);
  });
});
