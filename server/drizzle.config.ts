import { defineConfig } from 'drizzle-kit';

// npm run db:generate -w @notify-hub/server writes a numbered migration from the schema.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
