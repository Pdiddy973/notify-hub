import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminClient, createTestHub, postHook, SOURCE_ID, type TestHub } from './support/hub.js';

const ALERTS = '300000000000000001';
const MEDIA = '300000000000000002';
const FALLBACK = '300000000000000003';

describe('routing API', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  beforeEach(async () => {
    hub = createTestHub();
    // Starts with no rules.
    hub.db.replaceRoutes(SOURCE_ID, []);
    api = await adminClient(hub);
  });
  afterEach(() => hub.close());

  const addRule = async (body: object) => {
    const response = await api('POST', '/api/routes', body);
    expect(response.statusCode).toBe(201);
    return response.json<{ id: number }>();
  };

  const deliveredTo = async (body: object) => {
    hub.send.mockClear();
    expect((await postHook(hub, body)).statusCode).toBe(202);
    const id = hub.count('messages');
    await vi.waitFor(() => {
      const status = hub.db.getMessage(id)!.status;
      expect(['delivered', 'unrouted', 'failed', 'dropped', 'muted']).toContain(status);
    });
    return hub.send.mock.calls.map((call) => call[0]);
  };

  it('creates, edits, and deletes rules with defaults filled in', async () => {
    const created = await addRule({ sourceId: SOURCE_ID, channelId: ALERTS });
    expect(created).toMatchObject({
      name: '',
      sourceId: SOURCE_ID,
      conditions: {},
      enabled: true,
      continueMatching: false,
      priority: 1,
    });
    const edited = await api('PATCH', `/api/routes/${created.id}`, {
      name: 'Errors',
      conditions: { severities: ['error'] },
    });
    expect(edited.json()).toMatchObject({
      name: 'Errors',
      conditions: { severities: ['error'] },
      channelId: ALERTS,
    });
    expect((await api('GET', '/api/routes')).json()).toHaveLength(1);
    expect((await api('DELETE', `/api/routes/${created.id}`)).statusCode).toBe(204);
    expect((await api('DELETE', `/api/routes/${created.id}`)).statusCode).toBe(404);
    expect((await api('PATCH', `/api/routes/${created.id}`, { name: 'x' })).statusCode).toBe(404);
  });

  it('validates channels, sources, and conditions', async () => {
    const channel = await api('POST', '/api/routes', { sourceId: null, channelId: 'general' });
    expect(channel.json().issues[0].path).toBe('channelId');
    const source = await api('POST', '/api/routes', { sourceId: 'none', channelId: ALERTS });
    expect(source.json().issues[0].path).toBe('sourceId');
    const severity = await api('POST', '/api/routes', {
      sourceId: null,
      channelId: ALERTS,
      conditions: { severities: ['loud'] },
    });
    expect(severity.json().issues[0].path).toBe('conditions.severities.0');
    expect((await api('PATCH', '/api/routes/abc', {})).statusCode).toBe(400);
  });

  it('reorders only with the full current list of ids', async () => {
    const a = await addRule({ sourceId: null, channelId: ALERTS });
    const b = await addRule({ sourceId: null, channelId: MEDIA });
    const reordered = await api('PUT', '/api/routes/order', { ids: [b.id, a.id] });
    expect(reordered.json().map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    expect((await api('PUT', '/api/routes/order', { ids: [a.id] })).statusCode).toBe(409);
    expect((await api('PUT', '/api/routes/order', { ids: [a.id, a.id] })).statusCode).toBe(409);
  });

  it('routes by conditions and priority, fans out with continue, and falls back', async () => {
    await addRule({
      sourceId: null,
      channelId: ALERTS,
      conditions: { severities: ['error'] },
      continueMatching: true,
    });
    await addRule({ sourceId: SOURCE_ID, channelId: MEDIA, conditions: { events: ['download'] } });

    expect(await deliveredTo({ event: 'download', severity: 'success', title: 'Done' })).toEqual([MEDIA]);
    expect(await deliveredTo({ event: 'download', severity: 'error', title: 'Failed' })).toEqual([
      ALERTS,
      MEDIA,
    ]);
    expect(await deliveredTo({ event: 'health', severity: 'info', title: 'Hi' })).toEqual([]);
    expect(hub.db.getMessage(hub.count('messages'))!.status).toBe('unrouted');

    await api('PUT', '/api/settings', { fallbackChannelId: FALLBACK });
    expect(await deliveredTo({ event: 'health', severity: 'info', title: 'Hi' })).toEqual([FALLBACK]);
    const summary = (await api('GET', '/api/messages?limit=1')).json().messages[0];
    expect(summary.fallback).toBe(true);
    const detail = (await api('GET', `/api/messages/${summary.id}`)).json();
    expect(detail.deliveries[0]).toMatchObject({ channelId: FALLBACK, fallback: true });
    expect(detail.deliveries[0].routeId).toBeUndefined();
  });

  it('previews where a message would go and why each rule did or did not match', async () => {
    const errors = await addRule({
      sourceId: null,
      channelId: ALERTS,
      conditions: { severities: ['error'] },
    });
    const media = await addRule({ sourceId: SOURCE_ID, channelId: MEDIA });
    const preview = await api('POST', '/api/routes/preview', {
      sourceId: SOURCE_ID,
      event: 'download',
      severity: 'success',
      title: 'Done',
    });
    expect(preview.json()).toEqual({
      checks: [
        { routeId: errors.id, matched: false, reason: 'severity is success, not error' },
        { routeId: media.id, matched: true },
      ],
      deliveries: [{ routeId: media.id, channelId: MEDIA, mentions: [] }],
      outcome: 'sent',
    });
    expect(hub.count('messages')).toBe(0);
    const unknown = await api('POST', '/api/routes/preview', {
      sourceId: 'none',
      event: 'x',
      severity: 'info',
    });
    expect(unknown.json().issues[0].path).toBe('sourceId');
  });

  it('drops matching messages without falling back, after earlier continuing rules sent them', async () => {
    await api('PUT', '/api/settings', { fallbackChannelId: FALLBACK });
    await addRule({
      sourceId: null,
      channelId: ALERTS,
      conditions: { severities: ['error'] },
      continueMatching: true,
    });
    const drop = await addRule({
      sourceId: null,
      action: 'drop',
      channelId: MEDIA,
      mentions: ['@here'],
      conditions: { severities: ['debug', 'error'] },
    });
    expect(drop).toMatchObject({ action: 'drop', channelId: null, mentions: [] });

    expect(await deliveredTo({ event: 'tick', severity: 'debug', title: 'Noise' })).toEqual([]);
    expect(hub.db.getMessage(hub.count('messages'))!.status).toBe('dropped');
    expect(await deliveredTo({ event: 'tick', severity: 'error', title: 'Broken' })).toEqual([ALERTS]);
    expect(await deliveredTo({ event: 'tick', severity: 'info', title: 'Hi' })).toEqual([FALLBACK]);
  });

  it('needs a channel for send rules', async () => {
    const missing = await api('POST', '/api/routes', { sourceId: null });
    expect(missing.json().issues[0].path).toBe('channelId');
    const drop = await addRule({ sourceId: null, action: 'drop' });
    const back = await api('PATCH', `/api/routes/${drop.id}`, { action: 'send' });
    expect(back.json().issues[0].path).toBe('channelId');
    const fixed = await api('PATCH', `/api/routes/${drop.id}`, { action: 'send', channelId: ALERTS });
    expect(fixed.json()).toMatchObject({ action: 'send', channelId: ALERTS });
  });

  it('sends mentions as message text, merged per channel', async () => {
    const ROLE = '<@&400000000000000001>';
    const USER = '<@400000000000000002>';
    await addRule({ sourceId: null, channelId: ALERTS, mentions: [ROLE], continueMatching: true });
    await addRule({ sourceId: null, channelId: ALERTS, mentions: [USER, ROLE] });
    expect(await deliveredTo({ event: 'x', severity: 'error', title: 'Down' })).toEqual([ALERTS]);
    expect(hub.send.mock.calls[0]![2]).toBe(`${ROLE} ${USER}`);
    const detail = (await api('GET', `/api/messages/${hub.count('messages')}`)).json();
    expect(detail.deliveries[0].content).toBe(`${ROLE} ${USER}`);

    const bad = await api('POST', '/api/routes', {
      sourceId: null,
      channelId: ALERTS,
      mentions: ['@admins'],
    });
    expect(bad.json().issues[0].path).toBe('mentions.0');
  });

  it('tests an unsaved rule in place of a saved one, or after all of them', async () => {
    const saved = await addRule({ sourceId: null, channelId: ALERTS, conditions: { severities: ['error'] } });
    const message = { sourceId: SOURCE_ID, event: 'download', severity: 'info' };
    const replaced = await api('POST', '/api/routes/preview', {
      ...message,
      draft: { id: saved.id, sourceId: null, channelId: MEDIA },
    });
    expect(replaced.json()).toMatchObject({
      checks: [{ routeId: 0, matched: true }],
      deliveries: [{ routeId: 0, channelId: MEDIA }],
    });
    const appended = await api('POST', '/api/routes/preview', {
      ...message,
      draft: { sourceId: SOURCE_ID, action: 'drop' },
    });
    expect(appended.json()).toMatchObject({
      checks: [
        { routeId: saved.id, matched: false },
        { routeId: 0, matched: true, note: 'drops the message' },
      ],
      outcome: 'dropped',
    });
    // Nothing is saved.
    expect(hub.db.listRoutes()).toHaveLength(1);
    const unknown = await api('POST', '/api/routes/preview', {
      ...message,
      draft: { id: 999, sourceId: null, channelId: MEDIA },
    });
    expect(unknown.json().issues[0].path).toBe('draft.id');
  });
});
