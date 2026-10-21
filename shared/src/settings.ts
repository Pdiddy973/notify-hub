import { z } from 'zod';
import { passwordSchema, snowflakeSchema } from './api.js';

// An http(s) address without a trailing slash, such as http://192.168.1.20:8080.
const baseUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Enter an http or https address, such as http://192.168.1.20:8080' })
  .max(200)
  .refine((url) => !url.endsWith('/') && !/[?#]/.test(url), 'Leave out a trailing slash, query, or #');

export const hubSettingsSchema = z.object({
  // Start of the webhook URLs shown on the Sources page; null uses the browser's address.
  webhookBaseUrl: baseUrlSchema.nullable(),
  // Receives messages that no rule matched; null logs them as unrouted.
  fallbackChannelId: snowflakeSchema.nullable(),
  // Receives the hub's own alerts, such as discard spikes.
  alertChannelId: snowflakeSchema.nullable(),
  messageRetentionDays: z.number().int().min(1).max(3650),
  // Largest webhook body accepted; applies after a restart.
  bodyLimitKb: z.number().int().min(16).max(16_384),
});
export type HubSettings = z.infer<typeof hubSettingsSchema>;

export const defaultHubSettings: HubSettings = {
  webhookBaseUrl: null,
  fallbackChannelId: null,
  alertChannelId: null,
  messageRetentionDays: 30,
  bodyLimitKb: 1024,
};

export const updateHubSettingsSchema = hubSettingsSchema.partial();
export type UpdateHubSettingsRequest = z.infer<typeof updateHubSettingsSchema>;

export interface SettingsInfo extends HubSettings {
  version: string;
  // The body limit in use since the last start.
  activeBodyLimitKb: number;
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const dashboardQuerySchema = z.object({
  // Start of the period counted, usually local midnight.
  since: z.iso.datetime({ offset: true }).optional(),
});

export interface DashboardSource {
  id: string;
  name: string;
  enabled: boolean;
  messages: number;
  lastReceivedAt?: string;
}

export interface DashboardInfo {
  since: string;
  messages: number;
  failed: number;
  unrouted: number;
  // Deliveries waiting or being sent.
  queueDepth: number;
  discarded: number;
  sources: DashboardSource[];
}
