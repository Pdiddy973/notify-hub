import {
  adapterMessageSchema,
  type AdapterInfo,
  type AdapterList,
  type AdapterStatus,
  type FailedAdapterFile,
} from '@notify-hub/shared';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { bundleAdapter, type BundleResult } from './build.js';
import type { AdapterMeta } from './definition.js';
import { AdapterHostClosed, createAdapterHost, type AdapterHostOptions } from './host.js';
import { parseSourceMap, type SourceMapLookup } from './sourcemap.js';
import type { NormalizeInput, SampleOutcome, WorkerError } from './worker.js';

export const builtInAdapterDir = fileURLToPath(new URL('./builtin/', import.meta.url));
export const adapterTemplateFile = fileURLToPath(new URL('../../../adapters/_template.js', import.meta.url));
const TEMPLATE_NAME = '_template.js';

export interface LoadedAdapter extends AdapterMeta {
  origin: 'built-in' | 'file';
  file: string;
  loadedAt: string;
  // One line per failing sample.
  sampleProblems: string[];
}

export interface SampleResult {
  name: string;
  output?: unknown[];
  error?: string;
}

export interface AdapterRegistry {
  // Settles once every file has been tried at start.
  ready: Promise<void>;
  // The adapter in use for an id: a file overrides a built-in adapter.
  get(id: string): LoadedAdapter | undefined;
  list(): AdapterList;
  // Runs the adapter in the worker; errors carry the file position when there is one.
  normalize(id: string, input: NormalizeInput): Promise<unknown[]>;
  runSamples(id: string): Promise<SampleResult[]>;
  // Saves the approvals and applies them; only permissions the adapter asks for count.
  setApprovals(id: string, approved: string[]): Promise<void>;
  // Loads changed, new, and removed files from the adapters folder.
  reload(): Promise<void>;
  close(): Promise<void>;
}

export interface AdapterLogger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface AdapterLoaderOptions {
  db: Database;
  builtinDir?: string;
  // Folder for your own adapter files; none means built-in adapters only.
  userDir?: string;
  // Copied into userDir when it has no template yet.
  templateFile?: string;
  // Reloads files when the folder changes.
  watch?: boolean;
  host?: AdapterHostOptions;
  log?: AdapterLogger;
  // Called after a reload changed what is loaded.
  onChange?(): void;
}

interface FileState {
  path: string;
  root: string;
  origin: LoadedAdapter['origin'];
  // Name shown in the UI: relative to its folder.
  display: string;
  error?: string;
  // The version running in the worker.
  adapter?: LoadedAdapter;
  code?: string;
  lookup?: SourceMapLookup;
}

const ADAPTER_FILE = /\.(js|mjs|cjs|ts|mts)$/;

// Adapter files directly in a folder; names starting with _ or . are helpers or hidden.
function adapterFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          ADAPTER_FILE.test(entry.name) &&
          !/\.d\.[mc]?ts$/.test(entry.name) &&
          !entry.name.startsWith('_') &&
          !entry.name.startsWith('.'),
      )
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

// Built-in files only change with a new release, so their bundles are kept per process.
const builtInBundles = new Map<string, { stamp: string; result: Promise<BundleResult> }>();

function bundleBuiltIn(file: string, root: string): Promise<BundleResult> {
  const stats = statSync(file);
  const stamp = `${stats.mtimeMs}:${stats.size}`;
  const cached = builtInBundles.get(file);
  if (cached?.stamp === stamp) return cached.result;
  const result = bundleAdapter(file, root);
  builtInBundles.set(file, { stamp, result });
  return result;
}

function asWorkerError(error: unknown): WorkerError {
  if (error instanceof Error)
    return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  return { message: String(error) };
}

// Adds the original file position of the innermost adapter frame, such as (sonarr.js:12:5).
function describe(error: WorkerError, slot: string, lookup: SourceMapLookup | undefined): string {
  const stack = error.stack ?? '';
  const at = stack.indexOf(`${slot}:`);
  if (at < 0 || !lookup) return error.message;
  const match = /^:(\d+):(\d+)/.exec(stack.slice(at + slot.length));
  if (!match) return error.message;
  const position = lookup.find(Number(match[1]), Number(match[2]));
  return position
    ? `${error.message} (${position.source}:${position.line}:${position.column})`
    : error.message;
}

