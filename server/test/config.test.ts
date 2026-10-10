import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, readVersion } from '../src/config/index.js';

const APP_SECRET = 'a'.repeat(64);

describe('loadConfig', () => {
  it('uses the defaults when only APP_SECRET is set', () => {
    expect(loadConfig({ APP_SECRET })).toEqual({ ...defaultConfig, appSecret: APP_SECRET });
  });

  it('reads PORT, UI_PORT, DATA_DIR, and LOG_LEVEL', () => {
    expect(
      loadConfig({ APP_SECRET, PORT: '9000', UI_PORT: '9001', DATA_DIR: './data', LOG_LEVEL: 'debug' }),
    ).toMatchObject({ port: 9000, tunnelPort: 9001, dataDir: './data', logLevel: 'debug' });
  });

  it('requires an APP_SECRET of at least 32 characters', () => {
    expect(() => loadConfig({})).toThrow(/APP_SECRET is required/);
    expect(() => loadConfig({ APP_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it.each([{ PORT: 'abc' }, { PORT: '0' }, { UI_PORT: '70000' }, { LOG_LEVEL: 'loud' }])(
    'rejects %o',
    (env) => {
      expect(() => loadConfig({ APP_SECRET, ...env })).toThrow(/Invalid environment/);
    },
  );
});

describe('readVersion', () => {
  it('reads the root package.json version', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
