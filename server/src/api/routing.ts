import {
  createRouteSchema,
  DRAFT_ROUTE_ID,
  reorderRoutesSchema,
  routeParamsSchema,
  routePreviewSchema,
  updateRouteSchema,
  type RouteInfo,
  type RoutePreview,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import { createMuteCheck, route } from '../core/router.js';
import type { SettingsStore } from '../core/settings.js';
import type { Database, NewRoute, Route } from '../db/index.js';
import { ApiProblem, fieldProblem, parseWith } from './errors.js';

export interface RoutingRouteDeps {
  db: Database;
  settings: SettingsStore;
}

export function registerRoutingRoutes(api: FastifyInstance, { db, settings }: RoutingRouteDeps) {
  const routeId = (params: unknown) => parseWith(routeParamsSchema, params).id;

  // Checks a rule as it will be saved; drop rules keep no channel or mentions.
  const checked = <T extends NewRoute>(rule: T, existing?: Route): T => {
    const merged = { ...existing, ...rule };
    if (merged.sourceId && !db.getSource(merged.sourceId)) {
      throw fieldProblem('sourceId', 'There is no source with this id');
    }
    if (merged.action === 'drop') return { ...rule, channelId: null, mentions: [] };
    if (!merged.channelId) throw fieldProblem('channelId', 'Pick the channel to send to');
    return rule;
  };

  api.get('/routes', async (): Promise<RouteInfo[]> => db.listRoutes());

  // New rules are checked after the existing ones.
  api.post('/routes', async (request, reply) => {
    const rule = checked(parseWith(createRouteSchema, request.body));
    return reply.code(201).send(db.insertRoute(rule));
  });

  api.patch('/routes/:id', async (request): Promise<RouteInfo> => {
    const id = routeId(request.params);
    const existing = db.getRoute(id);
    if (!existing) throw new ApiProblem(404, 'Rule not found');
    const changes = checked(parseWith(updateRouteSchema, request.body), existing);
    return db.updateRoute(id, changes)!;
  });

  api.delete('/routes/:id', async (request, reply) => {
    const id = routeId(request.params);
    if (!db.deleteRoute(id)) throw new ApiProblem(404, 'Rule not found');
    db.deleteMutesFor('route', String(id));
    return reply.code(204).send();
  });

  // Takes every rule id in the new order, so a list changed elsewhere is not reordered blindly.
  api.put('/routes/order', async (request): Promise<RouteInfo[]> => {
    const { ids } = parseWith(reorderRoutesSchema, request.body);
    const current = db.listRoutes().map((rule) => rule.id);
    const same = ids.length === current.length && new Set(ids).size === ids.length;
    if (!same || !current.every((id) => ids.includes(id))) {
      throw new ApiProblem(409, 'The rules changed since the page loaded; reload and try again');
    }
    db.reorderRoutes(ids);
    return db.listRoutes();
  });

  // Runs a message through the saved rules, or with an unsaved draft rule, and the
  // active mutes, without sending anything.
  api.post('/routes/preview', async (request): Promise<RoutePreview> => {
    const { sourceId, draft, ...message } = parseWith(routePreviewSchema, request.body);
    if (!db.getSource(sourceId)) throw fieldProblem('sourceId', 'There is no source with this id');
    let rules = db.listRoutes();
    let replacedId: number | undefined;
    if (draft) {
      const { id, ...fields } = draft;
      const replaced = id === undefined ? undefined : rules.find((rule) => rule.id === id);
      if (id !== undefined && !replaced) throw fieldProblem('draft.id', 'Rule not found');
      const rule: Route = {
        ...checked(fields),
        id: DRAFT_ROUTE_ID,
        priority: replaced?.priority ?? Math.max(0, ...rules.map((r) => r.priority)) + 1,
      };
      rules = [...rules.filter((r) => r.id !== id), rule];
      replacedId = id;
    }
    const active = createMuteCheck(db.listActiveMutes(new Date().toISOString()));
    // A draft that replaces a saved rule keeps that rule's mutes.
    const mutes = {
      ...active,
      forRoute: (id: number, routed: Parameters<typeof active.forRoute>[1]) =>
        active.forRoute(id === DRAFT_ROUTE_ID && replacedId !== undefined ? replacedId : id, routed),
    };
    return route(message, sourceId, rules, settings.hub().fallbackChannelId, mutes);
  });
}
