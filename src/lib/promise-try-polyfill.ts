/**
 * `Promise.try`, for WKWebViews that predate it.
 *
 * ⚠️ THIS IS NOT A CI PROBLEM WEARING A PRODUCT COSTUME. pdfjs-dist 6.x calls `Promise.try`,
 * which shipped in V8 12.9, Safari 18.2 and Firefox 134. This app's iOS deployment target is
 * **15.0** (`IPHONEOS_DEPLOYMENT_TARGET` in project.pbxproj), and a Capacitor app renders in the
 * system WKWebView - so the app installs on iOS 15 through 18.1 devices whose engine does not
 * have the method, and PDF import throws `TypeError: Promise.try is not a function` there.
 *
 * ⚠️ AND BROWSERSLIST DID NOT COVER IT, WHICH IS WHY NOTHING CAUGHT THIS. There is no
 * `browserslist` field in package.json, so the default query resolves to `ios_saf 18.5+` - every
 * target it names already HAS the method. **Browserslist describes the web audience; it is not
 * this app's support floor.** The floor is the deployment target, and the two have now diverged
 * by three major iOS versions.
 *
 * It surfaced on CI rather than in a browser because the runner is Node 22 and this desk is Node
 * 24 - the repo's own CLAUDE.md already warns that a local green is weaker than it looks. The
 * user-facing half is the real one.
 *
 * Installed lazily by `extractPdfText`, immediately before the dynamic pdf.js import, so it costs
 * nothing at all for the people who never open the feature. That dynamic import is a deliberate
 * ~350KB trade documented on `pdf-text.ts`; this must not undo it.
 */

/** `Promise.try` is absent from the lib types this project compiles against, so the presence
 *  check and the install both need a narrow assertion rather than a cast of the whole object. */
type PromiseWithTry = PromiseConstructor & { try?: unknown };

export function ensurePromiseTry(): void {
  // Never overwrite a native implementation - and this is also what makes the call idempotent.
  if (typeof (Promise as PromiseWithTry).try === 'function') {
    return;
  }

  /**
   * Spec shape (TC39): call `fn` synchronously with `args`; resolve with what it returns,
   * adopting a thenable; REJECT rather than throw when it throws synchronously.
   *
   * Args are `unknown[]`: the argument shape is genuinely unknown here, and variadic tuple
   * gymnastics would buy nothing for how pdf.js actually calls it.
   */
  const promiseTry = <T>(fn: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]): Promise<T> => {
    try {
      // `Promise.resolve` adopts a thenable, which is the spec behaviour for a returned promise.
      return Promise.resolve(fn(...args));
    } catch (error) {
      // The synchronous throw becomes a rejection and must NOT escape this call.
      return Promise.reject(error);
    }
  };

  // Match a native method's property attributes.
  Object.defineProperty(Promise, 'try', {
    value: promiseTry,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
