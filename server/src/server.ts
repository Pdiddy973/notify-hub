import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerIngestRoutes, sendNotFound, type Ingest } from './ingest/index.js';

export interface ServerOptions {
  logger?: FastifyServerOptions['logger'];
  // False makes /health answer 503 not ok.
  isHealthy?: () => boolean;
  ingest?: Ingest;
  bodyLimitBytes?: number;
}

// Hides the token segment of webhook URLs in logs.
export function maskHookToken(url: string): string {
  return url.replace(/^(\/hook\/[^/?]+\/)[^/?]+/, '$1[redacted]');
}

// Builds the LAN listener app.
export function buildServer({
  logger = false,
  isHealthy = () => true,
  ingest,
  bodyLimitBytes = 1024 * 1024,
}: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      logger && typeof logger === 'object'
        ? {
            ...logger,
            serializers: {
              req: (request: { method: string; url: string; ip?: string }) => ({
                method: request.method,
                url: maskHookToken(request.url),
                remoteAddress: request.ip,
              }),
            },
          }
        : logger,
    bodyLimit: bodyLimitBytes,
  });

  app.setNotFoundHandler((_request, reply) => sendNotFound(reply));

  // Public liveness check: only ok or not ok, no login.
  app.get(
    '/health',
    {
      logLevel: 'warn',
      schema: {
        response: {
          200: { type: 'object', properties: { status: { const: 'ok' } }, required: ['status'] },
          503: { type: 'object', properties: { status: { const: 'not ok' } }, required: ['status'] },
        },
      },
    },
    async (_request, reply) =>
      isHealthy() ? { status: 'ok' as const } : reply.code(503).send({ status: 'not ok' as const }),
  );

  if (ingest) registerIngestRoutes(app, ingest, { bodyLimit: bodyLimitBytes });

  return app;
}
