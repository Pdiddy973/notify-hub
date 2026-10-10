import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type Adapter } from '../src/adapters/index.js';
import { createBotApi } from '../src/api/index.js';
import { defaultConfig } from '../src/config/index.js';
import { createPipeline } from '../src/core/index.js';
import { createBot, type DiscordSender } from '../src/discord/index.js';
import { createIngest } from '../src/ingest/index.js';
import { createQueue } from '../src/queue/index.js';
import { createMemoryDb } from './support/memory-db.js';

const testAdapter: Adapter = {
  id: 'test',
  name: 'Test',
  parse: 'json',
  normalize: ({ body }) => {
    const { event, title } = body as { event: string; title: string };
    return [{ event, severity: 'success', title }];
  },
  samples: [{ name: 'download', body: { event: 'download', title: 'Episode downloaded' } }],
};

describe('pipeline', () => {
  it('carries a webhook from ingest through adapter, router, queue, and bot to the sender', async () => {
    const db = createMemoryDb({
      sources: [
        { id: 'sonarr-main', name: 'Sonarr', type: 'test', token: 'source-token', enabled: true, config: {} },
      ],
      routes: [{ id: 1, sourceId: 'sonarr-main', priority: 1, channelId: 'channel-1', enabled: true }],
    });
    const queue = createQueue(db);
    const pipeline = createPipeline({ db, adapters: createRegistry([testAdapter]), queue });
    const ingest = createIngest({
      config: defaultConfig,
      db,
      redact: (raw) => raw,
      onStored: (id) => pipeline.process(id),
    });
    const send = vi.fn<DiscordSender['send']>().mockResolvedValue({ messageId: 'discord-1' });
    const bot = createBot({ api: createBotApi(queue), sender: { send } });

    const body = JSON.stringify({ event: 'download', title: 'Episode downloaded' });
    const result = ingest({
      sourceId: 'sonarr-main',
      pathToken: 'source-token',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      method: 'POST',
      clientAddress: '192.168.1.20',
      contentType: 'application/json',
      readBody: () => body,
    });
    if (result.status !== 202) throw new Error(`Expected 202, got ${result.status}`);

    expect(await bot.deliverNext()).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        author: { name: 'sonarr-main' },
        title: 'Episode downloaded',
        color: 0x2ecc71,
        footer: { text: 'download' },
      }),
    );
    expect(db.getMessage(result.messageId)?.status).toBe('delivered');
    expect(db.listDeliveries(result.messageId)).toMatchObject([
      { status: 'sent', attempt: 1, discordMessageId: 'discord-1' },
    ]);
    expect(await bot.deliverNext()).toBe(false);
  });
});
