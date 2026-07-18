import tseslint from 'typescript-eslint';
import requireNextInTelegrafMiddleware from './eslint-rules/require-next-in-telegraf-middleware.js';

const telegrafPlugin = {
  rules: {
    'require-next-in-middleware': requireNextInTelegrafMiddleware,
  },
};

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'web/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      telegraf: telegrafPlugin,
    },
    rules: {
      'telegraf/require-next-in-middleware': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      telegraf: telegrafPlugin,
    },
    rules: {
      'telegraf/require-next-in-middleware': 'error',
    },
  },
);

