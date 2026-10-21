import { z } from 'zod';
import { severitySchema, type Embed, type StandardMessage } from './message.js';

// Discord ids are 17 to 20 digit numbers.
export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID (17 to 20 digits)');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(256, 'Use at most 256 characters');

export const setupAccountSchema = z.object({
  // Printed in the hub log while no admin account exists.
  setupCode: z.string().trim().min(1, 'Enter the setup code from the hub log').max(64),
  username: z.string().trim().min(1, 'Enter a username').max(64),
  password: passwordSchema,
});
export type SetupAccountRequest = z.infer<typeof setupAccountSchema>;

export const loginSchema = z.object({
  username: z.string().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const discordVerifySchema = z.object({
  botToken: z.string().trim().min(1, 'Paste the bot token'),
});
export type DiscordVerifyRequest = z.infer<typeof discordVerifySchema>;

// Omitting botToken keeps the saved one.
export const discordSettingsSchema = z.object({
  botToken: z.string().trim().min(1).optional(),
  guildId: snowflakeSchema,
});
export type DiscordSettingsRequest = z.infer<typeof discordSettingsSchema>;

export const setupFinishSchema = z.object({ channelId: snowflakeSchema });
export type SetupFinishRequest = z.infer<typeof setupFinishSchema>;

export const messageStatusSchema = z.enum([
  'received',
  'normalized',
  'queued',
  'delivered',
  'failed',
  'unrouted',
  'dropped',
  // Stored and logged, but a mute kept it from being posted.
  'muted',
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const deliveryStatusSchema = z.enum(['queued', 'sending', 'sent', 'failed']);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const messageQuerySchema = z.object({
  source: z.string().min(1).optional(),
  status: messageStatusSchema.optional(),
  severity: severitySchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // Returns messages with a smaller id, for paging back in time.
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MessageQuery = z.input<typeof messageQuerySchema>;

export const messageParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}

export interface SessionInfo {
  hasAdmin: boolean;
  setupComplete: boolean;
  authenticated: boolean;
  username?: string;
}

export interface DiscordStatus {
  configured: boolean;
  connected: boolean;
  botUser?: string;
  guildId?: string;
  guildName?: string;
}

export interface DiscordVerifyResult {
  botUser: string;
  // The bot's user id, which is also its application id for invite links.
  botId: string;
  guilds: { id: string; name: string }[];
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

export interface SetupFinishResult {
  // The test source; POST /api/sources/:id/url gives its webhook URL.
  sourceId: string;
}

export interface MessageSummary {
  id: number;
  sourceId: string;
  sourceName: string;
  receivedAt: string;
  status: MessageStatus;
  // From the first normalized message.
  event?: string;
  severity?: StandardMessage['severity'];
  title?: string;
  // Channel names of the deliveries.
  destinations: string[];
  // True when a delivery went to the fallback channel because no rule matched.
  fallback: boolean;
  hasError: boolean;
}

export interface DeliveryInfo {
  id: number;
  channelId: string;
  channelName?: string;
  embed: Embed;
  // The rule that chose the channel, when one did.
  routeId?: number;
  // Sent to the fallback channel because no rule matched.
  fallback: boolean;
  // Mentions sent as the message text next to the embed.
  content?: string;
  attempt: number;
  status: DeliveryStatus;
  error?: string;
  discordMessageId?: string;
  sentAt?: string;
}

export interface MessageDetail extends MessageSummary {
  headers: Record<string, string>;
  rawPayload: string;
  rawContentType: string;
  normalized?: StandardMessage[];
  error?: string;
  deliveries: DeliveryInfo[];
}

// What a resend did: failed deliveries queued again, or the message routed again.
export interface ResendResult {
  requeued: number;
  rerouted: boolean;
}

export interface MessagePage {
  messages: MessageSummary[];
  // Pass as `before` to load the next older page; absent on the last page.
  nextBefore?: number;
}
