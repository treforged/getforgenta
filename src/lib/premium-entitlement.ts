/**
 * The premium entitlement predicate - RE-EXPORTED from `supabase/functions/_shared/`.
 *
 * The same question is asked from two runtimes: the app (Vite) and six edge functions
 * (Deno). Deno cannot import from `src/`, so a definition living here would have forced a
 * COPY into `_shared/` - and a copied entitlement rule drifts silently, which on this
 * question means the app says a past-due subscriber is premium while the server says they
 * are not. The user sees the feature and the API refuses it.
 *
 * Vite can import from outside `src/`, so the definition lives in `_shared/` and this shim
 * points at it. Import either path; they are the same module. Same shape as
 * `src/lib/notification-policy.ts` and `src/lib/learn-lessons.ts`.
 */
export * from '../../supabase/functions/_shared/premium-entitlement';
