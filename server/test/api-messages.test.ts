import type { MessagePage } from '@notify-hub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, login, postHook, SOURCE_ID, type TestHub } from './support/hub.js';

describe('message log API', () => {
  let hub: TestHub;
  let cookie: string;

  beforeEach(async () => {
    hub = createTestHub();
    cookie = await login(hub);
    hub.db.saveChannels('guild', [{ id: 'channel-1', name: 'media', type: 'GuildText' }]);
  });
  afterEach(() => hub.close());

  const get = (url: string) => hub.app.inject({ method: 'GET', url, headers: { cookie } });
  const page = async (query = '') => (await get(`/api/messages${query}`)).json<MessagePage>();

  async function send(messages: object[]) {
    for (const message of messages) await postHook(hub, message);
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledTimes(messages.length));
    await vi.waitFor(async () =>
      expect((await page()).messages.every((m) => m.status === 'delivered')).toBe(true),
    );
  }

  it('lists messages newest first as log rows', async () => {
    await send([
      { event: 'grab', severity: 'info', title: 'Grabbed' },
      { event: 'download', severity: 'success', title: 'Downloaded', apiKey: 'secret' },
    ]);
    expect((await page()).messages).toMatchObject([
      {
        id: 2,
        sourceId: SOURCE_ID,
        sourceName: 'Sonarr',
        status: 'delivered',
        event: 'download',
        severity: 'success',
        title: 'Downloaded',
        destinations: ['media'],
        hasError: false,
      },
      { id: 1, title: 'Grabbed' },
    ]);
  });

  it('filters by status, source, severity, and text in the raw payload', async () => {
    await send([
      { event: 'grab', severity: 'info', title: 'Grabbed', body: 'Show A' },
      { event: 'health', severity: 'error', title: 'Disk full', body: 'Volume /data' },
    ]);
    const ids = async (query: string) => (await page(query)).messages.map((m) => m.id);
    expect(await ids('?severity=error')).toEqual([2]);
    expect(await ids('?q=Show%20A')).toEqual([1]);
    expect(await ids('?q=100%25')).toEqual([]);
    expect(await ids(`?source=${SOURCE_ID}&status=delivered`)).toEqual([2, 1]);
    expect(await ids('?source=other')).toEqual([]);
  });

  it('pages back in time', async () => {
    await send([1, 2, 3].map((n) => ({ event: 'e', severity: 'info', title: `m${n}` })));
    const first = await page('?limit=2');
    expect(first.messages.map((m) => m.id)).toEqual([3, 2]);
    expect(first.nextBefore).toBe(2);
    const second = await page(`?limit=2&before=${first.nextBefore}`);
    expect(second.messages.map((m) => m.id)).toEqual([1]);
    expect(second.nextBefore).toBeUndefined();
  });

  it('rejects an invalid filter with field errors', async () => {
    const response = await get('/api/messages?status=bogus');
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].path).toBe('status');
  });

  it('returns the raw request, normalized message, and deliveries for one message', async () => {
    await send([{ event: 'download', severity: 'success', title: 'Downloaded', apiKey: 'secret' }]);
    const detail = (await get('/api/messages/1')).json();
    expect(detail).toMatchObject({
      id: 1,
      rawContentType: 'application/json',
      headers: { 'content-type': 'application/json' },
      normalized: [{ event: 'download', title: 'Downloaded' }],
      deliveries: [
        {
          channelId: 'channel-1',
          channelName: 'media',
          status: 'sent',
          attempt: 1,
          embed: { title: 'Downloaded' },
        },
      ],
    });
    expect(JSON.parse(detail.rawPayload).apiKey).toBe('[redacted]');
    expect((await get('/api/messages/999')).statusCode).toBe(404);
  });

  it('shows the adapter error of a payload it could not read', async () => {
    await postHook(hub, 'not json');
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    const detail = (await get('/api/messages/1')).json();
    expect(detail.error).toMatch(/JSON/);
    expect(detail.hasError).toBe(true);
  });

  it('lists sources and sends an adapter sample through ingest with the test button', async () => {
    expect((await get('/api/sources')).json()).toEqual([
      { id: SOURCE_ID, name: 'Sonarr', type: 'standard', enabled: true, createdAt: expect.any(String) },
    ]);
    const response = await hub.app.inject({
      method: 'POST',
      url: `/api/sources/${SOURCE_ID}/test`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    expect(hub.send.mock.calls[0]![1].title).toBe('Hello from Notify Hub');
    const missing = await hub.app.inject({
      method: 'POST',
      url: '/api/sources/none/test',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
