// The adapter worker: evaluates bundled adapter files and runs them, one request at a time.
// It is bundled with esbuild and started from a data: URL with an empty environment and no
// database handle. Each adapter runs in its own V8 context that holds only the JavaScript
// built-ins, and only strings cross between that context and this one.
import vm from 'node:vm';
import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { adapterFileSchema, adapterMeta, configWithDefaults, type AdapterMeta } from './definition.js';
import { applyMap } from './map.js';

export interface NormalizeInput {
  body: unknown;
  headers: Record<string, string>;
  config: Record<string, unknown>;
}

export type WorkerRequest =
  // Evaluates and checks a file; the slot keeps its previous version when this fails.
  | { type: 'load'; slot: string; code: string; approved: string[]; runSamples: boolean }
  | { type: 'unload'; slot: string }
  | { type: 'approve'; slot: string; approved: string[] }
  | { type: 'normalize'; slot: string; input: NormalizeInput }
  | { type: 'samples'; slot: string };

export interface WorkerError {
  message: string;
  stack?: string;
}

export interface SampleOutcome {
  name: string;
  output?: unknown[];
  error?: WorkerError;
}

export type WorkerResult =
  | { type: 'loaded'; meta: AdapterMeta; samples: SampleOutcome[] }
  | { type: 'output'; output: unknown[] }
  | { type: 'samples'; samples: SampleOutcome[] }
  | { type: 'done' };

export type WorkerReply =
  { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: WorkerError };

// Largest response body an adapter's fetch reads.
const FETCH_LIMIT_BYTES = 1024 * 1024;

const realFetch = globalThis.fetch.bind(globalThis);
// Nothing in this thread needs these; adapters never see this realm's globals anyway.
for (const name of ['fetch', 'WebSocket', 'EventSource', 'BroadcastChannel']) {
  Reflect.deleteProperty(globalThis, name);
}

// Runs inside each adapter's context before the adapter file. It keeps its own copies of
// the built-ins it uses, so an adapter that replaces JSON or Promise methods changes only
// its own results, and it hands the worker nothing but strings. Strict mode keeps
// normalize.caller from reaching the bridge functions.
const BRIDGE = `'use strict';
(() => {
  const { stringify, parse } = JSON;
  const { apply } = Reflect;
  const PromiseCtor = Promise;
  const then = PromiseCtor.prototype.then;
  const resolve = (value) => new PromiseCtor((done) => done(value));
  const ErrorCtor = Error;
  const StringCtor = String;
  const keys = Object.keys;
  const entries = Object.entries;
  const create = Object.create;
  const isArray = Array.isArray;
  const quiet = () => {};
  globalThis.console = { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet };

  const errorText = (error) => {
    try {
      const message = error !== null && typeof error === 'object' ? StringCtor(error.message) : StringCtor(error);
      const stack = error !== null && typeof error === 'object' && typeof error.stack === 'string' ? error.stack : undefined;
      return stringify({ error: { message, stack } });
    } catch {
      return '{"error":{"message":"The adapter threw something that cannot be read"}}';
    }
  };

  const makeFetch = (hostFetch) =>
    function fetch(url, init) {
      return new PromiseCtor((fulfill, reject) => {
        let request;
        try {
          const options = init === undefined || init === null ? {} : init;
          const headers = [];
          if (options.headers !== undefined && options.headers !== null) {
            const pairs = isArray(options.headers) ? options.headers : entries(options.headers);
            for (const [name, value] of pairs) headers.push([StringCtor(name), StringCtor(value)]);
          }
          request = stringify({
            url: StringCtor(url),
            method: StringCtor(options.method === undefined ? 'GET' : options.method),
            headers,
            body: options.body === undefined || options.body === null ? null : StringCtor(options.body),
          });
        } catch (error) {
          reject(error);
          return;
        }
        hostFetch(request, (resultText) => {
          const result = parse(resultText);
          if (result.error !== undefined) {
            reject(new ErrorCtor(result.error));
            return;
          }
          const headerMap = create(null);
          for (const [name, value] of result.headers) headerMap[name] = value;
          fulfill({
            ok: result.status >= 200 && result.status < 300,
            status: result.status,
            statusText: result.statusText,
            url: result.url,
            headers: { get: (name) => headerMap[StringCtor(name).toLowerCase()] ?? null },
            text: () => resolve(result.body),
            json: () => resolve(result.body).then(parse),
          });
        });
      });
    };

  return {
    // Runs the bundled file; returns [definition, description] or [null, error].
    evaluate(compiled) {
      const module = { exports: {} };
      try {
        compiled(module, module.exports);
        const exported = module.exports;
        const file =
          exported !== null && typeof exported === 'object' && 'default' in exported ? exported.default : exported;
        if (file === null || typeof file !== 'object') {
          return [null, stringify({ error: { message: 'The adapter file must export an object: export default { ... }' } })];
        }
        const described = {};
        for (const key of keys(file)) {
          const value = file[key];
          described[key] = typeof value === 'function' ? (key === 'normalize' ? true : '[function]') : value;
        }
        return [file, stringify({ described })];
      } catch (error) {
        return [null, errorText(error)];
      }
    },

    // Calls normalize and reports the result as text through hostDone, once.
    run(file, inputText, hostFetch, hostDone) {
      let finished = false;
      const done = (text) => {
        if (finished) return;
        finished = true;
        hostDone(text);
      };
      const fail = (error) => done(errorText(error));
      const succeed = (output) => {
        try {
          done(stringify({ output: output === undefined ? null : output }));
        } catch (error) {
          fail(error);
        }
      };
      try {
        const input = parse(inputText);
        if (hostFetch) input.fetch = makeFetch(hostFetch);
        const result = file.normalize(input);
        // The saved then works only on real promises; anything else is the result itself.
        // Calling it directly skips a then the adapter may have replaced.
        let pending = false;
        try {
          apply(then, result, [succeed, fail]);
          pending = true;
        } catch {
          pending = false;
        }
        if (!pending) succeed(result);
      } catch (error) {
        fail(error);
      }
    },
  };
})();
`;

