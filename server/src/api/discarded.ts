import {
  discardedQuerySchema,
  discardedSettingsSchema,
  unblockSchema,
  type DiscardedPage,
  type DiscardedSettings,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import type { SettingsStore } from '../core/settings.js';
import type { Database } from '../db/index.js';
import { rangeProblem, type AddressBlocker } from '../ingest/index.js';
import { fieldProblem, parseWith } from './errors.js';

export interface DiscardedRouteDeps {
  db: Database;
  settings: SettingsStore;
  blocker: AddressBlocker;
}

export function registerDiscardedRoutes(api: FastifyInstance, { db, settings, blocker }: DiscardedRouteDeps) {
  api.get('/discarded', async (request): Promise<DiscardedPage> => {
    const filter = parseWith(discardedQuerySchema, request.query);
    const sources = new Set(db.listSources().map((source) => source.id));
    return {
      entries: db
        .listDiscarded(filter)
        .map((row) => ({ ...row, sourceExists: sources.has(row.sourceTried) })),
      total: db.countDiscarded(filter),
      blocked: blocker.list(),
    };
  });

  api.delete('/discarded', async () => ({ removed: db.clearDiscarded() }));

  api.post('/discarded/unblock', async (request, reply) => {
    const { address } = parseWith(unblockSchema, request.body);
    blocker.unblock(address);
    return reply.code(204).send();
  });

  api.get('/discarded/settings', async (): Promise<DiscardedSettings> => settings.discarded());

  api.put('/discarded/settings', async (request): Promise<DiscardedSettings> => {
    const changes = parseWith(discardedSettingsSchema.partial(), request.body);
    changes.exemptRanges?.forEach((range, index) => {
      const problem = rangeProblem(range);
      if (problem) throw fieldProblem(`exemptRanges.${index}`, problem);
    });
    const next = settings.updateDiscarded(changes);
    // A lower cap or shorter retention applies at once.
    const before = new Date(Date.now() - next.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    db.pruneDiscarded(before, next.maxRows);
    return next;
  });
}
