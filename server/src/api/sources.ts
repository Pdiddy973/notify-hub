import {
  createSourceSchema,
  sourceParamsSchema,
  updateSourceSchema,
  type SourceDetail,
  type SourceSummary,
  type SourceUrl,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Database, SourceListing } from '../db/index.js';
import type { Ingest } from '../ingest/index.js';
import { generateToken } from '../security/index.js';
import { ApiProblem, parseWith } from './errors.js';

// How long the token from before a rotation keeps working.
export const ROTATION_GRACE_MS = 10 * 60 * 1000;

export interface SourceRouteDeps {
  db: Database;
  ingest: Ingest;
  adapters: AdapterRegistry;
  now?: () => Date;
}

export function registerSourceRoutes(
  api: FastifyInstance,
  { db, ingest, adapters, now = () => new Date() }: SourceRouteDeps,
) {
  const summary = (row: SourceListing): SourceSummary => ({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    createdAt: row.createdAt,
    ...(row.previousTokenExpiresAt && row.previousTokenExpiresAt > now().toISOString()
      ? { previousTokenValidUntil: row.previousTokenExpiresAt }
      : {}),
  });

  const detail = (id: string): SourceDetail => {
    const row = db.listSources().find((source) => source.id === id);
    if (!row) throw new ApiProblem(404, 'Source not found');
    const adapter = adapters.get(row.type);
    const problem = adapterProblem(row.type);
    return {
      ...summary(row),
      ...(adapter ? { adapterName: adapter.name } : {}),
      ...(adapter?.help ? { help: adapter.help } : {}),
      ...(problem ? { adapterProblem: problem } : {}),
    };
  };

  const adapterProblem = (type: string): string | undefined => {
    const info = adapters.list().adapters.find((item) => item.id === type && item.active);
    if (!info) return `There is no ${type} adapter, so webhooks for this source become adapter errors.`;
    if (info.status === 'error') {
      return `The ${info.file} adapter file has a problem; the last working version keeps running.`;
    }
    if (info.status === 'samples-failing') return `Some samples of the ${info.file} adapter fail.`;
    return undefined;
  };

  const sourceId = (params: unknown) => parseWith(sourceParamsSchema, params).id;

  api.get('/sources', async (): Promise<SourceSummary[]> => db.listSources().map(summary));

  api.get('/sources/:id', async (request): Promise<SourceDetail> => {
    await adapters.ready;
    return detail(sourceId(request.params));
  });

  // The token is generated here and never accepted from the browser.
  api.post('/sources', async (request, reply) => {
    const { id, name, type } = parseWith(createSourceSchema, request.body);
    await adapters.ready;
    if (!adapters.get(type)) {
      throw new ApiProblem(400, 'Pick a type', [{ path: 'type', message: `There is no ${type} adapter` }]);
    }
    const created = db.createSource({ id, name, type, token: generateToken(), enabled: true, config: {} });
    if (!created) {
      throw new ApiProblem(409, 'That id is taken', [
        { path: 'id', message: 'A source with this id already exists' },
      ]);
    }
    return reply.code(201).send(detail(id));
  });

  api.patch('/sources/:id', async (request): Promise<SourceDetail> => {
    const id = sourceId(request.params);
    const changes = parseWith(updateSourceSchema, request.body);
    if (!db.updateSource(id, changes)) throw new ApiProblem(404, 'Source not found');
    return detail(id);
  });

  api.delete('/sources/:id', async (request, reply) => {
    const id = sourceId(request.params);
    if (!db.deleteSource(id)) throw new ApiProblem(404, 'Source not found');
    db.deleteMutesFor('source', id);
    return reply.code(204).send();
  });

  // The old token keeps working for ROTATION_GRACE_MS; rotating again ends it at once.
  api.post('/sources/:id/rotate-token', async (request): Promise<SourceDetail> => {
    const id = sourceId(request.params);
    if (!db.getSource(id)) throw new ApiProblem(404, 'Source not found');
    db.rotateSourceToken(id, generateToken(), new Date(now().getTime() + ROTATION_GRACE_MS).toISOString());
    return detail(id);
  });

  // The one response that contains a source token. POST and no-store keep it out of
  // caches and prefetches; the request log records only the method and path.
  api.post('/sources/:id/url', async (request, reply): Promise<SourceUrl> => {
    const source = db.getSource(sourceId(request.params));
    if (!source) throw new ApiProblem(404, 'Source not found');
    reply.header('cache-control', 'no-store');
    return { hookPath: `/hook/${encodeURIComponent(source.id)}/${source.token}` };
  });

  // Sends the adapter's first sample through ingest, like a real webhook.
  api.post('/sources/:id/test', async (request, reply) => {
    const source = db.getSource(sourceId(request.params));
    if (!source) throw new ApiProblem(404, 'Source not found');
    if (!source.enabled)
      throw new ApiProblem(409, 'Turn the source on first; it discards webhooks while off');
    await adapters.ready;
    const adapter = adapters.get(source.type);
    const sample = adapter?.samples[0];
    if (!adapter || !sample) throw new ApiProblem(409, `The ${source.type} adapter has no sample to send`);
    const body =
      adapter.parse === 'json'
        ? JSON.stringify(sample.body)
        : adapter.parse === 'form'
          ? new URLSearchParams(sample.body as Record<string, string>).toString()
          : String(sample.body);
    const contentType =
      adapter.parse === 'json'
        ? 'application/json'
        : adapter.parse === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'text/plain';
    const messageId = ingest.accept(source, {
      headers: { ...sample.headers, 'content-type': contentType, 'user-agent': 'notify-hub test button' },
      body,
      contentType,
    });
    return reply.code(202).send({ messageId });
  });
}
