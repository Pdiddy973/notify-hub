import type { DiscordVerifyResult } from '@notify-hub/shared';

const API = 'https://discord.com/api/v10';

export class DiscordTokenRejected extends Error {
  constructor() {
    super('Discord rejected this bot token.');
  }
}

export interface DiscordRest {
  // Checks a bot token and lists the servers the bot has joined.
  verifyToken(token: string): Promise<DiscordVerifyResult>;
}

export function createDiscordRest(fetchImpl: typeof fetch = fetch): DiscordRest {
  async function get<T>(path: string, token: string): Promise<T> {
    const response = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bot ${token}` } });
    if (response.status === 401) throw new DiscordTokenRejected();
    if (!response.ok) throw new Error(`Discord answered ${response.status} for ${path}`);
    return (await response.json()) as T;
  }

  return {
    async verifyToken(token) {
      const user = await get<{ id: string; username: string }>('/users/@me', token);
      const guilds = await get<{ id: string; name: string }[]>('/users/@me/guilds', token);
      return {
        botUser: user.username,
        botId: user.id,
        guilds: guilds.map(({ id, name }) => ({ id, name })),
      };
    },
  };
}
