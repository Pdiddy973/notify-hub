import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerIngestRoutes, sendNotFound, type Ingest } from './ingest/index.js';

export interface ServerOptions {
  logger?: FastifyServerOptions['logger'];
  // False makes /health answer 503 not ok.
  isHealthy?: () => boolean;
  ingest?: Ingest;
  bodyLimitBytes?: number;
  // Folder with the built web UI; not served when missing.
  webRoot?: string;
}

// Hides the token segment of webhook URLs in logs.
export function maskHookToken(url: string): string {
  return url.replace(/^(\/hook\/[^/?]+\/)[^/?]+/, '$1[redacted]');
}

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // Embed previews show images from any https host.
  'content-security-policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// Paths that never fall back to the web UI.
const NON_UI_PATH = /^\/(api|hook|health)(\/|\?|$)/;

// Builds the LAN listener app.
export function buildServer({
  logger = false,
  isHealthy = () => true,
  ingest,
  bodyLimitBytes = 1024 * 1024,
  webRoot,
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
    // Live log streams stay open; closing the server ends them.
    forceCloseConnections: true,
  });

  app.addHook('onSend', async (_request, reply) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
  });

  const serveUi = webRoot !== undefined && existsSync(join(webRoot, 'index.html'));
  if (serveUi) {
    app.register(fastifyStatic, {
      root: webRoot,
      setHeaders(reply, path) {
        // Built assets have content hashes in their names; index.html must stay fresh.
        reply.header(
          'cache-control',
          path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
  }

  // Page URLs such as /log load the web UI, which routes them in the browser.
  app.setNotFoundHandler((request, reply) => {
    if (serveUi && request.method === 'GET' && !NON_UI_PATH.test(request.url)) {
      return reply.sendFile('index.html');
    }
    return sendNotFound(reply);
  });

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
