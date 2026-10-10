import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Config {
  // Key material for secrets stored in the database.
  appSecret: string;
  // LAN listener: ingest, health, web UI, and admin API.
  port: number;
  // Localhost listener for the tunnel: web UI and admin API only.
  tunnelPort: number;
  // Holds hub.db, backups, and adapter files.
  dataDir: string;
  bodyLimitBytes: number;
  logLevel: LogLevel;
}

export const defaultConfig: Omit<Config, 'appSecret'> = {
  port: 8080,
  tunnelPort: 8081,
  dataDir: '/var/lib/notify-hub',
  bodyLimitBytes: 1024 * 1024,
  logLevel: 'info',
};

const port = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  APP_SECRET: z
    .string({ error: 'APP_SECRET is required (see .env.example)' })
    .min(32, 'APP_SECRET must be at least 32 characters'),
  PORT: port.default(defaultConfig.port),
  UI_PORT: port.default(defaultConfig.tunnelPort),
  DATA_DIR: z.string().min(1).default(defaultConfig.dataDir),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default(defaultConfig.logLevel),
});

// Reads the environment variables listed in PLAN.md section 12; throws on invalid values.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return {
    ...defaultConfig,
    appSecret: parsed.data.APP_SECRET,
    port: parsed.data.PORT,
    tunnelPort: parsed.data.UI_PORT,
    dataDir: parsed.data.DATA_DIR,
    logLevel: parsed.data.LOG_LEVEL,
  };
}

// The version in the root package.json; the release workflow sets it from the tag.
export function readVersion(): string {
  const file = new URL('../../../package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
  return version ?? '0.0.0';
}
