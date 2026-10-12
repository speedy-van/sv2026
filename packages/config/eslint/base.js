import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.{ts,tsx,mts,cts}'];
const generatedFiles = [
  '**/.next/**',
  '**/.turbo/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/playwright-report/**',
  '**/test-results/**',
];

const strictTypeChecked = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: tsFiles,
}));

export default tseslint.config(
  {
    ignores: generatedFiles,
  },
  js.configs.recommended,
  ...strictTypeChecked,
  {
    files: tsFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
    },
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['packages/pricing/src/**/*.{ts,tsx}', 'packages/tokens/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@sv/*', 'node:*', 'react', 'react-dom', 'react-native', 'next', 'next/*'],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@sv/db', '@sv/db/*', 'node:*', 'react', 'react-dom', 'react-native', 'next', 'next/*'],
        },
      ],
    },
  },
  {
    files: ['packages/db/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['react', 'react-dom', 'react-native', 'next', 'next/*'],
        },
      ],
    },
  },
  {
    files: ['packages/emails/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@sv/db', '@sv/db/*'],
        },
      ],
    },
  },
  {
    files: ['packages/api-client/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@sv/db', '@sv/db/*', 'node:*', 'fs', 'path', 'crypto'],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
