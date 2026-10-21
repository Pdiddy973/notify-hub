import { z } from 'zod';

export const discardReasonSchema = z.enum([
  'wrong token',
  'missing token',
  'expired token',
  'unknown source',
  'disabled source',
]);
export type DiscardReason = z.infer<typeof discardReasonSchema>;

export const discardedQuerySchema = z.object({
  source: z.string().trim().min(1).max(100).optional(),
  reason: discardReasonSchema.optional(),
  address: z.string().trim().min(1).max(64).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DiscardedQuery = z.input<typeof discardedQuerySchema>;

// An IPv4 or IPv6 address with an optional prefix length; checked again on the server.
const addressRangeSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Use an address or a range such as 192.168.1.0/24');

export const discardedSettingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
  maxRows: z.number().int().min(100).max(1_000_000),
  // Bad requests from one address within 10 minutes before it is blocked.
  blockThreshold: z.number().int().min(1).max(100_000),
  blockMinutes: z.number().int().min(1).max(1440),
  // Addresses that are never blocked.
  exemptRanges: z.array(addressRangeSchema).max(100),
  // Discards within 10 minutes that post an alert; 0 turns the alert off.
  spikeThreshold: z.number().int().min(0).max(1_000_000),
});
export type DiscardedSettings = z.infer<typeof discardedSettingsSchema>;

export const defaultDiscardedSettings: DiscardedSettings = {
  retentionDays: 7,
  maxRows: 10_000,
  blockThreshold: 20,
  blockMinutes: 15,
  exemptRanges: [],
  spikeThreshold: 50,
};

export const unblockSchema = z.object({ address: z.string().trim().min(1).max(64) });

export interface DiscardedInfo {
  id: number;
  firstSeen: string;
  lastSeen: string;
  repeatCount: number;
  clientAddress: string;
  sourceTried: string;
  // True when sourceTried names an existing source.
  sourceExists: boolean;
  reason: DiscardReason;
  userAgent?: string;
  method: string;
  contentType?: string;
  contentLength: number;
  // The first 4 characters and the length of the token that was sent.
  tokenHint?: string;
}

export interface BlockedAddress {
  address: string;
  until: string;
}

export interface DiscardedPage {
  entries: DiscardedInfo[];
  total: number;
  blocked: BlockedAddress[];
}
