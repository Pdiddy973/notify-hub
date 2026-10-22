import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminClient,
  CHANNEL_ID,
  createTestHub,
  SOURCE_ID,
  SOURCE_TOKEN,
  type TestHub,
} from './support/hub.js';

const message = { event: 'test', severity: 'info', title: 'Hello' };

describe('sources API', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  beforeEach(async () => {
    hub = createTestHub({ captureLogs: true });
    api = await adminClient(hub);
  });
  afterEach(() => hub.close());

  const hook = (id: string, token: string) =>
    hub.app.inject({
      method: 'POST',
      url: `/hook/${id}/${token}`,
      headers: { 'content-type': 'application/json' },
      payload: message,
    });

  const create = (body: object) => api('POST', '/api/sources', body);
  const tokenOf = (id: string) => hub.db.getSource(id)!.token;

  it('lists adapters with their setup help', async () => {
    const { adapters } = (await api('GET', '/api/adapters')).json();
    expect(adapters).toEqual([
      expect.objectContaining({
        id: 'standard',
        name: 'Standard message',
        help: expect.stringContaining('JSON'),
      }),
    ]);
  });

  it('creates a source with a generated 256-bit token that only the URL endpoint returns', async () => {
    const created = await create({ id: 'radarr-4k', name: 'Radarr 4K', type: 'standard', token: 'mine' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: 'radarr-4k',
      name: 'Radarr 4K',
      type: 'standard',
      enabled: true,
      adapterName: 'Standard message',
      help: expect.any(String),
    });
    const token = tokenOf('radarr-4k');
    expect(token).not.toBe('mine');
    expect(token).toMatch(/^[\w-]{43}$/);

    const responses = [
      created,
      await api('GET', '/api/sources'),
      await api('GET', '/api/sources/radarr-4k'),
      await api('PATCH', '/api/sources/radarr-4k', { name: 'Radarr UHD' }),
    ];
    for (const response of responses) expect(response.body).not.toContain(token);

    const url = await api('POST', '/api/sources/radarr-4k/url');
    expect(url.json()).toEqual({ hookPath: `/hook/radarr-4k/${token}` });
    expect(url.headers['cache-control']).toBe('no-store');
    expect((await hook('radarr-4k', token)).statusCode).toBe(202);

    const stored = JSON.stringify(hub.sqlite.sqlite.prepare('SELECT * FROM sources').all());
    expect(stored).not.toContain(token);
    expect(hub.logs.join('\n')).not.toContain(token);
  });

  it('rejects bad ids, a taken id, the reserved hub id, and unknown types', async () => {
    const badId = await create({ id: 'Bad Id', name: 'X', type: 'standard' });
    expect(badId.statusCode).toBe(400);
    expect(badId.json().issues[0].path).toBe('id');
    expect((await create({ id: 'hub', name: 'X', type: 'standard' })).json().issues[0].path).toBe('id');

    const taken = await create({ id: SOURCE_ID, name: 'X', type: 'standard' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().issues[0].path).toBe('id');
    expect(tokenOf(SOURCE_ID)).toBe(SOURCE_TOKEN);

    const type = await create({ id: 'new', name: 'X', type: 'nope' });
    expect(type.statusCode).toBe(400);
    expect(type.json().issues[0].path).toBe('type');
  });

  it('keeps the old token working for 10 minutes after a rotation, then logs it as expired', async () => {
    const rotated = await api('POST', `/api/sources/${SOURCE_ID}/rotate-token`);
    expect(rotated.statusCode).toBe(200);
    expect(rotated.body).not.toContain(tokenOf(SOURCE_ID));
    const until = Date.parse(rotated.json().previousTokenValidUntil);
    expect(until - Date.now()).toBeGreaterThan(9.9 * 60 * 1000);
    expect(until - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

    const fresh = tokenOf(SOURCE_ID);
    expect(fresh).not.toBe(SOURCE_TOKEN);
    expect((await hook(SOURCE_ID, fresh)).statusCode).toBe(202);
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(202);

    hub.sqlite.sqlite
      .prepare('UPDATE sources SET previous_token_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), SOURCE_ID);
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(404);
    expect(hub.db.listDiscarded()).toMatchObject([{ reason: 'expired token' }]);
    expect((await api('GET', '/api/sources')).json()[0].previousTokenValidUntil).toBeUndefined();
    expect((await hook(SOURCE_ID, fresh)).statusCode).toBe(202);
  });

  it('ends the old token at once when rotated twice', async () => {
    await api('POST', `/api/sources/${SOURCE_ID}/rotate-token`);
    const second = tokenOf(SOURCE_ID);
    await api('POST', `/api/sources/${SOURCE_ID}/rotate-token`);
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(404);
    expect((await hook(SOURCE_ID, second)).statusCode).toBe(202);
  });

  it('discards webhooks for a disabled source and refuses its test button', async () => {
    const disabled = await api('PATCH', `/api/sources/${SOURCE_ID}`, { enabled: false });
    expect(disabled.json().enabled).toBe(false);
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(404);
    expect(hub.db.listDiscarded()).toMatchObject([{ reason: 'disabled source' }]);
    expect((await api('POST', `/api/sources/${SOURCE_ID}/test`)).statusCode).toBe(409);

    await api('PATCH', `/api/sources/${SOURCE_ID}`, { enabled: true });
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(202);
  });

  it('deletes a source with its own rules and keeps its messages in the log', async () => {
    await api('POST', '/api/routes', { sourceId: null, channelId: CHANNEL_ID });
    await hook(SOURCE_ID, SOURCE_TOKEN);
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalled());

    expect((await api('DELETE', `/api/sources/${SOURCE_ID}`)).statusCode).toBe(204);
    expect((await api('GET', `/api/sources/${SOURCE_ID}`)).statusCode).toBe(404);
    expect(hub.db.listRoutes().map((r) => r.sourceId)).toEqual([null]);
    expect(hub.count('messages')).toBe(1);
    expect((await hook(SOURCE_ID, SOURCE_TOKEN)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/sources/${SOURCE_ID}`)).statusCode).toBe(404);
  });

  it('answers 404 for unknown sources on every source route', async () => {
    for (const [method, url] of [
      ['GET', '/api/sources/none'],
      ['PATCH', '/api/sources/none'],
      ['POST', '/api/sources/none/rotate-token'],
      ['POST', '/api/sources/none/url'],
      ['POST', '/api/sources/none/test'],
    ] as const) {
      expect((await api(method, url, method === 'PATCH' ? { name: 'x' } : undefined)).statusCode).toBe(404);
    }
  });
});
