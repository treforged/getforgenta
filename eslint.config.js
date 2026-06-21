import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
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
