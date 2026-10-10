import type { Embed } from '@notify-hub/shared';
import type { Database, Delivery } from '../db/index.js';

export { createWorker, type Worker, type WorkerOptions } from './worker.js';

export interface Queue {
  enqueue(messageId: number, channelId: string, embed: Embed): Delivery;
  // Takes the oldest queued delivery and marks it as sending.
  claim(): Delivery | undefined;
  complete(deliveryId: number, discordMessageId: string): void;
  fail(deliveryId: number, error: string): void;
}

export interface QueueOptions {
  // Called after each enqueue, so a waiting worker can start at once.
  onEnqueue?: () => void;
}

export function createQueue(db: Database, { onEnqueue }: QueueOptions = {}): Queue {
  return {
    enqueue(messageId, channelId, embed) {
      const delivery = db.insertDelivery({ messageId, channelId, embed, attempt: 0, status: 'queued' });
      onEnqueue?.();
      return delivery;
    },

    claim() {
      const delivery = db.oldestQueuedDelivery();
      if (!delivery) return undefined;
      const attempt = delivery.attempt + 1;
      db.updateDelivery(delivery.id, { status: 'sending', attempt });
      return { ...delivery, status: 'sending', attempt };
    },

    complete(deliveryId, discordMessageId) {
      db.updateDelivery(deliveryId, { status: 'sent', discordMessageId, sentAt: new Date().toISOString() });
      const delivery = db.getDelivery(deliveryId);
      if (delivery && db.listDeliveries(delivery.messageId).every((d) => d.status === 'sent')) {
        db.updateMessage(delivery.messageId, { status: 'delivered' });
      }
    },

    fail(deliveryId, error) {
      db.updateDelivery(deliveryId, { status: 'failed', error });
      const delivery = db.getDelivery(deliveryId);
      if (delivery) db.updateMessage(delivery.messageId, { status: 'failed' });
    },
  };
}
