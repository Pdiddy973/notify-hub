import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Source } from '../db/index.js';
import type { Ingest } from './index.js';

// The one 404 response, shared by unknown routes and rejected webhooks so nothing can be probed.
export function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'Not Found' });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function flattenHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const flat = headerValue(value);
    if (flat !== undefined) headers[name] = flat;
  }
  return headers;
}

export interface IngestRouteOptions {
  bodyLimit: number;
}

// POST /hook/:sourceId/:token, or /hook/:sourceId with the token in X-Hub-Token.
export function registerIngestRoutes(
  app: FastifyInstance,
  ingest: Ingest,
  { bodyLimit }: IngestRouteOptions,
) {
  const authorized = new WeakMap<FastifyRequest, Source>();

  app.register(async (scope) => {
    // Bodies are kept raw for storage; adapters parse them later.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit }, (_request, body, done) =>
      done(null, body),
    );

    // Runs before the body is read, so a rejected request never reaches storage.
    scope.addHook('onRequest', async (request, reply) => {
      const params = request.params as { sourceId: string; token?: string };
      const source = ingest.authorize({
        sourceId: params.sourceId,
        token: params.token ?? headerValue(request.headers['x-hub-token']),
        method: request.method,
        clientAddress: request.ip,
        userAgent: request.headers['user-agent'],
        contentType: request.headers['content-type'],
        contentLength: Number(request.headers['content-length'] ?? 0) || 0,
      });
      if (!source) return sendNotFound(reply);
      authorized.set(request, source);
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const source = authorized.get(request);
      if (!source) return sendNotFound(reply);
      const body = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
      ingest.accept(source, {
        headers: flattenHeaders(request),
        body,
        contentType: request.headers['content-type'] ?? '',
      });
      return reply.code(202).send({ status: 'accepted' });
    };

    scope.post('/hook/:sourceId/:token', handler);
    scope.post('/hook/:sourceId', handler);
  });
}
