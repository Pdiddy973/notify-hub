import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('health', () => {
  const app = buildServer();
  afterAll(() => app.close());

  it('answers GET /health with ok and no login', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
