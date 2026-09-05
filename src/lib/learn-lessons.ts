/**
 * The lesson catalogue — RE-EXPORTED from `supabase/functions/_shared/`.
 *
 * ⚠️ MOVED FOR THE SAME REASON AS `notification-policy.ts`, and it is worth stating once more
 * because the alternative is so tempting. The push sender needs the lesson list to work out
 * which lesson to offer next, and **Deno cannot import from `src/`**. Leaving the catalogue here
 * would have meant a derived index in `_shared/` — a second list of ids and titles that drifts
 * the moment a lesson is added, so the notification offers a lesson the app does not have, or
 * never offers one it does.
 *
 * Vite imports happily from outside `src/`, so moving it the other way leaves ONE list. No copy,
 * nothing to keep in step.
 *
 * This shim keeps the four existing importers working unchanged. Import either path; same module.
 */
export * from '../../supabase/functions/_shared/learn-lessons';
