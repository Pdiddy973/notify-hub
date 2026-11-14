import { adapterMessageSchema, type MessageStatus, type StandardMessage } from '@notify-hub/shared';
import { z } from 'zod';
import { AdapterHostClosed, configWithDefaults, parseBody, type AdapterRegistry } from '../adapters/index.js';
import type { Database, Source, StoredMessage } from '../db/index.js';
import type { Queue } from '../queue/index.js';
import { renderEmbed } from './render.js';
import { createMuteCheck, route } from './router.js';
import type { SettingsStore } from './settings.js';

export { embedLimits, embedLength, renderEmbed, severityColors, truncate } from './render.js';
export {
  conditionsMismatch,
  createMuteCheck,
  noMutes,
  route,
  type MuteCheck,
  type RoutableMessage,
} from './router.js';
export { createSettingsStore, type SettingsStore } from './settings.js';

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) return `Adapter output is invalid:\n${z.prettifyError(error)}`;
  return error instanceof Error ? error.message : String(error);
}

// Plain error message sent in place of the adapter's output when it fails.
function fallbackMessage(source: Source, stored: StoredMessage, error: string): StandardMessage {
  return {
    source: source.id,
    event: 'adapter-error',
    severity: 'error',
    title: `Could not read a message from ${source.name}`,
    body: `${error}\n\nThe raw payload is kept in the hub log as message #${stored.id}.`,
    timestamp: stored.receivedAt,
  };
}

export interface Pipeline {
  // Normalizes a stored message, routes it, and queues one delivery per routed result.
  // Rejects only when the adapter worker shuts down; the message then stays received.
  process(messageId: number): Promise<void>;
  // Routes an already normalized message again, replacing its deliveries; false when it
  // has nothing to route.
  reroute(messageId: number): boolean;
}

export interface PipelineDeps {
  db: Database;
  adapters: AdapterRegistry;
  queue: Queue;
  settings: SettingsStore;
}

export function createPipeline({ db, adapters, queue, settings }: PipelineDeps): Pipeline {
  return {
    async process(messageId) {
      await adapters.ready;
      const stored = db.getMessage(messageId);
      if (!stored) return;
      const source = db.getSource(stored.sourceId);
      if (!source) {
        db.updateMessage(messageId, { status: 'failed', error: `Source ${stored.sourceId} not found` });
        return;
      }

      let messages: StandardMessage[];
      try {
        const adapter = adapters.get(source.type);
        if (!adapter) throw new Error(`No adapter named ${source.type}`);
        const body = parseBody(stored.rawPayload, adapter.parse);
        const outputs = await adapters.normalize(adapter.id, {
          body,
          headers: stored.headers,
          config: configWithDefaults(adapter.config, source.config),
        });
        messages = outputs
          .map((output) => adapterMessageSchema.parse(output))
          .map((output) => ({ ...output, source: source.id, timestamp: stored.receivedAt }));
      } catch (error) {
        if (error instanceof AdapterHostClosed) throw error;
        const text = describeError(error);
        db.updateMessage(messageId, { error: text });
        messages = [fallbackMessage(source, stored, text)];
      }

      if (messages.length === 0) {
        db.updateMessage(messageId, { status: 'dropped', normalized: [] });
        return;
      }
      db.updateMessage(messageId, { status: 'normalized', normalized: messages });
      routeStored(source, messageId, messages);
    },

    reroute(messageId) {
      const stored = db.getMessage(messageId);
      const source = stored && db.getSource(stored.sourceId);
      if (!stored?.normalized?.length || !source) return false;
      db.deleteDeliveries(messageId);
      routeStored(source, messageId, stored.normalized);
      return true;
    },
  };

  // Routes each normalized message with the current rules and mutes, queueing one
  // delivery per channel.
  function routeStored(source: Source, messageId: number, messages: StandardMessage[]) {
    const routes = db.listRoutes();
    const { fallbackChannelId } = settings.hub();
    const mutes = createMuteCheck(db.listActiveMutes(new Date().toISOString()));
    const outcomes = new Set<string>();
    for (const message of messages) {
      const result = route(message, source.id, routes, fallbackChannelId, mutes);
      outcomes.add(result.outcome);
      for (const { channelId, routeId, mentions } of result.deliveries) {
        const embed = renderEmbed(message, { sourceName: source.name });
        queue.enqueue(messageId, channelId, embed, {
          ...(routeId === null ? { fallback: true } : { routeId }),
          ...(mentions.length ? { content: mentions.join(' ') } : {}),
        });
      }
    }
    const status: MessageStatus = outcomes.has('sent')
      ? 'queued'
      : outcomes.has('muted')
        ? 'muted'
        : outcomes.has('dropped')
          ? 'dropped'
          : 'unrouted';
    db.updateMessage(messageId, { status });
  }
}
