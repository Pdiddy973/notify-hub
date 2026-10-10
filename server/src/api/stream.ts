import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MessageEvents } from '../core/events.js';
import type { Database, StoredMessage } from '../db/index.js';
import { summarizeMessages } from './messages.js';

export interface StreamOptions {
  db: Database;
  events: MessageEvents;
  // Interval of the comment line that keeps idle proxies from closing the stream.
  keepAliveMs: number;
  // Changes within this window are sent together, one event per message.
  batchMs?: number;
}

// Server-sent events: one `message` event with the log row whenever a message changes.
export function openMessageStream(
  request: FastifyRequest,
  reply: FastifyReply,
  { db, events, keepAliveMs, batchMs = 50 }: StreamOptions,
) {
  reply.hijack();
  const out = reply.raw;
  out.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  out.write(': connected\n\n');

  const pending = new Set<number>();
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const messages = [...pending]
      .map((id) => db.getMessage(id))
      .filter((message): message is StoredMessage => message !== undefined);
    pending.clear();
    for (const summary of summarizeMessages(db, messages)) {
      out.write(`event: message\nid: ${summary.id}\ndata: ${JSON.stringify(summary)}\n\n`);
    }
  };

  const stopListening = events.onChange((messageId) => {
    pending.add(messageId);
    timer ??= setTimeout(flush, batchMs);
  });
  const keepAlive = setInterval(() => out.write(': keep-alive\n\n'), keepAliveMs);

  request.raw.on('close', () => {
    stopListening();
    clearInterval(keepAlive);
    if (timer) clearTimeout(timer);
  });
}
