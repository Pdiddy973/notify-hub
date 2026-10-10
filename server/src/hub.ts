import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { builtInAdapters, createRegistry } from './adapters/index.js';
import { createBotApi, registerAdminApi, type DiscordControl } from './api/index.js';
import { createPipeline } from './core/index.js';
import { createMessageEvents, observeDatabase } from './core/events.js';
import { createSqliteDatabase, settingKeys, type Database, type SqliteHandle } from './db/index.js';
import {
  createBot,
  createDiscordRest,
  type ConnectOptions,
  type DiscordConnection,
  type DiscordRest,
} from './discord/index.js';
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
  // Checks bot tokens during setup.
  discordRest?: DiscordRest;
  // Folder with the built web UI.
  webRoot?: string;
  // How long the delivery worker waits when the queue is empty.
  idleMs?: number;
  // Keep-alive interval of the live log stream.
  keepAliveMs?: number;
  // First-run setup code; generated and logged when not given.
  setupCode?: string;
}

export interface Hub {
  app: FastifyInstance;
  db: Database;
  close(): Promise<void>;
}

// Wires ingest, adapters, router, queue, bot, and the admin API around one database.
export function createHub(deps: HubDeps): Hub {
  const { sqlite, appSecret, bodyLimitBytes, logger, connect, webRoot, idleMs, keepAliveMs } = deps;
  const events = createMessageEvents();
  const db = observeDatabase(createSqliteDatabase(sqlite, createSecretBox(appSecret)), events);
  const adapters = createRegistry(builtInAdapters);
  let worker: Worker | undefined;
  let connection: DiscordConnection | undefined;
  let closing = false;

  const queue = createQueue(db, { onEnqueue: () => worker?.wake() });
  const pipeline = createPipeline({ db, adapters, queue });

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
    webRoot,
    isHealthy: () => db.ping() && (connection?.isReady() ?? true),
  });

  const requeued = db.requeueInterrupted();
  if (requeued > 0) app.log.info({ deliveries: requeued }, 'Requeued interrupted deliveries');
  const unprocessed = db.listMessageIds('received');
  if (unprocessed.length > 0) app.log.info({ messages: unprocessed.length }, 'Processing stored messages');
  for (const messageId of unprocessed) setImmediate(processMessage, messageId);

  const botApi = createBotApi({ db, queue });

  async function stopDiscord() {
    await worker?.stop();
    await connection?.destroy();
    worker = undefined;
    connection = undefined;
  }

  // Connects with the saved token and guild, replacing any current connection.
  async function startDiscord() {
    await stopDiscord();
    const token = db.getSetting(settingKeys.discordToken);
    const guildId = db.getSetting(settingKeys.discordGuildId);
    if (!token || !guildId) {
      app.log.warn('Discord is not configured; messages stay queued until setup is finished');
      return;
    }
    const current = connect({ token, guildId, api: botApi, log: app.log });
    connection = current;
    const bot = createBot({ api: botApi, sender: current.sender });
    worker = createWorker({
      deliverNext: () => bot.deliverNext(),
      isReady: () => current.isReady(),
      idleMs,
      onError: (err) => app.log.error({ err }, 'Delivery worker error'),
    });
    worker.start();
  }

  const rest = deps.discordRest ?? createDiscordRest();
  const discord: DiscordControl = {
    status() {
      const guildId = db.getSetting(settingKeys.discordGuildId);
      const botUser = connection?.botUser();
      const guildName = connection?.guildName();
      return {
        configured: Boolean(db.getSetting(settingKeys.discordToken) && guildId),
        connected: connection?.isReady() ?? false,
        ...(botUser ? { botUser } : {}),
        ...(guildId ? { guildId } : {}),
        ...(guildName ? { guildName } : {}),
      };
    },
    restart: startDiscord,
    async syncChannels() {
      if (!connection) throw new Error('The bot is not connected');
      return connection.syncChannels();
    },
    verifyToken: (token) => rest.verifyToken(token),
  };

  registerAdminApi(app, { db, ingest, adapters, discord, events, keepAliveMs, setupCode: deps.setupCode });
  void startDiscord();

  return {
    app,
    db,
    async close() {
      closing = true;
      await app.close();
      await stopDiscord();
    },
  };
}
