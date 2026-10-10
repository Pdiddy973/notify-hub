import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface ServerOptions {
  logger?: FastifyServerOptions['logger'];
}

// Builds the LAN listener app.
export function buildServer({ logger = false }: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger });

  // Public liveness check: only ok or not ok, no login.
  app.get(
    '/health',
    {
      logLevel: 'warn',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['ok'] } },
            required: ['status'],
          },
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  return app;
}
