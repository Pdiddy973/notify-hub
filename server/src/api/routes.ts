import fastifyCookie from '@fastify/cookie';
import {
  discordSettingsSchema,
  discordVerifySchema,
  loginSchema,
  messageParamsSchema,
  messageQuerySchema,
  setupAccountSchema,
  setupFinishSchema,
  type ChannelInfo,
  type DiscordStatus,
  type DiscordVerifyResult,
  type MessagePage,
  type SessionInfo,
  type ResendResult,
  type SetupFinishResult,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import type { AdapterRegistry } from '../adapters/index.js';
import type { MessageEvents } from '../core/events.js';
import type { Pipeline } from '../core/index.js';
import type { SettingsStore } from '../core/settings.js';
import { settingKeys, type Database } from '../db/index.js';
import { botTokenProblem, DiscordTokenRejected } from '../discord/index.js';
import type { AddressBlocker, Ingest } from '../ingest/index.js';
import type { Queue } from '../queue/index.js';
import { generateSetupCode, generateToken, setupCodesMatch } from '../security/index.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { registerAdapterRoutes } from './adapters.js';
import { createAuth, createLoginLimiter } from './auth.js';
import { registerDiscardedRoutes } from './discarded.js';
import { ApiProblem, fieldProblem, parseWith } from './errors.js';
import { messageDetail, summarizeMessages } from './messages.js';
import { registerMuteRoutes } from './mutes.js';
import { registerRoutingRoutes } from './routing.js';
import { registerSettingsRoutes } from './settings.js';
import { registerSourceRoutes } from './sources.js';
import { openMessageStream } from './stream.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    // Reachable without a login.
    public?: boolean;
  }
}

// What the admin API needs from the Discord side of the hub.
export interface DiscordControl {
  status(): DiscordStatus;
  // Reconnects with the saved token and guild.
  restart(): Promise<void>;
  syncChannels(): Promise<number>;
  verifyToken(token: string): Promise<DiscordVerifyResult>;
}

export interface AdminApiDeps {
  db: Database;
  ingest: Ingest;
  pipeline: Pipeline;
  queue: Queue;
  adapters: AdapterRegistry;
  discord: DiscordControl;
  events: MessageEvents;
  settings: SettingsStore;
  blocker: AddressBlocker;
  version: string;
  // The webhook body limit in use since the hub started.
  activeBodyLimitBytes: number;
  keepAliveMs?: number;
  // One-time code the first-run setup asks for; generated when not given.
  setupCode?: string;
}

export const TEST_SOURCE_ID = 'test';

