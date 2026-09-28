import js from '@eslint/js'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * PLAN §18.11: ESLint is the quality gate. Flat config, React 19, browser +
 * Vitest environments. There is no TypeScript here by design (§5), so the
 * import rules below stand in for what a compiler would otherwise catch: a named
 * import that does not exist renders as `undefined` and only fails at runtime.
 */
export default [
  { ignores: ['dist/**', 'coverage/**', 'dev-dist/**', 'node_modules/**'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.{js,jsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '19.0' },
      'import/resolver': { node: { extensions: ['.js', '.jsx'] } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The automatic JSX runtime (Vite plugin) means React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-no-target-blank': 'error',
      'react/prop-types': 'off',
      // A default export imported by name resolves to undefined at runtime and
      // only explodes when the route renders, so treat it as a hard error.
      'import/named': 'error',
      'import/no-unresolved': 'error',
      'import/no-duplicates': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // The build config resolves ESM-only packages whose `exports` map the legacy
    // node resolver cannot read, so skip the resolution rule there.
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'import/no-unresolved': 'off' },
  },
]
