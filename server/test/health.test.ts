import { describe, expect, it } from 'vitest';
import { buildServer, maskHookToken } from '../src/server.js';

describe('health', () => {
  it('answers GET /health with ok and no login', async () => {
    const app = buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('answers 503 not ok when a check fails', async () => {
    const app = buildServer({ isHealthy: () => false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not ok' });
    await app.close();
  });

  it('returns 404 for unknown routes', async () => {
    const app = buildServer();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not Found' });
    await app.close();
  });
});

describe('maskHookToken', () => {
  it('hides the token segment of hook URLs only', () => {
    expect(maskHookToken('/hook/sonarr/abc123')).toBe('/hook/sonarr/[redacted]');
    expect(maskHookToken('/hook/sonarr/abc123?x=1')).toBe('/hook/sonarr/[redacted]?x=1');
    expect(maskHookToken('/hook/sonarr')).toBe('/hook/sonarr');
    expect(maskHookToken('/health')).toBe('/health');
  });
});
