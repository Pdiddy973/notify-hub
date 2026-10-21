import { createMuteSchema, muteParamsSchema, type MuteInfo } from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import type { Database, Mute } from '../db/index.js';
import { ApiProblem, fieldProblem, parseWith } from './errors.js';

export function registerMuteRoutes(api: FastifyInstance, { db }: { db: Database }) {
  const info = (mute: Mute): MuteInfo => {
    const name =
      mute.scope === 'source'
        ? db.getSource(mute.target)?.name
        : mute.scope === 'route'
          ? (() => {
              const rule = db.getRoute(Number(mute.target));
              return rule && (rule.name || `Rule ${rule.id}`);
            })()
          : undefined;
    return { ...mute, ...(name ? { targetName: name } : {}) };
  };

  // Mutes in effect now, oldest first.
  api.get('/mutes', async (): Promise<MuteInfo[]> => db.listActiveMutes(new Date().toISOString()).map(info));

  api.post('/mutes', async (request, reply) => {
    const { scope, target, minutes, reason, keepErrors } = parseWith(createMuteSchema, request.body);
    if (scope === 'source' && !db.getSource(target)) {
      throw fieldProblem('target', 'There is no source with this id');
    }
    if (scope === 'route' && !(/^\d+$/.test(target) && db.getRoute(Number(target)))) {
      throw fieldProblem('target', 'There is no rule with this id');
    }
    const until = minutes === null ? null : new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const mute = db.insertMute({ scope, target, until, reason, keepErrors });
    return reply.code(201).send(info(mute));
  });

  api.delete('/mutes/:id', async (request, reply) => {
    const { id } = parseWith(muteParamsSchema, request.params);
    if (!db.deleteMute(id)) throw new ApiProblem(404, 'Mute not found');
    return reply.code(204).send();
  });
}
