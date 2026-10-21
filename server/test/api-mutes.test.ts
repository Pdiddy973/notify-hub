import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminClient, createTestHub, postHook, SOURCE_ID, type TestHub } from './support/hub.js';

const ALERTS = '300000000000000001';
const FALLBACK = '300000000000000003';

describe('mutes', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  let ruleId: number;
  beforeEach(async () => {
    hub = createTestHub();
    hub.db.replaceRoutes(SOURCE_ID, []);
    api = await adminClient(hub);
    ruleId = (await api('POST', '/api/routes', { sourceId: null, channelId: ALERTS })).json().id;
  });
  afterEach(() => hub.close());

  // Sends a message and waits until it is no longer being processed.
  const send = async (body: object) => {
    hub.send.mockClear();
    await postHook(hub, body);
    const id = hub.count('messages');
    await vi.waitFor(() =>
      expect(['delivered', 'muted', 'unrouted', 'dropped', 'failed']).toContain(
        hub.db.getMessage(id)!.status,
      ),
    );
    return { id, status: hub.db.getMessage(id)!.status, channels: hub.send.mock.calls.map((c) => c[0]) };
  };
  const info = { event: 'download', severity: 'info', title: 'Done' };
  const error = { event: 'download', severity: 'error', title: 'Failed' };
  const mute = (body: object) => api('POST', '/api/mutes', { minutes: 60, ...body });

  it('logs a muted source as muted without posting, and posts again once the mute is removed', async () => {
    const created = await mute({ scope: 'source', target: SOURCE_ID, reason: 'maintenance' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      scope: 'source',
      target: SOURCE_ID,
      targetName: 'Sonarr',
      reason: 'maintenance',
    });
    expect(Date.parse(created.json().until) - Date.now()).toBeGreaterThan(59 * 60 * 1000);

    expect(await send(info)).toMatchObject({ status: 'muted', channels: [] });
    expect((await api('GET', '/api/mutes')).json()).toHaveLength(1);

    expect((await api('DELETE', `/api/mutes/${created.json().id}`)).statusCode).toBe(204);
    expect(await send(info)).toMatchObject({ status: 'delivered', channels: [ALERTS] });
  });

  it('ends a mute at its time without a restart', async () => {
    const { id } = (await mute({ scope: 'source', target: SOURCE_ID })).json();
    hub.sqlite.sqlite
      .prepare('UPDATE mutes SET until = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), id);
    expect((await api('GET', '/api/mutes')).json()).toEqual([]);
    expect(await send(info)).toMatchObject({ status: 'delivered' });
  });

  it('keeps sending errors when the mute says so', async () => {
    await mute({ scope: 'source', target: SOURCE_ID, keepErrors: true });
    expect(await send(info)).toMatchObject({ status: 'muted' });
    expect(await send(error)).toMatchObject({ status: 'delivered', channels: [ALERTS] });
  });

  it('mutes one event name from any source, without case', async () => {
    await mute({ scope: 'event', target: 'DOWNLOAD', minutes: null });
    expect((await api('GET', '/api/mutes')).json()[0].until).toBeNull();
    expect(await send(info)).toMatchObject({ status: 'muted' });
    expect(await send({ ...info, event: 'grab' })).toMatchObject({ status: 'delivered' });
  });

  it('mutes a rule without falling back to the fallback channel', async () => {
    await api('PUT', '/api/settings', { fallbackChannelId: FALLBACK });
    await mute({ scope: 'route', target: String(ruleId) });
    expect(await send(info)).toMatchObject({ status: 'muted', channels: [] });
    const preview = await api('POST', '/api/routes/preview', {
      sourceId: SOURCE_ID,
      event: 'x',
      severity: 'info',
    });
    expect(preview.json()).toMatchObject({
      outcome: 'muted',
      checks: [{ routeId: ruleId, matched: true, note: 'rule is muted; nothing sent' }],
      deliveries: [],
    });
  });

  it('validates targets and removes the mutes of deleted sources and rules', async () => {
    expect((await mute({ scope: 'source', target: 'none' })).json().issues[0].path).toBe('target');
    expect((await mute({ scope: 'route', target: '999' })).json().issues[0].path).toBe('target');
    expect((await mute({ scope: 'route', target: 'abc' })).statusCode).toBe(400);
    expect((await mute({ scope: 'planet', target: 'x' })).statusCode).toBe(400);
    expect((await api('DELETE', '/api/mutes/999')).statusCode).toBe(404);

    await mute({ scope: 'route', target: String(ruleId) });
    await mute({ scope: 'source', target: SOURCE_ID });
    await api('DELETE', `/api/routes/${ruleId}`);
    await api('DELETE', `/api/sources/${SOURCE_ID}`);
    expect(hub.count('mutes')).toBe(0);
  });
});

describe('resend', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  beforeEach(async () => {
    hub = createTestHub();
    api = await adminClient(hub);
  });
  afterEach(() => hub.close());

  it('queues failed deliveries again and sends them', async () => {
    hub.send.mockRejectedValueOnce(new Error('Missing Permissions'));
    await postHook(hub, { event: 'test', severity: 'info', title: 'Hi' });
    await vi.waitFor(() => expect(hub.db.getMessage(1)!.status).toBe('failed'));

    const resent = await api('POST', '/api/messages/1/resend');
    expect(resent.json()).toEqual({ requeued: 1, rerouted: false });
    await vi.waitFor(() => expect(hub.db.getMessage(1)!.status).toBe('delivered'));
    const [delivery] = hub.db.listDeliveries(1);
    expect(delivery).toMatchObject({ status: 'sent', attempt: 2 });
    expect(delivery!.error).toBeUndefined();
  });

  it('routes an unrouted or muted message again with the current rules', async () => {
    hub.db.replaceRoutes(SOURCE_ID, []);
    await postHook(hub, { event: 'test', severity: 'info', title: 'Hi' });
    await vi.waitFor(() => expect(hub.db.getMessage(1)!.status).toBe('unrouted'));

    await api('POST', '/api/routes', { sourceId: null, channelId: '300000000000000001' });
    expect((await api('POST', '/api/messages/1/resend')).json()).toEqual({ requeued: 0, rerouted: true });
    await vi.waitFor(() => expect(hub.db.getMessage(1)!.status).toBe('delivered'));
    expect(hub.send).toHaveBeenCalledOnce();

    const again = await api('POST', '/api/messages/1/resend');
    expect(again.statusCode).toBe(409);
    expect(hub.send).toHaveBeenCalledOnce();
    expect((await api('POST', '/api/messages/99/resend')).statusCode).toBe(404);
    expect((await api('POST', '/api/messages/abc/resend')).statusCode).toBe(400);
  });
});
