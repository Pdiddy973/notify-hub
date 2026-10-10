import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    // The bot reaches the backend only through the api module.
    files: ['server/src/discord/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['better-sqlite3', 'drizzle-orm'],
          patterns: [
            {
              regex: '(^|/)(db|queue)(/|$)',
              message: 'The bot must use the api module, not the database or queue.',
            },
          ],
        },
      ],
    },
  },
);
