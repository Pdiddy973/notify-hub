import type { Embed } from '@notify-hub/shared';
import type { Database, Delivery } from '../db/index.js';

export { createWorker, type Worker, type WorkerOptions } from './worker.js';

export interface Queue {
  // How the channel was chosen: by a rule, or as the fallback when no rule matched.
  enqueue(messageId: number, channelId: string, embed: Embed, via?: DeliveryVia): Delivery;
  // Takes the oldest queued delivery and marks it as sending.
  claim(): Delivery | undefined;
  complete(deliveryId: number, discordMessageId: string): void;
  fail(deliveryId: number, error: string): void;
  // Queues a message's failed deliveries again; returns how many.
  retryFailed(messageId: number): number;
}

export interface DeliveryVia {
  routeId?: number;
  fallback?: boolean;
  // Message text sent with the embed, such as mentions.
  content?: string;
}

export interface QueueOptions {
  // Called after each enqueue, so a waiting worker can start at once.
  onEnqueue?: () => void;
}

export function createQueue(db: Database, { onEnqueue }: QueueOptions = {}): Queue {
  return {
    enqueue(messageId, channelId, embed, { routeId, fallback = false, content } = {}) {
      const delivery = db.insertDelivery({
        messageId,
        channelId,
        embed,
        attempt: 0,
        status: 'queued',
        fallback,
        ...(routeId === undefined ? {} : { routeId }),
        ...(content === undefined ? {} : { content }),
      });
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

    retryFailed(messageId) {
      const requeued = db.requeueFailedDeliveries(messageId);
      if (requeued > 0) {
        db.updateMessage(messageId, { status: 'queued' });
        onEnqueue?.();
      }
      return requeued;
    },

    fail(deliveryId, error) {
      db.updateDelivery(deliveryId, { status: 'failed', error });
      const delivery = db.getDelivery(deliveryId);
      if (delivery) db.updateMessage(delivery.messageId, { status: 'failed' });
    },
  };
}
