// @ts-check
import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['**/*.ts'],
    ignores: ['build/', 'node_modules/', 'coverage/', 'vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
      stylistic.configs.customize({
        braceStyle: '1tbs',
        jsx: false,
        quoteProps: 'as-needed',
        semi: true,
      }),
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // == Formatting rules (via @stylistic) ==
      '@stylistic/implicit-arrow-linebreak': 'error',
      '@stylistic/linebreak-style': 'error',
      '@stylistic/max-len': [
        'error', 120, 2,
        {
          ignoreComments: false,
          ignoreUrls: true,
          ignoreRegExpLiterals: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
        },
      ],
      '@stylistic/no-extra-semi': 'error',
      '@stylistic/object-curly-newline': ['error', { multiline: true, consistent: true }],
      '@stylistic/operator-linebreak': [
        'error',
        'before',
        { overrides: { '=': 'after' } },
      ],
      '@stylistic/switch-colon-spacing': 'error',

      // == General TypeScript rules ==
      'no-param-reassign': ['error', { props: true }],
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['private-constructors'] },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],

      // == Angular component rules ==
      '@angular-eslint/component-max-inline-declarations': [
        'error',
        { template: 200, styles: 10 },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/no-conflicting-lifecycle': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signal-model': 'error',
      '@angular-eslint/prefer-signals': [
        'error',
        { useTypeChecking: true },
      ],
      '@angular-eslint/sort-keys-in-type-decorator': 'error',
      '@angular-eslint/sort-lifecycle-methods': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
    },
  },
  {
    files: ['**/*.html'],
    ignores: ['build/', 'node_modules/'],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-duplicate-attributes': [
        'error',
        { allowStylePrecedenceDuplicates: true },
      ],
      '@angular-eslint/template/no-interpolation-in-attributes': [
        'error',
        { allowSubstringInterpolation: true },
      ],
      '@angular-eslint/template/no-empty-control-flow': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-contextual-for-variables': 'error',
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-static-string-properties': 'error',
      '@angular-eslint/template/prefer-template-literal': 'error',
    },
  },
  {
    files: ['**/*.spec.ts'],
    ignores: ['build/', 'node_modules/'],
    rules: {
      // Test files need flexibility for mocks and edge cases
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@stylistic/implicit-arrow-linebreak': 'off',
      '@stylistic/arrow-parens': 'off',
      '@stylistic/max-len': 'off',
    },
  },
  // Disable ESLint rules that conflict with Prettier (must be last)
  prettier,
]);
