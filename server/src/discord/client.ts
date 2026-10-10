import { ChannelType, Client, Events, GatewayIntentBits } from 'discord.js';
import type { FastifyBaseLogger } from 'fastify';
import type { BotApi } from '../api/index.js';
import type { DiscordSender } from './index.js';

// Channel types the bot can post embeds to.
const sendableTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export interface DiscordConnection {
  sender: DiscordSender;
  isReady(): boolean;
  // The bot's user name and the guild name, once connected.
  botUser(): string | undefined;
  guildName(): string | undefined;
  // Saves the guild's text channels through the API and returns how many there are.
  syncChannels(): Promise<number>;
  destroy(): Promise<void>;
}

export interface ConnectOptions {
  token: string;
  guildId: string;
  api: BotApi;
  log: FastifyBaseLogger;
}

// Logs in to Discord in the background and syncs channels once connected.
export function connectDiscord({ token, guildId, api, log }: ConnectOptions): DiscordConnection {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  async function syncChannels() {
    const guild = await client.guilds.fetch(guildId);
    const channels = [...(await guild.channels.fetch()).values()]
      .filter((channel) => channel !== null)
      .filter((channel) => sendableTypes.has(channel.type))
      .map((channel) => ({ id: channel.id, name: channel.name, type: ChannelType[channel.type] }));
    await api.saveChannels(guildId, channels);
    return channels.length;
  }

  client.once(Events.ClientReady, (ready) => {
    log.info({ user: ready.user.tag }, 'Discord connected');
    syncChannels().then(
      (count) => log.info({ guildId, channels: count }, 'Discord channels synced'),
      (err: unknown) => log.error({ err, guildId }, 'Discord channel sync failed'),
    );
  });
  client.on(Events.ShardDisconnect, () => log.warn('Discord disconnected'));
  client.on(Events.ShardResume, () => log.info('Discord reconnected'));
  client.on(Events.Error, (err) => log.error({ err }, 'Discord client error'));

  client.login(token).catch((err: unknown) => log.error({ err }, 'Discord login failed'));

  return {
    sender: {
      async send(channelId, embed) {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isSendable()) throw new Error(`Channel ${channelId} cannot receive messages`);
        const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        return { messageId: message.id };
      },
    },
    isReady: () => client.isReady(),
    botUser: () => client.user?.username,
    guildName: () => client.guilds.cache.get(guildId)?.name,
    syncChannels,
    destroy: () => client.destroy(),
  };
}
