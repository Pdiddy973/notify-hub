import type { AdapterInput, AdapterMap } from './definition.js';

type Scope = Pick<AdapterInput, 'body' | 'headers' | 'config'>;

// Reads a dotted path such as body.series.title; array items use their index (body.items.0).
export function readPath(scope: Scope, path: string): unknown {
  let value: unknown = scope;
  for (const part of path.trim().split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

// Replaces each {{path}} with the value found there; missing values become empty text.
export function fillTemplate(template: string, scope: Scope): string {
  return template.replace(PLACEHOLDER, (_, path: string) => asText(readPath(scope, path)));
}

// Like fillTemplate, but empty when every placeholder is empty, so '{{body.ping}} ms'
// leaves the part out instead of showing ' ms'.
export function fillOptional(template: string, scope: Scope): string {
  let placeholders = 0;
  let filled = 0;
  const text = template.replace(PLACEHOLDER, (_, path: string) => {
    placeholders += 1;
    const value = asText(readPath(scope, path));
    if (value) filled += 1;
    return value;
  });
  return placeholders > 0 && filled === 0 ? '' : text;
}

function pick(spec: AdapterMap['event'], scope: Scope): string {
  if (typeof spec === 'string') return fillTemplate(spec, scope);
  const value = asText(readPath(scope, spec.from));
  return Object.hasOwn(spec.values, value) ? spec.values[value]! : (spec.default ?? value);
}

// Builds one standard message from a declarative map; optional parts and fields whose
// placeholders are all empty are left out.
export function applyMap(map: AdapterMap, scope: Scope): Record<string, unknown> {
  const message: Record<string, unknown> = {
    event: pick(map.event, scope),
    severity: pick(map.severity, scope),
    title: fillTemplate(map.title, scope),
  };
  for (const name of ['body', 'url', 'imageUrl', 'key'] as const) {
    const template = map[name];
    const text = template === undefined ? '' : fillOptional(template, scope);
    if (text) message[name] = text;
  }
  const fields = (map.fields ?? [])
    .map((field) => ({
      name: fillTemplate(field.name, scope),
      value: fillOptional(field.value, scope),
      ...(field.inline === undefined ? {} : { inline: field.inline }),
    }))
    .filter((field) => field.name && field.value);
  if (fields.length) message.fields = fields;
  return message;
}
