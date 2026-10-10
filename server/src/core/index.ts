import { adapterMessageSchema, type StandardMessage } from '@notify-hub/shared';
import { z } from 'zod';
import { parseBody, type AdapterRegistry } from '../adapters/index.js';
import type { Database, Route, Source, StoredMessage } from '../db/index.js';
import type { Queue } from '../queue/index.js';
import { renderEmbed } from './render.js';

export { embedLimits, embedLength, renderEmbed, severityColors, truncate } from './render.js';

// Returns the channel of the first enabled route by priority, or null when unrouted.
// Match conditions are not evaluated yet.
export function route(_message: StandardMessage, routes: Route[]): string | null {
  const match = routes.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority)[0];
  return match?.channelId ?? null;
}

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
  process(messageId: number): void;
}

export interface PipelineDeps {
  db: Database;
  adapters: AdapterRegistry;
  queue: Queue;
}

export function createPipeline({ db, adapters, queue }: PipelineDeps): Pipeline {
  return {
    process(messageId) {
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
        messages = adapter
          .normalize({ body, headers: stored.headers, config: source.config })
          .map((output) => adapterMessageSchema.parse(output))
          .map((output) => ({ ...output, source: source.id, timestamp: stored.receivedAt }));
      } catch (error) {
        const text = describeError(error);
        db.updateMessage(messageId, { error: text });
        messages = [fallbackMessage(source, stored, text)];
      }

      if (messages.length === 0) {
        db.updateMessage(messageId, { status: 'dropped', normalized: [] });
        return;
      }
      db.updateMessage(messageId, { status: 'normalized', normalized: messages });

      const routes = db.listRoutes(source.id);
      let queued = 0;
      for (const message of messages) {
        const channelId = route(message, routes);
        if (channelId) {
          queue.enqueue(messageId, channelId, renderEmbed(message, { sourceName: source.name }));
          queued++;
        }
      }
      db.updateMessage(messageId, { status: queued > 0 ? 'queued' : 'unrouted' });
    },
  };
}
