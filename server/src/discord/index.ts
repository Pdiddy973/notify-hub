import type { Embed } from '@notify-hub/shared';
import type { BotApi } from '../api/index.js';

// Posts an embed to a Discord channel, with optional message text such as mentions;
// discord.js implements it, tests mock it.
export interface DiscordSender {
  send(channelId: string, embed: Embed, content?: string): Promise<{ messageId: string }>;
}

export interface AllowedMentions {
  parse: 'everyone'[];
  roles: string[];
  users: string[];
}

// Lets Discord notify only the mentions written in the content; anything else in it,
// including mentions inside the embed, stays silent.
export function allowedMentionsFor(content: string | undefined): AllowedMentions {
  const text = content ?? '';
  return {
    parse: /@(everyone|here)/.test(text) ? ['everyone'] : [],
    roles: [...text.matchAll(/<@&(\d{17,20})>/g)].map((match) => match[1]!),
    users: [...text.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]!),
  };
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
        const { messageId } = await sender.send(job.channelId, job.embed, job.content);
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
export { createDiscordRest, DiscordTokenRejected, type DiscordRest } from './rest.js';
