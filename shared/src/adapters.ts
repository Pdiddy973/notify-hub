import { z } from 'zod';
import type { Embed, StandardMessage } from './message.js';

// ok: loaded and every sample passes. samples-failing: loaded, but a sample throws or
// returns something that is not a standard message. error: the file has a problem now,
// and the last working version keeps running.
export type AdapterStatus = 'ok' | 'samples-failing' | 'error';

export interface AdapterInfo {
  id: string;
  name: string;
  version?: number;
  origin: 'built-in' | 'file';
  // File name, relative to the adapters folder for files.
  file: string;
  // False when a file with the same id overrides this built-in adapter.
  active: boolean;
  status: AdapterStatus;
  // The current file problem or the failing samples.
  error?: string;
  // Setup instructions shown on the source page, as plain text.
  help?: string;
  parse: 'json' | 'form' | 'text';
  samples: string[];
  permissions: { requested: string[]; approved: string[] };
  loadedAt: string;
}

// A file that has never loaded, so no version of it runs.
export interface FailedAdapterFile {
  file: string;
  error: string;
}

export interface AdapterList {
  // Folder the hub loads your adapter files from; absent when there is none.
  folder?: string;
  adapters: AdapterInfo[];
  failed: FailedAdapterFile[];
}

export interface SampleRun {
  name: string;
  messages?: StandardMessage[];
  // One embed per message, as the renderer builds it.
  embeds?: Embed[];
  error?: string;
}

export const adapterParamsSchema = z.object({ id: z.string().min(1).max(64) });

export const adapterPermissionsSchema = z.object({
  approved: z.array(z.string().min(1).max(300)).max(50),
});
export type AdapterPermissionsRequest = z.infer<typeof adapterPermissionsSchema>;
