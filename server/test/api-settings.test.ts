import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN,
  adminClient,
  createTestHub,
  login,
  postHook,
  SOURCE_ID,
  type TestHub,
} from './support/hub.js';

const ALERTS = '300000000000000001';
const NEW_PASSWORD = 'a much longer passphrase';

describe('settings API', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  beforeEach(async () => {
    hub = createTestHub();
    api = await adminClient(hub);
  });
  afterEach(() => hub.close());

  it('returns defaults and saves changes field by field', async () => {
    const initial = (await api('GET', '/api/settings')).json();
    expect(initial).toEqual({
      webhookBaseUrl: null,
      fallbackChannelId: null,
      alertChannelId: null,
      messageRetentionDays: 30,
      bodyLimitKb: 1024,
      version: '0.0.0',
      activeBodyLimitKb: 4,
    });
    const saved = await api('PUT', '/api/settings', { alertChannelId: ALERTS, bodyLimitKb: 2048 });
    expect(saved.json()).toMatchObject({
      alertChannelId: ALERTS,
      bodyLimitKb: 2048,
      fallbackChannelId: null,
    });
    expect((await api('PUT', '/api/settings', { alertChannelId: null })).json().alertChannelId).toBeNull();
    expect((await api('PUT', '/api/settings', { fallbackChannelId: 'general' })).statusCode).toBe(400);
    expect((await api('PUT', '/api/settings', { bodyLimitKb: 1 })).statusCode).toBe(400);
  });

  it('accepts only an http(s) webhook base URL without a trailing slash', async () => {
    const put = (webhookBaseUrl: unknown) => api('PUT', '/api/settings', { webhookBaseUrl });
    expect((await put('http://192.168.1.20:8080')).json().webhookBaseUrl).toBe('http://192.168.1.20:8080');
    expect((await put('https://hub.example/notify')).statusCode).toBe(200);
    for (const bad of [
      'http://192.168.1.20:8080/',
      'ftp://hub',
      'hub.local',
      'http://hub/?x=1',
      'javascript:alert(1)',
    ]) {
      expect((await put(bad)).statusCode, bad).toBe(400);
    }
    expect((await put(null)).json().webhookBaseUrl).toBeNull();
  });

  it('falls back to the defaults when a stored settings group is not an object', async () => {
    for (const stored of ['null', '[]', '"text"', '{not json']) {
      hub.db.setSetting('hub.settings', stored);
      hub.db.setSetting('discarded.settings', stored);
      expect((await api('GET', '/api/settings')).json().bodyLimitKb).toBe(1024);
      expect((await api('GET', '/api/discarded/settings')).json().blockThreshold).toBe(20);
    }
    hub.db.setSetting('hub.settings', '{"bodyLimitKb":"huge","messageRetentionDays":9}');
    expect((await api('GET', '/api/settings')).json()).toMatchObject({
      bodyLimitKb: 1024,
      messageRetentionDays: 9,
    });
  });

  it('applies a saved body limit after a restart, separately from the admin API limit', async () => {
    await hub.close();
    hub = createTestHub({ bodyLimitBytes: null });
    api = await adminClient(hub);
    const body = { event: 'test', severity: 'info', title: 'x'.repeat(30_000) };
    const huge = { event: 'test', severity: 'info', title: 'x'.repeat(1_500_000) };
    expect((await api('GET', '/api/settings')).json().activeBodyLimitKb).toBe(1024);
    expect((await postHook(hub, huge)).statusCode).toBe(413);

    await api('PUT', '/api/settings', { bodyLimitKb: 2048 });
    expect((await postHook(hub, huge)).statusCode).toBe(413);
    await hub.restart();
    expect((await postHook(hub, huge)).statusCode).toBe(202);

    await api('PUT', '/api/settings', { bodyLimitKb: 16 });
    await hub.restart();
    expect((await api('GET', '/api/settings')).json().activeBodyLimitKb).toBe(16);
    expect((await postHook(hub, body)).statusCode).toBe(413);
  });

  it('changes the password only with the current one, ending every other session', async () => {
    const other = await login(hub);
    const wrong = await api('PUT', '/api/settings/password', {
      currentPassword: 'not it',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().issues[0].path).toBe('currentPassword');
    expect(
      (await api('PUT', '/api/settings/password', { currentPassword: ADMIN.password, newPassword: 'short' }))
        .statusCode,
    ).toBe(400);

    const changed = await api('PUT', '/api/settings/password', {
      currentPassword: ADMIN.password,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.statusCode).toBe(204);
    expect((await api('GET', '/api/sources')).statusCode).toBe(200);
    const otherSession = await hub.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie: other },
    });
    expect(otherSession.statusCode).toBe(401);

    const oldLogin = await hub.app.inject({ method: 'POST', url: '/api/login', payload: ADMIN });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await hub.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { ...ADMIN, password: NEW_PASSWORD },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('counts wrong current passwords toward the login lockout', async () => {
    for (let i = 0; i < 5; i++) {
      await api('PUT', '/api/settings/password', { currentPassword: 'guess', newPassword: NEW_PASSWORD });
    }
    const blocked = await api('PUT', '/api/settings/password', {
      currentPassword: ADMIN.password,
      newPassword: NEW_PASSWORD,
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('counts today’s messages, failures, queue depth, and discards on the dashboard', async () => {
    await postHook(hub, { event: 'test', severity: 'info', title: 'Hello' });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    await postHook(hub, { event: 'test', severity: 'info', title: 'Hello' }, { token: 'wrong' });
    await postHook(hub, { event: 'test', severity: 'info', title: 'Hello' }, { token: 'wrong' });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dashboard = (await api('GET', `/api/dashboard?since=${encodeURIComponent(since)}`)).json();
    expect(dashboard).toMatchObject({ messages: 1, failed: 0, unrouted: 0, queueDepth: 0, discarded: 2 });
    expect(dashboard.sources).toEqual([
      { id: SOURCE_ID, name: 'Sonarr', enabled: true, messages: 1, lastReceivedAt: expect.any(String) },
    ]);
    expect((await api('GET', '/api/dashboard?since=yesterday')).statusCode).toBe(400);
  });
});

describe('admin routes added in Phase 3', () => {
  let hub: TestHub;
  beforeEach(() => {
    hub = createTestHub();
  });
  afterEach(() => hub.close());

  it('answer 401 without a session', async () => {
    const routes = [
      ['GET', '/api/adapters'],
      ['POST', '/api/adapters/standard/run-samples'],
      ['PUT', '/api/adapters/standard/permissions'],
      ['GET', `/api/sources/${SOURCE_ID}`],
      ['POST', '/api/sources'],
      ['PATCH', `/api/sources/${SOURCE_ID}`],
      ['DELETE', `/api/sources/${SOURCE_ID}`],
      ['POST', `/api/sources/${SOURCE_ID}/rotate-token`],
      ['POST', `/api/sources/${SOURCE_ID}/url`],
      ['GET', '/api/routes'],
      ['POST', '/api/routes'],
      ['PATCH', '/api/routes/1'],
      ['DELETE', '/api/routes/1'],
      ['PUT', '/api/routes/order'],
      ['POST', '/api/routes/preview'],
      ['GET', '/api/discarded'],
      ['DELETE', '/api/discarded'],
      ['POST', '/api/discarded/unblock'],
      ['GET', '/api/discarded/settings'],
      ['PUT', '/api/discarded/settings'],
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['PUT', '/api/settings/password'],
      ['GET', '/api/dashboard'],
      ['GET', '/api/mutes'],
      ['POST', '/api/mutes'],
      ['DELETE', '/api/mutes/1'],
      ['POST', '/api/messages/1/resend'],
    ] as const;
    for (const [method, url] of routes) {
      const response = await hub.app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(hub.db.getSource(SOURCE_ID)).toBeDefined();
    expect(hub.db.listRoutes()).toHaveLength(1);
  });

  it('refuse changes sent from another site', async () => {
    const cookie = await login(hub);
    const response = await hub.app.inject({
      method: 'POST',
      url: `/api/sources/${SOURCE_ID}/url`,
      headers: { cookie, origin: 'http://attacker.example', host: 'hub.local:8080' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(hub.db.getSource(SOURCE_ID)!.token);
  });
});
