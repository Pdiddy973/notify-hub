import { z } from 'zod';

export const severitySchema = z.enum(['info', 'success', 'warning', 'error', 'debug']);
export type Severity = z.infer<typeof severitySchema>;

export const messageFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
  inline: z.boolean().optional(),
});
export type MessageField = z.infer<typeof messageFieldSchema>;

// The one shape every adapter produces (PLAN.md section 6).
export const standardMessageSchema = z.object({
  source: z.string(),
  event: z.string(),
  severity: severitySchema,
  title: z.string(),
  body: z.string().optional(),
  fields: z.array(messageFieldSchema).optional(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  timestamp: z.string(),
  // Identifies what the message is about, for state tracking.
  key: z.string().optional(),
});
export type StandardMessage = z.infer<typeof standardMessageSchema>;

// What an adapter returns; the pipeline adds the source and the received time.
export const adapterMessageSchema = standardMessageSchema.omit({ source: true, timestamp: true });
export type AdapterMessage = z.infer<typeof adapterMessageSchema>;

// The Discord embed the renderer builds from a standard message.
export const embedSchema = z.object({
  author: z.object({ name: z.string() }).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  color: z.number().int().optional(),
  fields: z.array(messageFieldSchema).optional(),
  image: z.object({ url: z.string() }).optional(),
  footer: z.object({ text: z.string() }).optional(),
  timestamp: z.string().optional(),
});
export type Embed = z.infer<typeof embedSchema>;
