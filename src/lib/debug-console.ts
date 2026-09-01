/**
 * The in-page debug console, and the one shape in which it is safe to have one.
 *
 * WHY THE CARE. Eruda draws a devtools panel inside the page, and its Resources
 * tab reads `localStorage`. In this app localStorage holds the SUPABASE AUTH
 * SESSION JWT. Anyone who can open that panel on a signed-in session can lift a
 * token that speaks for the account, so on a personal-finance app an in-page
 * console is an account-takeover surface, not a debug convenience.
 *
 * THREE THINGS KEEP IT OUT OF PRODUCTION, and only the third is a guarantee:
 *
 *   1. The import below is DYNAMIC and lives INSIDE the branch. This is the part
 *      that is easy to get wrong: a top-level `import 'eruda'` bundles the
 *      console regardless of any guard beneath it, and it reviews as correct
 *      because the guard is still right there in the file.
 *   2. The branch tests `MODE !== 'production'`. Vite substitutes a literal for
 *      `import.meta.env.MODE`, so in a production build this reads
 *      `'production' !== 'production'` and the whole block - the import with it -
 *      is eliminated by the bundler. Nothing is shipped and then not run; there
 *      is nothing to run.
 *   3. `scripts/check-no-debug-console.mjs` builds production and FAILS if the
 *      output contains eruda or vConsole anywhere. That is the guarantee. Points
 *      1 and 2 are one careless refactor from being wrong, and the person who
 *      makes that refactor will never have read this comment. A build-time
 *      failure is what survives them.
 *
 * The flag is opt-in on top of the mode check rather than instead of it, so a
 * preview deployment has to ask for the console explicitly. Turning it on:
 * build with `--mode development` (npm run build:dev) and set
 * `VITE_ENABLE_DEBUG_CONSOLE=true`. A normal production build ignores both.
 */

/**
 * Loads the debug console if, and only if, this is a non-production build that
 * has explicitly asked for it. Resolves to whether it was actually loaded, so a
 * caller can say so rather than guess.
 */
export async function maybeLoadDebugConsole(): Promise<boolean> {
  if (
    import.meta.env.MODE !== 'production' &&
    import.meta.env.VITE_ENABLE_DEBUG_CONSOLE === 'true'
  ) {
    try {
      const eruda = await import('eruda');
      eruda.default.init();
      return true;
    } catch (error: unknown) {
      // A missing optional devDependency must never take the app down with it.
      console.warn('[debug-console] not loaded:', error);
      return false;
    }
  }

  return false;
}
