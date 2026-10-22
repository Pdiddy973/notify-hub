import {
  adapterMessageSchema,
  adapterParamsSchema,
  adapterPermissionsSchema,
  type AdapterInfo,
  type AdapterList,
  type SampleRun,
  type StandardMessage,
} from '@notify-hub/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdapterRegistry } from '../adapters/index.js';
import { renderEmbed } from '../core/index.js';
import { ApiProblem, fieldProblem, parseWith } from './errors.js';

export interface AdapterRouteDeps {
  adapters: AdapterRegistry;
  now?: () => Date;
}

export function registerAdapterRoutes(
  api: FastifyInstance,
  { adapters, now = () => new Date() }: AdapterRouteDeps,
) {
  const loaded = async (params: unknown) => {
    const { id } = parseWith(adapterParamsSchema, params);
    await adapters.ready;
    const adapter = adapters.get(id);
    if (!adapter) throw new ApiProblem(404, 'Adapter not found');
    return adapter;
  };

  api.get('/adapters', async (): Promise<AdapterList> => {
    await adapters.ready;
    return adapters.list();
  });

  // Runs every sample of the adapter in use and renders what it returns.
  api.post('/adapters/:id/run-samples', async (request): Promise<SampleRun[]> => {
    const adapter = await loaded(request.params);
    let results;
    try {
      results = await adapters.runSamples(adapter.id);
    } catch (error) {
      throw new ApiProblem(422, `The samples could not run: ${(error as Error).message}`);
    }
    const timestamp = now().toISOString();
    return results.map(({ name, output, error }): SampleRun => {
      if (error) return { name, error };
      const messages: StandardMessage[] = [];
      for (const item of output ?? []) {
        const parsed = adapterMessageSchema.safeParse(item);
        if (!parsed.success) {
          return { name, error: `Not a standard message:\n${z.prettifyError(parsed.error)}` };
        }
        messages.push({ ...parsed.data, source: adapter.id, timestamp });
      }
      return {
        name,
        messages,
        embeds: messages.map((message) => renderEmbed(message, { sourceName: adapter.name })),
      };
    });
  });

  // Approves permissions the adapter file asks for; anything else is refused.
  api.put('/adapters/:id/permissions', async (request): Promise<AdapterInfo> => {
    const adapter = await loaded(request.params);
    const { approved } = parseWith(adapterPermissionsSchema, request.body);
    const unknown = approved.filter((permission) => !adapter.permissions.includes(permission));
    if (unknown.length) {
      throw fieldProblem('approved', `${adapter.name} does not ask for ${unknown.join(', ')}`);
    }
    await adapters.setApprovals(adapter.id, [...new Set(approved)]);
    const info = adapters.list().adapters.find((item) => item.id === adapter.id && item.active);
    if (!info) throw new ApiProblem(404, 'Adapter not found');
    return info;
  });
}
