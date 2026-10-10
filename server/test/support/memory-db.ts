import type { Database, Delivery, DiscardEntry, Route, Source, StoredMessage } from '../../src/db/index.js';

export interface MemorySeed {
  sources?: Source[];
  routes?: Route[];
}

export interface MemoryDb extends Database {
  discarded: DiscardEntry[];
}

// In-memory Database used by tests in place of SQLite.
export function createMemoryDb(seed: MemorySeed = {}): MemoryDb {
  const sources = new Map((seed.sources ?? []).map((source) => [source.id, source]));
  const routes = [...(seed.routes ?? [])];
  const messages = new Map<number, StoredMessage>();
  const deliveries = new Map<number, Delivery>();
  const discarded: DiscardEntry[] = [];
  let nextMessageId = 1;
  let nextDeliveryId = 1;

  return {
    discarded,
    getSource: (id) => sources.get(id),
    listRoutes: (sourceId) => routes.filter((r) => r.sourceId === sourceId),
    insertMessage(message) {
      const row = { ...message, id: nextMessageId++ };
      messages.set(row.id, row);
      return { ...row };
    },
    getMessage(id) {
      const row = messages.get(id);
      return row && { ...row };
    },
    setMessageStatus(id, status) {
      const row = messages.get(id);
      if (row) row.status = status;
    },
    insertDelivery(delivery) {
      const row = { ...delivery, id: nextDeliveryId++ };
      deliveries.set(row.id, row);
      return { ...row };
    },
    getDelivery(id) {
      const row = deliveries.get(id);
      return row && { ...row };
    },
    listDeliveries: (messageId) =>
      [...deliveries.values()].filter((d) => d.messageId === messageId).map((d) => ({ ...d })),
    oldestQueuedDelivery() {
      const row = [...deliveries.values()].find((d) => d.status === 'queued');
      return row && { ...row };
    },
    updateDelivery(id, changes) {
      const row = deliveries.get(id);
      if (row) Object.assign(row, changes);
    },
    recordDiscard(entry) {
      discarded.push(entry);
    },
  };
}
