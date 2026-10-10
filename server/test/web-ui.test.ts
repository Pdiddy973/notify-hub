import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestHub, type TestHub } from './support/hub.js';

describe('web UI serving', () => {
  let webRoot: string;
  let hub: TestHub;

  beforeAll(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'notify-hub-web-'));
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Notify Hub</title>');
    writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
  });
  afterAll(() => rmSync(webRoot, { recursive: true, force: true }));
  afterEach(() => hub.close());

  const get = (url: string) => hub.app.inject({ method: 'GET', url });

  it('serves the app at / and for page URLs, without caching index.html', async () => {
    hub = createTestHub({ webRoot });
    for (const url of ['/', '/log', '/setup?step=2']) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('<title>Notify Hub</title>');
      expect(response.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('serves hashed assets with a long cache', async () => {
    hub = createTestHub({ webRoot });
    const response = await get('/assets/app-abc123.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('keeps the JSON 404 for API, hook, and non-GET requests', async () => {
    hub = createTestHub({ webRoot });
    for (const response of [
      await get('/api/nope'),
      await get('/hook/sonarr/token'),
      await hub.app.inject({ method: 'POST', url: '/log' }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Not Found' });
    }
  });

  it('sends security headers', async () => {
    hub = createTestHub({ webRoot });
    const response = await get('/');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('answers page URLs with 404 when no UI is built', async () => {
    hub = createTestHub({ webRoot: join(webRoot, 'missing') });
    expect((await get('/log')).statusCode).toBe(404);
  });
});
