import {
  changePasswordSchema,
  dashboardQuerySchema,
  HUB_SOURCE_ID,
  updateHubSettingsSchema,
  type DashboardInfo,
  type SettingsInfo,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import type { SettingsStore } from '../core/settings.js';
import { settingKeys, type Database } from '../db/index.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import type { Auth, LoginLimiter } from './auth.js';
import { ApiProblem, fieldProblem, parseWith } from './errors.js';

export interface SettingsRouteDeps {
  db: Database;
  settings: SettingsStore;
  auth: Auth;
  limiter: LoginLimiter;
  version: string;
  activeBodyLimitBytes: number;
}

export function registerSettingsRoutes(api: FastifyInstance, deps: SettingsRouteDeps) {
  const { db, settings, auth, limiter, version, activeBodyLimitBytes } = deps;

  const info = (): SettingsInfo => ({
    ...settings.hub(),
    version,
    activeBodyLimitKb: Math.round(activeBodyLimitBytes / 1024),
  });

  api.get('/settings', async (): Promise<SettingsInfo> => info());

  api.put('/settings', async (request): Promise<SettingsInfo> => {
    settings.updateHub(parseWith(updateHubSettingsSchema, request.body));
    return info();
  });

  // Asks for the current password, then ends every other session.
  api.put('/settings/password', async (request, reply) => {
    if (limiter.blocked(request.ip)) {
      throw new ApiProblem(429, 'Too many wrong passwords; wait a few minutes and try again');
    }
    const { currentPassword, newPassword } = parseWith(changePasswordSchema, request.body);
    const hash = db.getSetting(settingKeys.adminPasswordHash);
    if (!hash || !(await verifyPassword(hash, currentPassword))) {
      limiter.fail(request.ip);
      throw fieldProblem('currentPassword', 'That is not the current password');
    }
    db.setSetting(settingKeys.adminPasswordHash, await hashPassword(newPassword));
    const ended = auth.endOtherSessions(request);
    request.log.info({ endedSessions: ended }, 'Admin password changed');
    return reply.code(204).send();
  });

  api.get('/dashboard', async (request): Promise<DashboardInfo> => {
    const query = parseWith(dashboardQuerySchema, request.query);
    const since = new Date(query.since ?? Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stats = db.messageStats(since);
    const counts = new Map(stats.bySource.map((row) => [row.sourceId, row.count]));
    const last = db.lastMessageTimes();
    return {
      since,
      messages: stats.total,
      failed: stats.failed,
      unrouted: stats.unrouted,
      queueDepth: db.queueDepth(),
      discarded: db.discardedSince(since),
      sources: db
        .listSources()
        .filter((source) => source.id !== HUB_SOURCE_ID)
        .map((source) => ({
          id: source.id,
          name: source.name,
          enabled: source.enabled,
          messages: counts.get(source.id) ?? 0,
          ...(last.has(source.id) ? { lastReceivedAt: last.get(source.id)! } : {}),
        })),
    };
  });
}
