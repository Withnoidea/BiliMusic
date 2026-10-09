import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', 'artifacts/**', 'platform/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // The upstream Bilibili gateway has legacy loosely typed response shapes.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-control-regex': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
)
