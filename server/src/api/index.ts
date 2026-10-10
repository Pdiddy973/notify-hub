import type { Embed } from '@notify-hub/shared';
import type { Queue } from '../queue/index.js';

export interface DeliveryJob {
  deliveryId: number;
  channelId: string;
  embed: Embed;
}

// The backend calls the bot may make. Async so the bot can move to a separate
// process behind HTTP with the same interface.
export interface BotApi {
  claimDelivery(): Promise<DeliveryJob | null>;
  completeDelivery(deliveryId: number, discordMessageId: string): Promise<void>;
  failDelivery(deliveryId: number, error: string): Promise<void>;
}

export function createBotApi(queue: Queue): BotApi {
  return {
    async claimDelivery() {
      const delivery = queue.claim();
      return delivery
        ? { deliveryId: delivery.id, channelId: delivery.channelId, embed: delivery.embed }
        : null;
    },
    async completeDelivery(deliveryId, discordMessageId) {
      queue.complete(deliveryId, discordMessageId);
    },
    async failDelivery(deliveryId, error) {
      queue.fail(deliveryId, error);
    },
  };
}
