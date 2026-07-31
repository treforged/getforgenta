import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // backups/ holds gitignored timestamped copies of source files (see CLAUDE.md backup
  // policy). Linting them is pure noise, and a backed-up eslint.config.js gives
  // typescript-eslint a second candidate tsconfigRootDir, which fails the whole run.
  { ignores: ['dist', 'backups'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      // This codebase uses `any` pervasively (1200+ existing instances) - flag
      // for new code as a nudge without blocking on the existing baseline.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Best-effort try/catch (e.g. sessionStorage writes) intentionally
      // swallows errors with an empty catch block in a few places.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond ? a() : b()` as a statement is an established pattern here for
      // conditional Set mutation (next.has(id) ? next.delete(id) : next.add(id)).
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      // eslint-plugin-react-hooks 5 -> 7 (pulled in by the eslint 10 bump that
      // cleared the brace-expansion/minimatch advisories) added a compiler-backed
      // rule set that flagged 60 pre-existing sites never linted before. They
      // were staged as warnings so a security bump would not turn into an
      // unrelated 60-file refactor, then burned down to zero on 2026-07-31 and
      // promoted to 'error' here. Every site was triaged individually: genuine
      // violations were fixed, and the remainder carry a scoped disable stating
      // the reason at the site. New violations now block.
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      // New in eslint 10 core; burned down in the same pass.
      'no-useless-assignment': 'error',
    },
  },
  {
    // Context files universally export a Provider component + paired useX()
    // hook from the same file - the standard React context convention. This
    // rule (Vite Fast Refresh granularity, zero production impact) flags that
    // pattern by design; splitting each context into two files would fight
    // the convention rather than fix anything real.
    files: ['src/contexts/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
