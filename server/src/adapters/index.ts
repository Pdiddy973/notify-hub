import type { AdapterMessage } from '@notify-hub/shared';
import { standardAdapter } from './standard.js';

export type { AdapterMessage };

export interface AdapterInput {
  body: unknown;
  headers: Record<string, string>;
  config: Record<string, unknown>;
}

// The required fields of the adapter file format (PLAN.md section 7).
export interface Adapter {
  id: string;
  name: string;
  parse: 'json' | 'form' | 'text';
  // An empty array means the event is ignored on purpose.
  normalize(input: AdapterInput): AdapterMessage[];
  samples: { name: string; body: unknown }[];
}

export interface AdapterRegistry {
  get(id: string): Adapter | undefined;
}

export function createRegistry(adapters: Adapter[]): AdapterRegistry {
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  return { get: (id) => byId.get(id) };
}

export const builtInAdapters: Adapter[] = [standardAdapter];

// Turns a stored raw payload into the body an adapter receives.
export function parseBody(raw: string, format: Adapter['parse']): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(raw) as unknown;
    case 'form':
      return Object.fromEntries(new URLSearchParams(raw));
    case 'text':
      return raw;
  }
}
