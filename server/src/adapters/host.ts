import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { WorkerReply, WorkerRequest, WorkerResult } from './worker.js';

// Thrown for requests that were waiting when the host closed.
export class AdapterHostClosed extends Error {
  constructor() {
    super('The adapter worker is shutting down');
  }
}

export interface AdapterHostOptions {
  // Time limit of one request; the worker is stopped and restarted when it runs over.
  timeoutMs?: number;
  // Heap limit of the worker.
  memoryMb?: number;
  // Called with the reason after the worker was stopped or crashed.
  onRestart?(reason: string): void;
}

export interface AdapterHost {
  // Requests run one at a time, in the order sent.
  request(request: WorkerRequest): Promise<WorkerResult>;
  close(): Promise<void>;
}

export const ADAPTER_TIMEOUT_MS = 5000;
export const ADAPTER_MEMORY_MB = 64;

let workerSource: Promise<string> | undefined;

// The worker entry bundled into one ES module, built once per process. Bundling at run time
// works the same from TypeScript sources in development and compiled files in a release.
function workerCode(): Promise<string> {
  const entry = new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
  workerSource ??= build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    tsconfigRaw: '{}',
  }).then((result) => result.outputFiles[0]!.text);
  return workerSource;
}

interface Pending {
  id: number;
  resolve(result: WorkerResult): void;
  reject(error: Error): void;
}

export function createAdapterHost({
  timeoutMs = ADAPTER_TIMEOUT_MS,
  memoryMb = ADAPTER_MEMORY_MB,
  onRestart,
}: AdapterHostOptions = {}): AdapterHost {
  let worker: Worker | undefined;
  let pending: Pending | undefined;
  let nextId = 0;
  let closed = false;
  let chain: Promise<unknown> = Promise.resolve();
  // Loaded slots, replayed into a new worker after a restart.
  const loaded = new Map<string, Extract<WorkerRequest, { type: 'load' }>>();

  const stop = (reason: string) => {
    const current = worker;
    worker = undefined;
    if (current) {
      current.removeAllListeners();
      void current.terminate();
      if (!closed) onRestart?.(reason);
    }
  };

  const spawn = async (): Promise<Worker> => {
    const code = await workerCode();
    const created = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`), {
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 16 },
    });
    created.on('message', (reply: WorkerReply) => {
      if (!pending || reply.id !== pending.id) return;
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(Object.assign(new Error(reply.error.message), { stack: reply.error.stack }));
    });
    const fail = (message: string) => {
      if (worker !== created) return;
      pending?.reject(new Error(message));
      stop(message);
    };
    created.on('error', (error: Error & { code?: string }) =>
      fail(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? `The adapter used more than ${memoryMb} MB of memory and was stopped`
          : `The adapter worker crashed: ${error.message}`,
      ),
    );
    created.on('exit', (exitCode) => fail(`The adapter worker stopped with exit code ${exitCode}`));
    worker = created;
    for (const load of [...loaded.values()]) {
      await send(created, load).catch(() => loaded.delete(load.slot));
      // A replay that broke the worker is dropped, and the rest go to a new one.
      if (worker !== created) return closed ? Promise.reject(new AdapterHostClosed()) : spawn();
    }
    return created;
  };

  const send = (target: Worker, request: WorkerRequest): Promise<WorkerResult> =>
    new Promise<WorkerResult>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending = undefined;
        reject(new Error(`The adapter took longer than ${timeoutMs / 1000} s and was stopped`));
        stop('time limit');
      }, timeoutMs);
      pending = {
        id,
        resolve(result) {
          clearTimeout(timer);
          pending = undefined;
          resolve(result);
        },
        reject(error) {
          clearTimeout(timer);
          pending = undefined;
          reject(error);
        },
      };
      target.postMessage({ id, request });
    });

  const run = async (request: WorkerRequest): Promise<WorkerResult> => {
    if (closed) throw new AdapterHostClosed();
    const target = worker ?? (await spawn());
    if (closed) throw new AdapterHostClosed();
    const result = await send(target, request);
    if (request.type === 'load') loaded.set(request.slot, { ...request, runSamples: false });
    if (request.type === 'unload') loaded.delete(request.slot);
    if (request.type === 'approve') {
      const load = loaded.get(request.slot);
      if (load) loaded.set(request.slot, { ...load, approved: request.approved });
    }
    return result;
  };

  return {
    request(request) {
      const job = chain.then(() => run(request));
      chain = job.catch(() => {});
      return job;
    },
    async close() {
      closed = true;
      pending?.reject(new AdapterHostClosed());
      stop('closed');
    },
  };
}
