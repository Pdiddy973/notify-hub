import { afterEach, describe, expect, it, vi } from 'vitest';
import { severityColors } from '../src/core/index.js';
import { createTestHub, postHook, SOURCE_ID, type TestHub } from './support/hub.js';

const download = { event: 'download', severity: 'success', title: 'Episode downloaded', body: 'Show S02E05' };

describe('pipeline', () => {
  let hub: TestHub;
  afterEach(() => hub.close());

  it('carries a webhook from ingest through adapter, router, queue, and bot to the sender', async () => {
    hub = createTestHub();
    const response = await postHook(hub, download);
    expect(response.statusCode).toBe(202);

    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    const [channelId, embed] = hub.send.mock.calls[0]!;
    expect(channelId).toBe('channel-1');
    expect(embed).toMatchObject({
      author: { name: 'Sonarr' },
      title: 'Episode downloaded',
      description: 'Show S02E05',
      color: severityColors.success,
      footer: { text: 'download' },
    });

    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('delivered'));
    const message = hub.db.getMessage(1)!;
    expect(message.normalized).toEqual([{ ...download, source: SOURCE_ID, timestamp: message.receivedAt }]);
    expect(embed.timestamp).toBe(message.receivedAt);
    expect(hub.db.listDeliveries(1)).toMatchObject([
      { status: 'sent', attempt: 1, discordMessageId: 'discord-1', channelId: 'channel-1' },
    ]);
  });

  it('delivers in the order received', async () => {
    hub = createTestHub();
    for (const title of ['one', 'two', 'three']) await postHook(hub, { ...download, title });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledTimes(3));
    expect(hub.send.mock.calls.map(([, embed]) => embed.title)).toEqual(['one', 'two', 'three']);
  });

  it('sends a fallback error embed and keeps the raw payload when the adapter fails', async () => {
    hub = createTestHub();
    await postHook(hub, '{"title": broken');

    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    expect(hub.send.mock.calls[0]![1]).toMatchObject({
      title: 'Could not read a message from Sonarr',
      color: severityColors.error,
      footer: { text: 'adapter-error' },
    });
    const message = hub.db.getMessage(1)!;
    expect(message.rawPayload).toBe('{"title": broken');
    expect(message.error).toMatch(/JSON/);
  });

  it('treats output that does not match the standard message as an adapter error', async () => {
    hub = createTestHub();
    await postHook(hub, { title: 'No event or severity' });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    expect(hub.db.getMessage(1)?.error).toMatch(/Adapter output is invalid/);
  });

  it('marks a message unrouted when no route matches', async () => {
    hub = createTestHub();
    hub.db.replaceRoutes(SOURCE_ID, []);
    await postHook(hub, download);
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('unrouted'));
    expect(hub.send).not.toHaveBeenCalled();
  });

  it('keeps messages queued while the bot is offline and sends them when it connects', async () => {
    hub = createTestHub({ ready: false });
    await postHook(hub, download);
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('queued'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hub.send).not.toHaveBeenCalled();

    hub.setReady(true);
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('delivered'));
  });

  it('loses nothing across a restart: stored messages are processed and interrupted sends retried', async () => {
    hub = createTestHub({ ready: false });
    await postHook(hub, { ...download, title: 'interrupted' });
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('queued'));
    hub.db.updateDelivery(1, { status: 'sending' });
    hub.db.insertMessage({
      sourceId: SOURCE_ID,
      receivedAt: new Date().toISOString(),
      headers: {},
      rawPayload: JSON.stringify({ ...download, title: 'unprocessed' }),
      rawContentType: 'application/json',
      status: 'received',
    });

    hub.setReady(true);
    await hub.restart();

    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledTimes(2));
    expect(hub.send.mock.calls.map(([, embed]) => embed.title)).toEqual(['interrupted', 'unprocessed']);
    await vi.waitFor(() => expect(hub.db.getMessage(2)?.status).toBe('delivered'));
    expect(hub.db.getMessage(1)?.status).toBe('delivered');
  });

  it('records a failed send on the delivery and the message', async () => {
    hub = createTestHub();
    hub.send.mockRejectedValueOnce(new Error('Missing Permissions'));
    await postHook(hub, download);
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('failed'));
    expect(hub.db.listDeliveries(1)).toMatchObject([{ status: 'failed', error: 'Missing Permissions' }]);
  });

  it('does not connect to Discord until a bot token and guild are saved', async () => {
    hub = createTestHub({ configured: false });
    await postHook(hub, download);
    await vi.waitFor(() => expect(hub.db.getMessage(1)?.status).toBe('queued'));
    expect(hub.connect).not.toHaveBeenCalled();
  });
});
