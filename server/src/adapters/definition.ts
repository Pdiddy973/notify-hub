import { z } from 'zod';

// The adapter file format (PLAN.md section 7). This module is bundled into the adapter
// worker, so it imports only zod.

export const SEVERITIES = ['info', 'success', 'warning', 'error', 'debug'] as const;

export const adapterIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'id must be up to 48 lowercase letters, numbers, and dashes');

const configFieldSchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean']),
    label: z.string().min(1),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    help: z.string().optional(),
  })
  .strict();

const styleSchema = z
  .object({
    icon: z.url({ protocol: /^https?$/, error: 'style.icon must be an http(s) URL' }).optional(),
    colors: z
      .partialRecord(z.enum(SEVERITIES), z.string().regex(/^#[0-9a-f]{6}$/i, 'Colors look like #3498db'))
      .optional(),
  })
  .strict();

// fetch:<host> allows requests to that host; a port, when given, must match too.
export const permissionSchema = z
  .string()
  .regex(/^fetch:[a-z0-9.-]+(:\d{1,5})?$/i, 'Permissions look like fetch:api.example.com');

// A value picked from a field: values maps what the field holds to the result.
const choiceSchema = z
  .object({
    from: z.string().min(1),
    values: z.record(z.string(), z.string()),
    default: z.string().optional(),
  })
  .strict();

// Templates fill {{body.path}}, {{headers.name}}, and {{config.name}} from the request.
export const mapSchema = z
  .object({
    event: z.union([z.string(), choiceSchema]),
    severity: z.union([z.string(), choiceSchema]),
    title: z.string(),
    body: z.string().optional(),
    url: z.string().optional(),
    imageUrl: z.string().optional(),
    key: z.string().optional(),
    fields: z
      .array(z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() }).strict())
      .optional(),
  })
  .strict();
export type AdapterMap = z.infer<typeof mapSchema>;

const sampleSchema = z
  .object({
    name: z.string().min(1).max(100),
    body: z.unknown(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// Checks an adapter file as the worker describes it: functions cannot leave the adapter's
// context, so normalize arrives as true and any other function as the text '[function]'.
export const adapterFileSchema = z
  .object({
    id: adapterIdSchema,
    name: z.string().min(1).max(100),
    version: z.number().int().nonnegative().optional(),
    parse: z.enum(['json', 'form', 'text']),
    normalize: z.literal(true, { error: 'normalize must be a function' }).optional(),
    map: mapSchema.optional(),
    samples: z.array(sampleSchema).min(1, 'Add at least one sample'),
    config: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), configFieldSchema).optional(),
    style: styleSchema.optional(),
    help: z.string().max(4000).optional(),
    permissions: z.array(permissionSchema).optional(),
  })
  .strict()
  .refine((file) => Boolean(file.normalize) !== Boolean(file.map), {
    message: 'Give either normalize or map, not both',
  });

export type ConfigField = z.infer<typeof configFieldSchema>;
export type AdapterStyle = z.infer<typeof styleSchema>;
export type AdapterSample = z.infer<typeof sampleSchema>;
export type ParseFormat = 'json' | 'form' | 'text';

// What normalize receives. fetch is present only when a fetch permission is approved.
export interface AdapterInput {
  body: unknown;
  headers: Record<string, string>;
  config: Record<string, unknown>;
  fetch?: typeof fetch;
}

// The shape of an adapter file, for typing built-in adapters.
export interface AdapterDefinition {
  id: string;
  name: string;
  version?: number;
  parse: ParseFormat;
  normalize?(input: AdapterInput): unknown[] | Promise<unknown[]>;
  map?: AdapterMap;
  samples: AdapterSample[];
  config?: Record<string, ConfigField>;
  style?: AdapterStyle;
  help?: string;
  permissions?: string[];
}

// The parts of a loaded adapter the main thread keeps; everything here can be cloned.
export interface AdapterMeta {
  id: string;
  name: string;
  version?: number;
  parse: ParseFormat;
  samples: AdapterSample[];
  config: Record<string, ConfigField>;
  style?: AdapterStyle;
  help?: string;
  permissions: string[];
}

export function adapterMeta(file: Omit<AdapterDefinition, 'normalize'>): AdapterMeta {
  return {
    id: file.id,
    name: file.name,
    ...(file.version === undefined ? {} : { version: file.version }),
    parse: file.parse,
    samples: file.samples,
    config: file.config ?? {},
    ...(file.style ? { style: file.style } : {}),
    ...(file.help ? { help: file.help } : {}),
    permissions: [...new Set(file.permissions ?? [])],
  };
}

// Config values for normalize: the file's defaults, overridden by the source's values.
export function configWithDefaults(
  fields: Record<string, ConfigField>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = Object.fromEntries(
    Object.entries(fields).flatMap(([name, field]) =>
      field.default === undefined ? [] : [[name, field.default]],
    ),
  );
  return { ...defaults, ...values };
}
