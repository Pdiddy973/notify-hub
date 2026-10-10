import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, readVersion } from '../src/config/index.js';

describe('loadConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual(defaultConfig);
  });

  it('reads PORT, UI_PORT, and LOG_LEVEL', () => {
    expect(loadConfig({ PORT: '9000', UI_PORT: '9001', LOG_LEVEL: 'debug' })).toMatchObject({
      port: 9000,
      tunnelPort: 9001,
      logLevel: 'debug',
    });
  });

  it.each([
    { PORT: 'abc' },
    { PORT: '0' },
    { UI_PORT: '70000' },
    { LOG_LEVEL: 'loud' },
  ])('rejects %o', (env) => {
    expect(() => loadConfig(env)).toThrow(/Invalid environment/);
  });
});

describe('readVersion', () => {
  it('reads the root package.json version', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