interface Bridge {
  evaluate(compiled: unknown): [unknown, string];
  run(
    file: unknown,
    inputText: string,
    hostFetch: ((request: unknown, onResult: unknown) => void) | null,
    hostDone: (text: unknown) => void,
  ): void;
}

interface Slot {
  bridge: Bridge;
  // The adapter's exported object, which lives in its context.
  file: unknown;
  meta: AdapterMeta;
  map?: z.infer<typeof adapterFileSchema>['map'];
  // Hosts from permissions that are both requested and approved.
  hosts: string[];
}

const slots = new Map<string, Slot>();

function approvedHosts(meta: AdapterMeta, approved: string[]): string[] {
  return meta.permissions
    .filter((permission) => approved.includes(permission))
    .map((permission) => permission.slice('fetch:'.length).toLowerCase());
}

class AdapterFailure extends Error {
  constructor(error: WorkerError) {
    super(error.message);
    if (error.stack) this.stack = error.stack;
  }
}

// Reads text the bridge produced; anything else means the adapter interfered with it.
function readBridgeText(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string') throw new Error('The adapter returned something that is not text');
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== 'object')
    throw new Error('The adapter returned an unreadable result');
  const record = parsed as Record<string, unknown>;
  if (record.error !== undefined) {
    const error = record.error as { message?: unknown; stack?: unknown };
    throw new AdapterFailure({
      message: String(error.message),
      ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    });
  }
  return record;
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FETCH_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error(`The response is larger than ${FETCH_LIMIT_BYTES / 1024 / 1024} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const fetchRequestSchema = z.object({
  url: z.string(),
  method: z.string().max(20),
  headers: z.array(z.tuple([z.string(), z.string()])).max(100),
  body: z.string().nullable(),
});

// fetch limited to the approved hosts; redirects are refused so they cannot lead elsewhere.
async function fetchFor(hosts: string[], requestText: string) {
  const request = fetchRequestSchema.parse(JSON.parse(requestText));
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`fetch only allows http and https, not ${url.protocol}`);
  }
  const allowed = hosts.some((host) => (host.includes(':') ? url.host === host : url.hostname === host));
  if (!allowed)
    throw new Error(`fetch to ${url.host} is not approved; the adapter needs fetch:${url.hostname}`);
  const response = await realFetch(url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === null ? {} : { body: request.body }),
    redirect: 'error',
  });
  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: [...response.headers.entries()],
    body: await readLimited(response),
  };
}

function hostFetchFor(hosts: string[]) {
  return (requestText: unknown, onResult: unknown) => {
    if (typeof requestText !== 'string' || typeof onResult !== 'function') return;
    const reply = (result: object) => {
      try {
        (onResult as (text: string) => void)(JSON.stringify(result));
      } catch {
        // The adapter's own callback failed; its promise stays pending until the time limit.
      }
    };
    fetchFor(hosts, requestText).then(reply, (error: unknown) =>
      reply({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
}

// Runs normalize in the adapter's context, or applies its map here.
function normalize(slot: Slot, input: NormalizeInput): Promise<unknown[]> {
  if (slot.map) return Promise.resolve([applyMap(slot.map, input)]);
  const inputText = JSON.stringify(input);
  const hostFetch = slot.hosts.length ? hostFetchFor(slot.hosts) : null;
  return new Promise<unknown[]>((resolve, reject) => {
    const hostDone = (text: unknown) => {
      try {
        const { output } = readBridgeText(text);
        if (!Array.isArray(output)) {
          throw new Error('normalize must return an array of messages; return [] to ignore an event');
        }
        resolve(output);
      } catch (error) {
        reject(error);
      }
    };
    slot.bridge.run(slot.file, inputText, hostFetch, hostDone);
  });
}

async function runSamples(slot: Slot): Promise<SampleOutcome[]> {
  const outcomes: SampleOutcome[] = [];
  for (const sample of slot.meta.samples) {
    try {
      const output = await normalize(slot, {
        body: sample.body,
        headers: sample.headers ?? {},
        config: configWithDefaults(slot.meta.config, {}),
      });
      outcomes.push({ name: sample.name, output });
    } catch (error) {
      outcomes.push({ name: sample.name, error: toWorkerError(error) });
    }
  }
  return outcomes;
}

function toWorkerError(error: unknown): WorkerError {
  if (error instanceof Error)
    return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  return { message: String(error) };
}

function slotFor(name: string): Slot {
  const slot = slots.get(name);
  if (!slot) throw new Error('The adapter is not loaded');
  return slot;
}

// Evaluates a bundled file in a new context and checks what it exports.
function load(code: string, filename: string): Omit<Slot, 'hosts'> {
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  const bridge = vm.runInContext(BRIDGE, context) as Bridge;
  const compiled = vm.compileFunction(code, ['module', 'exports'], { parsingContext: context, filename });
  const [file, text] = bridge.evaluate(compiled);
  const { described } = readBridgeText(text);
  const parsed = adapterFileSchema.safeParse(described);
  if (!parsed.success) throw new Error(`The adapter file is not valid:\n${z.prettifyError(parsed.error)}`);
  return {
    bridge,
    file,
    meta: adapterMeta(parsed.data),
    ...(parsed.data.map ? { map: parsed.data.map } : {}),
  };
}

async function handle(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.type) {
    case 'load': {
      const loaded = load(request.code, request.slot);
      const slot: Slot = { ...loaded, hosts: approvedHosts(loaded.meta, request.approved) };
      const samples = request.runSamples ? await runSamples(slot) : [];
      slots.set(request.slot, slot);
      return { type: 'loaded', meta: slot.meta, samples };
    }
    case 'unload':
      slots.delete(request.slot);
      return { type: 'done' };
    case 'approve': {
      const slot = slotFor(request.slot);
      slot.hosts = approvedHosts(slot.meta, request.approved);
      return { type: 'done' };
    }
    case 'normalize':
      return { type: 'output', output: await normalize(slotFor(request.slot), request.input) };
    case 'samples':
      return { type: 'samples', samples: await runSamples(slotFor(request.slot)) };
  }
}

const port = parentPort;
if (port) {
  port.on('message', async ({ id, request }: { id: number; request: WorkerRequest }) => {
    let reply: WorkerReply;
    try {
      reply = { id, ok: true, result: await handle(request) };
    } catch (error) {
      reply = { id, ok: false, error: toWorkerError(error) };
    }
    try {
      port.postMessage(reply);
    } catch (error) {
      port.postMessage({ id, ok: false, error: toWorkerError(error) } satisfies WorkerReply);
    }
  });
}
