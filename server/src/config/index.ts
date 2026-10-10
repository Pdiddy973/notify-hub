import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Config {
  // LAN listener: ingest, health, web UI, and admin API.
  port: number;
  // Localhost listener for the tunnel: web UI and admin API only.
  tunnelPort: number;
  bodyLimitBytes: number;
  logLevel: LogLevel;
}

export const defaultConfig: Config = {
  port: 8080,
  tunnelPort: 8081,
  bodyLimitBytes: 1024 * 1024,
  logLevel: 'info',
};

const port = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  PORT: port.default(defaultConfig.port),
  UI_PORT: port.default(defaultConfig.tunnelPort),
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
    port: parsed.data.PORT,
    tunnelPort: parsed.data.UI_PORT,
    logLevel: parsed.data.LOG_LEVEL,
  };
}

// The version in the root package.json; the release workflow sets it from the tag.
export function readVersion(): string {
  const file = new URL('../../../package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
  return version ?? '0.0.0';
}
