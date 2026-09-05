/**
 * The notification decider — RE-EXPORTED from `supabase/functions/_shared/`.
 *
 * ⚠️ THE FILE MOVED, AND THE REASON IS THE WHOLE POINT. The policy is called from two runtimes:
 * the app (Vite) and the push sender (Deno). **Deno cannot import from `src/`**, so leaving it
 * here would have forced a COPY into `_shared/` — and a copied policy drifts silently, which on
 * a notification means the app's idea of "we already sent that" stops matching the sender's.
 * Two of the same message, or none.
 *
 * Vite can import from outside `src/` (see `src/lib/__tests__/supersede-connection.test.ts`,
 * which already does exactly this), so moving it the OTHER way gives ONE source of truth with
 * no copy at all. That is strictly better than the drift header `_shared/learn-streak.ts` had
 * to carry, and it is why that one is a copy and this one is not.
 *
 * This shim exists so the ten existing importers keep working unchanged. Import either path;
 * they are the same module.
 */
export * from '../../supabase/functions/_shared/notification-policy';
