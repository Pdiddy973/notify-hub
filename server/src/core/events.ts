import type { Database } from '../db/index.js';

// Tells listeners which message changed; the live log feed subscribes to it.
export interface MessageEvents {
  // Returns a function that removes the listener.
  onChange(listener: (messageId: number) => void): () => void;
  emit(messageId: number): void;
}

export function createMessageEvents(): MessageEvents {
  const listeners = new Set<(messageId: number) => void>();
  return {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(messageId) {
      for (const listener of listeners) listener(messageId);
    },
  };
}

// Wraps a database so every write to a message or its deliveries emits an event.
export function observeDatabase(db: Database, events: MessageEvents): Database {
  return {
    ...db,
    insertMessage(message) {
      const stored = db.insertMessage(message);
      events.emit(stored.id);
      return stored;
    },
    updateMessage(id, changes) {
      db.updateMessage(id, changes);
      events.emit(id);
    },
    insertDelivery(delivery) {
      const stored = db.insertDelivery(delivery);
      events.emit(stored.messageId);
      return stored;
    },
    updateDelivery(id, changes) {
      db.updateDelivery(id, changes);
      const delivery = db.getDelivery(id);
      if (delivery) events.emit(delivery.messageId);
    },
  };
}
