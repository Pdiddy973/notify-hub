import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { builtInAdapters, createRegistry } from './adapters/index.js';
import { createBotApi } from './api/index.js';
import { createPipeline } from './core/index.js';
import { createSqliteDatabase, settingKeys, type Database, type SqliteHandle } from './db/index.js';
import { createBot, type ConnectOptions, type DiscordConnection } from './discord/index.js';
import { createIngest } from './ingest/index.js';
import { createQueue, createWorker, type Worker } from './queue/index.js';
import { createRedactor, createSecretBox } from './security/index.js';
import { buildServer } from './server.js';

export interface HubDeps {
  sqlite: SqliteHandle;
  appSecret: string;
  bodyLimitBytes: number;
  logger?: FastifyServerOptions['logger'];
  // Opens the Discord connection when a bot token and guild are saved.
  connect(options: ConnectOptions): DiscordConnection;
  // How long the delivery worker waits when the queue is empty.
  idleMs?: number;
}

export interface Hub {
  app: FastifyInstance;
  db: Database;
  close(): Promise<void>;
}

// Wires ingest, adapters, router, queue, and bot around one database.
export function createHub({ sqlite, appSecret, bodyLimitBytes, logger, connect, idleMs }: HubDeps): Hub {
  const db = createSqliteDatabase(sqlite, createSecretBox(appSecret));
  let worker: Worker | undefined;
  let discord: DiscordConnection | undefined;
  let closing = false;

  const queue = createQueue(db, { onEnqueue: () => worker?.wake() });
  const pipeline = createPipeline({ db, adapters: createRegistry(builtInAdapters), queue });

  const processMessage = (messageId: number) => {
    // Left as received while closing; processed on the next start.
    if (closing) return;
    try {
      pipeline.process(messageId);
    } catch (err) {
      app.log.error({ err, messageId }, 'Message processing failed');
      db.updateMessage(messageId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const ingest = createIngest({
    db,
    redact: createRedactor(),
    // Processing runs after the 202 response is sent.
    onStored: (messageId) => setImmediate(processMessage, messageId),
  });

  const app = buildServer({
    logger,
    ingest,
    bodyLimitBytes,
    isHealthy: () => db.ping() && (discord?.isReady() ?? true),
  });

  const requeued = db.requeueInterrupted();
  if (requeued > 0) app.log.info({ deliveries: requeued }, 'Requeued interrupted deliveries');
  const unprocessed = db.listMessageIds('received');
  if (unprocessed.length > 0) app.log.info({ messages: unprocessed.length }, 'Processing stored messages');
  for (const messageId of unprocessed) setImmediate(processMessage, messageId);

  const api = createBotApi({ db, queue });
  const token = db.getSetting(settingKeys.discordToken);
  const guildId = db.getSetting(settingKeys.discordGuildId);
  if (token && guildId) {
    const connection = connect({ token, guildId, api, log: app.log });
    discord = connection;
    const bot = createBot({ api, sender: connection.sender });
    worker = createWorker({
      deliverNext: () => bot.deliverNext(),
      isReady: () => connection.isReady(),
      idleMs,
      onError: (err) => app.log.error({ err }, 'Delivery worker error'),
    });
    worker.start();
  } else {
    app.log.warn('Discord is not configured; messages stay queued until it is (npm run seed)');
  }

  return {
    app,
    db,
    async close() {
      closing = true;
      await app.close();
      await worker?.stop();
      await discord?.destroy();
    },
  };
}
