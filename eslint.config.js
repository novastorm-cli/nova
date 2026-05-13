import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import { noNonAsciiLiterals } from './eslint-local-rules/no-non-ascii-literals.js';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'coverage/**',
      'tests/**',
      'tests-e2e/**',
      'eslint-local-rules/**',
      'vitest.config.ts',
    ],
  },

  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Global settings for all TypeScript source files
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },

  // Shared rules for all source files
  {
    plugins: {
      'import-x': importX,
      nova: {
        rules: {
          'no-non-ascii-literals': noNonAsciiLiterals,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'import-x/no-cycle': 'warn',
      'nova/no-non-ascii-literals': 'error',
    },
  },

  // no-console: error for production packages
  {
    files: ['packages/{core,proxy,overlay,licensing}/src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },

  // Allow console.log in CLI banner and entry point
  {
    files: ['packages/cli/src/banner.ts', 'packages/cli/src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Allow non-ASCII in designated strings files and CLI banner
  {
    files: [
      'packages/overlay/src/ui/strings.ts',
      'packages/cli/src/strings.ts',
      'packages/cli/src/index.ts',
    ],
    rules: {
      'nova/no-non-ascii-literals': 'off',
    },
  },

  // Allow non-ASCII in test files (test data may contain non-English text)
  {
    files: ['packages/*/src/**/__tests__/**'],
    rules: {
      'nova/no-non-ascii-literals': 'off',
    },
  },

  // Browser globals for overlay package
  {
    files: ['packages/overlay/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Prettier compatibility — must be last to override formatting rules
  prettierConfig,
);
