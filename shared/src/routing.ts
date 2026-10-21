import { z } from 'zod';
import { snowflakeSchema } from './api.js';
import { severitySchema } from './message.js';

// Every condition that is set must match; within a list, any entry matches.
export const routeConditionsSchema = z.object({
  // Event names, compared without case.
  events: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  severities: z.array(severitySchema).max(5).optional(),
  // Found in the title, body, or fields, without case.
  text: z.string().trim().min(1).max(200).optional(),
});
export type RouteConditions = z.infer<typeof routeConditionsSchema>;

// send posts to the rule's channel; drop stops the search and posts nothing, not even
// to the fallback channel.
export const routeActionSchema = z.enum(['send', 'drop']);
export type RouteAction = z.infer<typeof routeActionSchema>;

// Discord mention syntax: a role, a user, @here, or @everyone.
export const mentionSchema = z
  .string()
  .trim()
  .regex(
    /^(@here|@everyone|<@&\d{17,20}>|<@!?\d{17,20}>)$/,
    'Use @here, @everyone, <@&role id>, or <@user id>',
  );

const routeFields = {
  name: z.string().trim().max(100),
  // Null applies the rule to every source.
  sourceId: z.string().min(1).max(64).nullable(),
  conditions: routeConditionsSchema,
  action: routeActionSchema,
  // Required when the action is send.
  channelId: snowflakeSchema.nullable(),
  // Sent as the message text next to the embed, so they notify.
  mentions: z.array(mentionSchema).max(10),
  enabled: z.boolean(),
  // When false, a match stops the search; when true, later rules are checked too.
  continueMatching: z.boolean(),
};

export const createRouteSchema = z.object({
  ...routeFields,
  name: routeFields.name.default(''),
  conditions: routeFields.conditions.default({}),
  action: routeFields.action.default('send'),
  channelId: routeFields.channelId.default(null),
  mentions: routeFields.mentions.default([]),
  enabled: routeFields.enabled.default(true),
  continueMatching: routeFields.continueMatching.default(false),
});
export type CreateRouteRequest = z.input<typeof createRouteSchema>;

export const updateRouteSchema = z.object(routeFields).partial();
export type UpdateRouteRequest = z.infer<typeof updateRouteSchema>;

export const routeParamsSchema = z.object({ id: z.coerce.number().int().positive() });

// Every rule id, in the new order.
export const reorderRoutesSchema = z.object({
  ids: z.array(z.number().int().positive()).max(1000),
});

export interface RouteInfo {
  id: number;
  name: string;
  sourceId: string | null;
  // Lower numbers are checked first.
  priority: number;
  conditions: RouteConditions;
  action: RouteAction;
  // Null for drop rules.
  channelId: string | null;
  mentions: string[];
  enabled: boolean;
  continueMatching: boolean;
}

// Id used for an unsaved rule in previews.
export const DRAFT_ROUTE_ID = 0;

export const routePreviewSchema = z.object({
  sourceId: z.string().min(1).max(64),
  event: z.string().trim().min(1, 'Enter an event').max(100),
  severity: severitySchema,
  title: z.string().max(256).default(''),
  body: z.string().max(4096).optional(),
  // An unsaved rule to test: with an id it replaces that saved rule, without one it is
  // checked after all saved rules.
  draft: createRouteSchema.extend({ id: z.number().int().positive().optional() }).optional(),
});
export type RoutePreviewRequest = z.input<typeof routePreviewSchema>;

export interface RouteCheck {
  // DRAFT_ROUTE_ID for the unsaved rule.
  routeId: number;
  matched: boolean;
  // Why the rule did not match, or was not reached.
  reason?: string;
  // What a matching rule did besides sending, such as dropping or being muted.
  note?: string;
}

// sent: at least one channel gets the message; dropped: a drop rule stopped it; muted:
// everything that matched is muted; unrouted: nothing matched and there is no fallback.
export type RouteOutcome = 'sent' | 'dropped' | 'muted' | 'unrouted';

export interface RoutePreview {
  checks: RouteCheck[];
  // Where the message would go; routeId is null for the fallback channel.
  deliveries: { routeId: number | null; channelId: string; mentions: string[] }[];
  outcome: RouteOutcome;
  // Set when a source or event mute applies to the whole message.
  mutedBy?: string;
}
