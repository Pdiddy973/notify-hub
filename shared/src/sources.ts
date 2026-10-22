import { z } from 'zod';

// Reserved for messages the hub posts itself, such as alerts.
export const HUB_SOURCE_ID = 'hub';

// Source ids appear in webhook URLs, so they are short lowercase slugs.
export const sourceIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'Use up to 48 lowercase letters, numbers, and dashes')
  .refine((id) => id !== HUB_SOURCE_ID, `"${HUB_SOURCE_ID}" is reserved for the hub itself`);

// The :id path parameter of source routes; looser than sourceIdSchema so older ids still work.
export const sourceParamsSchema = z.object({ id: z.string().min(1).max(64) });

export const sourceNameSchema = z.string().trim().min(1, 'Enter a name').max(100);

export const createSourceSchema = z.object({
  id: sourceIdSchema,
  name: sourceNameSchema,
  type: z.string().min(1, 'Pick a type').max(64),
});
export type CreateSourceRequest = z.infer<typeof createSourceSchema>;

export const updateSourceSchema = z.object({
  name: sourceNameSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateSourceRequest = z.infer<typeof updateSourceSchema>;

// Never includes the token.
export interface SourceSummary {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  createdAt: string;
  // While set, the token from before the last rotation still works.
  previousTokenValidUntil?: string;
}

export interface SourceDetail extends SourceSummary {
  adapterName?: string;
  // Setup instructions from the adapter.
  help?: string;
  // Set when the adapter is missing or its file has a problem.
  adapterProblem?: string;
}

// The only response that contains a source token.
export interface SourceUrl {
  hookPath: string;
}
