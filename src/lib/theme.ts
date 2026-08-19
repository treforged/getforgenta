/**
 * Light / dark, and the one place the choice is turned into a class on `<html>`.
 *
 * ⚠️ THE APP IS DARK-FIRST. `:root` in `index.css` IS the dark palette, so dark is the absence of a
 * class and light is `.light`. That is the opposite of the usual Tailwind arrangement and it is
 * deliberate: it means every surface built before light mode existed keeps rendering exactly as it
 * did, and only a user who asks for light gets anything different.
 *
 * ⚠️ THE PREFERENCE IS PER DEVICE, stored locally rather than on `profiles`. A phone read in bed
 * and a desktop under office lights are not the same request, and syncing the choice would make one
 * of them wrong every time. It is the same trade `useDismissedDuplicates` and merchant-memory
 * suppression already make, for a reason that applies more strongly here.
 */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'forgenta.theme.v1';

/** `system` is the default: the app should look like the rest of the device until told otherwise. */
export const DEFAULT_THEME: ThemeChoice = 'system';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'dark' || value === 'light';
}

/**
 * What a choice actually renders as.
 *
 * ⚠️ `prefersLight` is passed in rather than read from `window` here, so this stays pure and
 * testable and so the caller decides what "the system says" means — including in a Capacitor
 * webview, where the media query is the only signal available.
 */
export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return prefersLight ? 'light' : 'dark';
}

/** Reads the stored choice, falling back to the default rather than throwing on a corrupt value. */
export function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : DEFAULT_THEME;
  } catch {
    // A blocked or unavailable store must not take the page down. Falling back to `system` is the
    // safe direction: the user gets the device default rather than a blank screen.
    return DEFAULT_THEME;
  }
}

/**
 * Puts the resolved theme on `<html>`.
 *
 * ⚠️ IT REMOVES BOTH CLASSES BEFORE ADDING ONE. Toggling by adding alone leaves the previous class
 * in place, and with `.light` and `.dark` both present the later rule in the stylesheet silently
 * wins — a theme switch that works one way and not the other.
 */
export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}