// True when the Origin header names the same host the request was sent to.
function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The admin API under /api; everything except the routes marked public needs a login.
export function registerAdminApi(app: FastifyInstance, deps: AdminApiDeps) {
  const { db, ingest, pipeline, queue, adapters, discord, events, settings, blocker } = deps;
  const keepAliveMs = deps.keepAliveMs ?? 15_000;
  const setupCode = deps.setupCode ?? generateSetupCode();

  app.register(
    async (api) => {
      await api.register(fastifyCookie);
      const auth = createAuth(db);
      // Counts failed logins and wrong setup codes together.
      const limiter = createLoginLimiter();
      const hasAdmin = () => Boolean(db.getSetting(settingKeys.adminPasswordHash));

      if (!hasAdmin()) {
        api.log.warn(
          `First-run setup code: ${setupCode} (enter it on the setup page; it works until the admin account exists)`,
        );
      }

      api.setErrorHandler((error, request, reply) => {
        if (error instanceof ApiProblem) return reply.code(error.statusCode).send(error.toJSON());
        const status = (error as { statusCode?: number }).statusCode ?? 500;
        if (status < 500) return reply.code(status).send({ error: (error as Error).message });
        request.log.error({ err: error }, 'Admin API error');
        return reply.code(500).send({ error: 'Something went wrong; see the hub log' });
      });

      api.addHook('onRequest', async (request, reply) => {
        // Blocks cross-site form posts: a browser always sends Origin on these methods.
        const origin = request.headers.origin;
        if (UNSAFE_METHODS.has(request.method) && origin && !sameOrigin(origin, request.headers.host)) {
          return reply.code(403).send({ error: 'Request from another site refused' });
        }
        if (request.routeOptions.config.public) return;
        if (!auth.currentUser(request)) return reply.code(401).send({ error: 'Log in to continue' });
      });

      // Session and setup

      api.get('/session', { config: { public: true } }, async (request): Promise<SessionInfo> => {
        const username = auth.currentUser(request);
        return {
          hasAdmin: hasAdmin(),
          setupComplete: Boolean(db.getSetting(settingKeys.setupCompletedAt)),
          authenticated: username !== null,
          ...(username ? { username } : {}),
        };
      });

      api.post('/setup/account', { config: { public: true } }, async (request, reply) => {
        if (hasAdmin()) throw new ApiProblem(409, 'An admin account already exists; log in instead');
        if (limiter.blocked(request.ip)) {
          throw new ApiProblem(429, 'Too many wrong setup codes; wait a few minutes and try again');
        }
        const { username, password, setupCode: given } = parseWith(setupAccountSchema, request.body);
        if (!setupCodesMatch(given, setupCode)) {
          limiter.fail(request.ip);
          throw fieldProblem(
            'setupCode',
            'That setup code is not right; check the hub log for the current one',
          );
        }
        db.setSetting(settingKeys.adminUsername, username);
        db.setSetting(settingKeys.adminPasswordHash, await hashPassword(password));
        auth.startSession(request, reply);
        return reply.code(201).send({ username });
      });

      api.post('/login', { config: { public: true } }, async (request, reply) => {
        if (limiter.blocked(request.ip)) {
          throw new ApiProblem(429, 'Too many failed logins; wait a few minutes and try again');
        }
        const { username, password } = parseWith(loginSchema, request.body);
        const passwordHash = db.getSetting(settingKeys.adminPasswordHash);
        if (!passwordHash) throw new ApiProblem(409, 'Finish the first-run setup first');
        const passwordOk = await verifyPassword(passwordHash, password);
        if (!passwordOk || username !== db.getSetting(settingKeys.adminUsername)) {
          limiter.fail(request.ip);
          throw new ApiProblem(401, 'Wrong username or password');
        }
        limiter.reset(request.ip);
        auth.startSession(request, reply);
        return { username };
      });

      api.post('/logout', { config: { public: true } }, async (request, reply) => {
        auth.endSession(request, reply);
        return reply.code(204).send();
      });

      api.post('/setup/finish', async (request): Promise<SetupFinishResult> => {
        const { channelId } = parseWith(setupFinishSchema, request.body);
        if (!db.getSetting(settingKeys.discordToken) || !db.getSetting(settingKeys.discordGuildId)) {
          throw new ApiProblem(409, 'Connect the Discord bot first');
        }
        const token = db.getSource(TEST_SOURCE_ID)?.token ?? generateToken();
        db.saveSource({
          id: TEST_SOURCE_ID,
          name: 'Test',
          type: 'standard',
          token,
          enabled: true,
          config: {},
        });
        db.replaceRoutes(TEST_SOURCE_ID, [{ name: 'Test messages', channelId }]);
        db.setSetting(settingKeys.setupCompletedAt, new Date().toISOString());
        return { sourceId: TEST_SOURCE_ID };
      });

      // Discord

      api.post('/discord/verify', async (request): Promise<DiscordVerifyResult> => {
        const { botToken } = parseWith(discordVerifySchema, request.body);
        const problem = botTokenProblem(botToken);
        if (problem) throw fieldProblem('botToken', problem);
        try {
          return await discord.verifyToken(botToken);
        } catch (error) {
          if (error instanceof DiscordTokenRejected) throw fieldProblem('botToken', error.message);
          throw new ApiProblem(502, `Could not reach Discord: ${(error as Error).message}`);
        }
      });

      api.get('/discord', async (): Promise<DiscordStatus> => discord.status());

      api.put('/discord', async (request): Promise<DiscordStatus> => {
        const { botToken, guildId } = parseWith(discordSettingsSchema, request.body);
        if (botToken) {
          const problem = botTokenProblem(botToken);
          if (problem) throw fieldProblem('botToken', problem);
          db.setSetting(settingKeys.discordToken, botToken, { encrypted: true });
        } else if (!db.getSetting(settingKeys.discordToken)) {
          throw fieldProblem('botToken', 'Paste the bot token');
        }
        db.setSetting(settingKeys.discordGuildId, guildId);
        await discord.restart();
        return discord.status();
      });

      api.post('/discord/sync-channels', async () => {
        if (!discord.status().connected) throw new ApiProblem(409, 'The bot is not connected to Discord');
        await discord.syncChannels();
        return { channels: listGuildChannels() };
      });

      const listGuildChannels = (): ChannelInfo[] => {
        const guildId = db.getSetting(settingKeys.discordGuildId);
        return db
          .listChannels()
          .filter((channel) => channel.guildId === guildId)
          .map(({ id, name, type }) => ({ id, name, type }));
      };

      api.get('/channels', async (): Promise<ChannelInfo[]> => listGuildChannels());

      registerSourceRoutes(api, { db, ingest, adapters });
      registerAdapterRoutes(api, { adapters });
      registerRoutingRoutes(api, { db, settings });
      registerMuteRoutes(api, { db });
      registerDiscardedRoutes(api, { db, settings, blocker });
      registerSettingsRoutes(api, {
        db,
        settings,
        auth,
        limiter,
        version: deps.version,
        activeBodyLimitBytes: deps.activeBodyLimitBytes,
      });

      // Messages

      api.get('/messages', async (request): Promise<MessagePage> => {
        const { limit, ...filter } = parseWith(messageQuerySchema, request.query);
        const rows = db.listMessages({ ...filter, limit: limit + 1 });
        const page = rows.slice(0, limit);
        return {
          messages: summarizeMessages(db, page),
          ...(rows.length > limit ? { nextBefore: page[page.length - 1]!.id } : {}),
        };
      });

      api.get('/messages/:id', async (request) => {
        const { id } = parseWith(messageParamsSchema, request.params);
        const message = db.getMessage(id);
        if (!message) throw new ApiProblem(404, 'Message not found');
        return messageDetail(db, message);
      });

      // Queues failed deliveries again; a message that was not sent anywhere is routed
      // again with the current rules and mutes.
      api.post('/messages/:id/resend', async (request): Promise<ResendResult> => {
        const { id } = parseWith(messageParamsSchema, request.params);
        const message = db.getMessage(id);
        if (!message) throw new ApiProblem(404, 'Message not found');
        const requeued = queue.retryFailed(id);
        if (requeued > 0) return { requeued, rerouted: false };
        if (['unrouted', 'muted', 'dropped'].includes(message.status) && pipeline.reroute(id)) {
          return { requeued: 0, rerouted: true };
        }
        throw new ApiProblem(409, 'Nothing to resend: no delivery failed and the message was already routed');
      });

      api.get('/stream', async (request, reply) => {
        openMessageStream(request, reply, { db, events, keepAliveMs });
      });
    },
    { prefix: '/api' },
  );
}
