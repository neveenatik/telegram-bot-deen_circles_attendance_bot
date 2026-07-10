import requireNextInTelegrafMiddleware from './eslint-rules/require-next-in-telegraf-middleware.js';

export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      telegraf: {
        rules: {
          'require-next-in-middleware': requireNextInTelegrafMiddleware,
        },
      },
    },
    rules: {
      'telegraf/require-next-in-middleware': 'error',
    },
  },
];
