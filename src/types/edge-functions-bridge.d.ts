/**
 * Type bridge that lets src tests import the Deno edge-function modules
 * (supabase/functions/_shared) under the app's tsc and vitest.
 *
 * Two halves:
 *  1. The esm.sh URL import in sync-handler.ts — declared here as the REAL installed
 *     package (the esm.sh bundle IS @supabase/supabase-js, so these types are accurate,
 *     not a stub). The runtime half is the matching vitest alias in vite.config.ts.
 *  2. The `Deno` global — declared with ONLY the surface the functions actually use
 *     (env.get), so a stray `Deno.` in app code still fails on any other member.
 *     Every Deno.env call in the functions is inside a handler body, never at module
 *     level, which is what makes importing them under Node safe at runtime.
 */

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare const Deno: {
  env: { get(name: string): string | undefined };
};
