import {
  defaultDiscardedSettings,
  defaultHubSettings,
  discardedSettingsSchema,
  hubSettingsSchema,
  type DiscardedSettings,
  type HubSettings,
} from '@notify-hub/shared';
import type { z } from 'zod';
import type { Database } from '../db/index.js';

const keys = {
  hub: 'hub.settings',
  discarded: 'discarded.settings',
} as const;

// Reads a JSON settings group; missing or invalid fields fall back to the defaults.
function readGroup<T extends object>(db: Database, key: string, schema: z.ZodObject, defaults: T): T {
  const raw = db.getSetting(key);
  if (!raw) return { ...defaults };
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ...defaults };
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...defaults };
  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [field, value] of Object.entries(stored)) {
    const fieldSchema = schema.shape[field];
    if (fieldSchema?.safeParse(value).success) merged[field] = value;
  }
  return merged as T;
}

export interface SettingsStore {
  hub(): HubSettings;
  updateHub(changes: Partial<HubSettings>): HubSettings;
  discarded(): DiscardedSettings;
  updateDiscarded(changes: Partial<DiscardedSettings>): DiscardedSettings;
}

export function createSettingsStore(db: Database): SettingsStore {
  const store: SettingsStore = {
    hub: () => readGroup(db, keys.hub, hubSettingsSchema, defaultHubSettings),
    updateHub(changes) {
      const next = { ...store.hub(), ...changes };
      db.setSetting(keys.hub, JSON.stringify(next));
      return next;
    },
    discarded: () => readGroup(db, keys.discarded, discardedSettingsSchema, defaultDiscardedSettings),
    updateDiscarded(changes) {
      const next = { ...store.discarded(), ...changes };
      db.setSetting(keys.discarded, JSON.stringify(next));
      return next;
    },
  };
  return store;
}
