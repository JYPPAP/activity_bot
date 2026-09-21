import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'logs/**',
      'readme_src/**',
      '*.cjs',
    ],
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-console': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/(?!.*\\.js$)',
              message: 'Relative imports must include the .js extension.',
            },
          ],
        },
      ],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: 'warn',
    },
  },
  {
    files: ['src/config/logger-termux.js', 'scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
];
