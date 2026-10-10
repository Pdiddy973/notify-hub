import type { Embed } from '@notify-hub/shared';
import type { BotApi } from '../api/index.js';

// Posts an embed to a Discord channel; discord.js implements it, tests mock it.
export interface DiscordSender {
  send(channelId: string, embed: Embed): Promise<{ messageId: string }>;
}

export interface Bot {
  // Sends the next queued delivery; resolves false when nothing is queued.
  deliverNext(): Promise<boolean>;
}

export interface BotDeps {
  api: BotApi;
  sender: DiscordSender;
}

export function createBot({ api, sender }: BotDeps): Bot {
  return {
    async deliverNext() {
      const job = await api.claimDelivery();
      if (!job) return false;
      try {
        const { messageId } = await sender.send(job.channelId, job.embed);
        await api.completeDelivery(job.deliveryId, messageId);
      } catch (error) {
        await api.failDelivery(job.deliveryId, error instanceof Error ? error.message : String(error));
      }
      return true;
    },
  };
}

export { connectDiscord, type ConnectOptions, type DiscordConnection } from './client.js';
export { botTokenProblem } from './token.js';