function sampleProblems(outcomes: SampleOutcome[], slot: string, lookup: SourceMapLookup): string[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.error) return [`Sample "${outcome.name}": ${describe(outcome.error, slot, lookup)}`];
    return (outcome.output ?? []).flatMap((message, index) => {
      const parsed = adapterMessageSchema.safeParse(message);
      if (parsed.success) return [];
      const which = (outcome.output?.length ?? 0) > 1 ? ` message ${index + 1}` : '';
      return [
        `Sample "${outcome.name}"${which} is not a standard message:\n${z.prettifyError(parsed.error)}`,
      ];
    });
  });
}

export function statusOf(state: { error?: string; adapter?: LoadedAdapter }): AdapterStatus {
  if (state.error) return 'error';
  return state.adapter?.sampleProblems.length ? 'samples-failing' : 'ok';
}

// Loads built-in adapters and the files in the adapters folder into one worker, and keeps
// the last working version of each file running when a change breaks it.
export function createAdapterLoader({
  db,
  builtinDir = builtInAdapterDir,
  userDir,
  templateFile = adapterTemplateFile,
  watch: watchFolder = true,
  host: hostOptions,
  log,
  onChange,
}: AdapterLoaderOptions): AdapterRegistry {
  const host = createAdapterHost({
    ...hostOptions,
    onRestart(reason) {
      log?.warn({ reason }, 'Restarted the adapter worker');
      hostOptions?.onRestart?.(reason);
    },
  });
  const states = new Map<string, FileState>();
  let closed = false;

  const effectiveState = (id: string): FileState | undefined => {
    let builtIn: FileState | undefined;
    for (const state of states.values()) {
      if (state.adapter?.id !== id) continue;
      if (state.origin === 'file') return state;
      builtIn ??= state;
    }
    return builtIn;
  };

  const loadFile = async (state: FileState) => {
    const built =
      state.origin === 'built-in'
        ? await bundleBuiltIn(state.path, state.root)
        : await bundleAdapter(state.path, state.root);
    if (!built.ok) {
      state.error = built.error;
      return;
    }
    const { code, map } = built.bundle;
    if (state.adapter && !state.error && state.code === code) return;
    const lookup = parseSourceMap(map);
    try {
      const result = await host.request({
        type: 'load',
        slot: state.path,
        code,
        approved: [],
        runSamples: true,
      });
      if (result.type !== 'loaded') throw new Error('The adapter worker gave an unexpected answer');
      const { meta } = result;
      const owner = [...states.values()].find(
        (other) => other !== state && other.origin === state.origin && other.adapter?.id === meta.id,
      );
      if (owner) {
        await host.request({ type: 'unload', slot: state.path });
        state.adapter = undefined;
        state.code = undefined;
        state.error = `${owner.display} already uses the id "${meta.id}"; give each adapter its own id`;
        return;
      }
      const approved = db.adapterApprovals().get(meta.id) ?? [];
      if (approved.length) await host.request({ type: 'approve', slot: state.path, approved });
      state.adapter = {
        ...meta,
        origin: state.origin,
        file: state.display,
        loadedAt: new Date().toISOString(),
        sampleProblems: sampleProblems(result.samples, state.path, lookup),
      };
      state.code = code;
      state.lookup = lookup;
      state.error = undefined;
    } catch (error) {
      if (error instanceof AdapterHostClosed) return;
      state.error = describe(asWorkerError(error), state.path, lookup);
    }
  };

  const report = (state: FileState) => {
    const status = statusOf(state);
    if (status === 'ok') log?.info({ file: state.display, adapter: state.adapter?.id }, 'Adapter loaded');
    else {
      log?.warn(
        { file: state.display, adapter: state.adapter?.id, status },
        state.adapter ? 'Adapter loaded with problems' : 'Adapter file failed to load',
      );
    }
  };

  // Records the result for each adapter in use, so the database matches the Adapters page.
  const persist = () => {
    const ids = new Set([...states.values()].flatMap((state) => (state.adapter ? [state.adapter.id] : [])));
    for (const id of ids) {
      const state = effectiveState(id)!;
      const error = state.error ?? state.adapter!.sampleProblems.join('\n');
      db.saveAdapterState({
        id,
        filePath: state.path,
        ...(state.adapter!.version === undefined ? {} : { version: state.adapter!.version }),
        loadStatus: statusOf(state),
        ...(error ? { lastError: error } : {}),
      });
    }
  };

  const loadFolder = async (dir: string, origin: FileState['origin']) => {
    const files = adapterFiles(dir);
    for (const [path, state] of states) {
      if (state.origin !== origin || files.includes(path)) continue;
      states.delete(path);
      if (state.adapter) await host.request({ type: 'unload', slot: path }).catch(() => {});
      log?.info({ file: state.display }, 'Adapter file removed');
    }
    for (const path of files) {
      let state = states.get(path);
      if (!state) {
        state = { path, root: dir, origin, display: basename(path) };
        states.set(path, state);
      }
      const before = { error: state.error, code: state.code };
      await loadFile(state);
      if (closed) return;
      if (state.error !== before.error || state.code !== before.code) report(state);
    }
  };

  const ensureTemplate = () => {
    if (!userDir) return;
    mkdirSync(userDir, { recursive: true });
    const target = join(userDir, TEMPLATE_NAME);
    if (!existsSync(target) && existsSync(templateFile)) copyFileSync(templateFile, target);
  };

  let reloading: Promise<void> = Promise.resolve();
  const reload = () => {
    reloading = reloading.then(async () => {
      if (closed || !userDir) return;
      await loadFolder(userDir, 'file');
      persist();
      onChange?.();
    });
    return reloading;
  };

  const ready = (async () => {
    ensureTemplate();
    await loadFolder(builtinDir, 'built-in');
    if (userDir) await loadFolder(userDir, 'file');
    if (!closed) persist();
  })();
  reloading = ready;

  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  if (userDir && watchFolder) {
    try {
      watcher = watch(userDir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void reload(), 150);
      });
      watcher.on('error', (err) => log?.warn({ err }, 'Stopped watching the adapters folder'));
    } catch (err) {
      log?.warn({ err }, 'Could not watch the adapters folder; changes load after a restart');
    }
  }

  const info = (state: FileState, approvals: Map<string, string[]>): AdapterInfo => {
    const adapter = state.adapter!;
    const error = state.error ?? (adapter.sampleProblems.join('\n') || undefined);
    return {
      id: adapter.id,
      name: adapter.name,
      ...(adapter.version === undefined ? {} : { version: adapter.version }),
      origin: state.origin,
      file: state.display,
      active: effectiveState(adapter.id) === state,
      status: statusOf(state),
      ...(error ? { error } : {}),
      ...(adapter.help ? { help: adapter.help } : {}),
      parse: adapter.parse,
      samples: adapter.samples.map((sample) => sample.name),
      permissions: {
        requested: adapter.permissions,
        approved: (approvals.get(adapter.id) ?? []).filter((p) => adapter.permissions.includes(p)),
      },
      loadedAt: adapter.loadedAt,
    };
  };

  const requireState = (id: string): FileState => {
    const state = effectiveState(id);
    if (!state) throw new Error(`No adapter named ${id}`);
    return state;
  };

  return {
    ready,
    get: (id) => effectiveState(id)?.adapter,

    list() {
      const approvals = db.adapterApprovals();
      const all = [...states.values()];
      const adapters = all
        .filter((state) => state.adapter)
        .map((state) => info(state, approvals))
        .sort((a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin));
      const failed: FailedAdapterFile[] = all
        .filter((state) => !state.adapter && state.error)
        .map((state) => ({ file: state.display, error: state.error! }));
      return { ...(userDir ? { folder: userDir } : {}), adapters, failed };
    },

    async normalize(id, input) {
      const state = requireState(id);
      try {
        const result = await host.request({ type: 'normalize', slot: state.path, input });
        if (result.type !== 'output') throw new Error('The adapter worker gave an unexpected answer');
        return result.output;
      } catch (error) {
        if (error instanceof AdapterHostClosed) throw error;
        throw new Error(describe(asWorkerError(error), state.path, state.lookup), { cause: error });
      }
    },

    async runSamples(id) {
      const state = requireState(id);
      let result;
      try {
        result = await host.request({ type: 'samples', slot: state.path });
      } catch (error) {
        throw new Error(describe(asWorkerError(error), state.path, state.lookup), { cause: error });
      }
      if (result.type !== 'samples') throw new Error('The adapter worker gave an unexpected answer');
      return result.samples.map((outcome) => ({
        name: outcome.name,
        ...(outcome.output ? { output: outcome.output } : {}),
        ...(outcome.error ? { error: describe(outcome.error, state.path, state.lookup) } : {}),
      }));
    },

    async setApprovals(id, approved) {
      db.setAdapterApprovals(id, approved);
      for (const state of states.values()) {
        if (state.adapter?.id !== id) continue;
        await host.request({ type: 'approve', slot: state.path, approved });
      }
    },

    reload,

    async close() {
      closed = true;
      clearTimeout(timer);
      watcher?.close();
      await host.close();
    },
  };
}
