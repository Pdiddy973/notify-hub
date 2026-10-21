import { z } from 'zod';

// What a mute silences: one source, one routing rule, or one event name from any source.
export const muteScopeSchema = z.enum(['source', 'route', 'event']);
export type MuteScope = z.infer<typeof muteScopeSchema>;

export const createMuteSchema = z.object({
  scope: muteScopeSchema,
  // A source id, a rule id, or an event name.
  target: z.string().trim().min(1, 'Pick what to mute').max(100),
  // How long the mute lasts; null keeps it until it is removed.
  minutes: z.number().int().min(1).max(525_600).nullable(),
  reason: z.string().trim().max(200).default(''),
  // Messages with severity error are still sent while muted.
  keepErrors: z.boolean().default(false),
});
export type CreateMuteRequest = z.input<typeof createMuteSchema>;

export const muteParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export interface MuteInfo {
  id: number;
  scope: MuteScope;
  target: string;
  // Source or rule name, when the target still exists.
  targetName?: string;
  // Null until the mute is removed.
  until: string | null;
  reason: string;
  keepErrors: boolean;
  createdAt: string;
}
