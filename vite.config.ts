import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => ({
  test: {
    exclude: [...configDefaults.exclude, "backups/**"],
    alias: {
      // Runtime half of the esm.sh bridge (types: src/types/esm-sh-supabase.d.ts).
      // Lets vitest import supabase/functions/_shared/sync-handler.ts, whose Deno-style
      // URL import resolves to the SAME package installed locally. Test-only: the app
      // build never sees this specifier.
      "https://esm.sh/@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
  server: {
    host: "::",
    port: 8080,
    // Fail loudly instead of drifting to 8081. Supabase session state is stored
    // per-origin, so a fallback port silently serves a SIGNED-OUT app and makes
    // live verification look broken. See scripts/dev-session.mjs.
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    // Source maps, so a production stack trace names a real file and line
    // instead of `vendor-react-Ct3x9.js:1:48210`. Without this, error tracking
    // reports a crash nobody can act on.
    //
    // `true` (emitted AND linked via sourceMappingURL) rather than 'hidden':
    // the linked form is what lets the error tracker fetch the map straight
    // from the deployed URL, so stacks resolve with no upload step and no CI
    // token to keep alive. The usual reason to hide maps is to avoid
    // publishing source — but this repository is already PUBLIC, so there is
    // no secret here to protect. Maps are fetched on demand by devtools/the
    // tracker; they do not touch what a normal visitor downloads.
    sourcemap: true,
    rollupOptions: {
      output: {
        // NOTE: this used to be `manualChunks`. Vite 8 bundles with rolldown,
        // which treats `manualChunks` as a compat shim and silently ignored it
        // for React's CJS modules: react/react-dom/clsx were physically placed
        // inside the `vendor-charts` chunk, so the entry chunk statically
        // imported vendor-charts just to get React — pulling all 412 kB of
        // recharts into first paint on Landing and Auth, which show no charts.
        // `codeSplitting.groups` is rolldown's native API and is honoured.
        // Keeps ~400 kB raw (~119 kB gzip) out of the initial payload.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 100 },
            { name: 'vendor-utils', test: /node_modules[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/, priority: 100 },
            { name: 'vendor-query', test: /node_modules[\\/]@tanstack[\\/]react-query/, priority: 90 },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]supabase-js/, priority: 90 },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 90 },
            { name: 'vendor-motion', test: /node_modules[\\/]framer-motion[\\/]/, priority: 90 },
            { name: 'vendor-charts', test: /node_modules[\\/]recharts[\\/]/, priority: 90 },
          ],
        },
      },
    },
  },
}));
