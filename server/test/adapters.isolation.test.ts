import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adapterSource, createAdapterFolder, input, type AdapterFolder } from './support/adapters.js';

// An adapter that returns what its code can see as the message body.
const probe = (expression: string) =>
  adapterSource({
    id: 'probe',
    normalize: `return [{ event: 'probe', severity: 'debug', title: 'probe', body: JSON.stringify(${expression}) }];`,
  });

const seen = async (folder: AdapterFolder, expression: string, body: unknown = {}) => {
  folder.write('probe.js', probe(expression));
  const loader = await folder.open();
  const [message] = (await loader.normalize('probe', input(body))) as { body: string }[];
  return JSON.parse(message!.body) as unknown;
};

describe('adapter worker isolation', () => {
  let folder: AdapterFolder;
  beforeEach(() => {
    folder = createAdapterFolder();
  });
  afterEach(() => folder.close());

  it('runs each adapter in a context without process, require, network, or timers', async () => {
    process.env.NOTIFY_HUB_TEST_SECRET = 'do-not-leak';
    try {
      const result = await seen(
        folder,
        `{
        process: typeof process,
        require: typeof require,
        module: typeof globalThis.module,
        fetch: typeof globalThis.fetch,
        contextFetch: typeof fetch,
        WebSocket: typeof globalThis.WebSocket,
        setTimeout: typeof setTimeout,
        URL: typeof URL,
        consoleLog: typeof console.log,
      }`,
      );
      expect(result).toEqual({
        process: 'undefined',
        require: 'undefined',
        module: 'undefined',
        fetch: 'undefined',
        contextFetch: 'undefined',
        WebSocket: 'undefined',
        setTimeout: 'undefined',
        URL: 'undefined',
        consoleLog: 'function',
      });
    } finally {
      delete process.env.NOTIFY_HUB_TEST_SECRET;
    }
  });

  it('gives the usual constructor and caller escapes nothing to reach', async () => {
    const escape = (path: string) =>
      `(() => { try { return ${path}.constructor.constructor('return typeof process')(); } catch (e) { return 'threw'; } })()`;
    const result = (await seen(
      folder,
      `{
        global: ${escape('globalThis')},
        body: ${escape('body')},
        headers: ${escape('headers')},
        objectLiteral: ${escape('({})')},
        caller: (() => { try { return String(this.normalize.caller); } catch (e) { return 'threw'; } })(),
      }`,
      { nested: true },
    )) as Record<string, string>;
    expect(result.global).toBe('undefined');
    expect(result.body).toBe('undefined');
    expect(result.headers).toBe('undefined');
    expect(result.objectLiteral).toBe('undefined');
    expect(['null', 'threw']).toContain(result.caller);
  });

  it('keeps one adapter from changing built-ins for others or for its own permissions', async () => {
    folder.write(
      'meddler.js',
      `Array.prototype.includes = () => true;
Array.prototype.some = () => true;
Array.prototype.filter = function () { return this; };
${adapterSource({
  id: 'meddler',
  normalize: "return [{ event: 'm', severity: 'info', title: typeof fetch }];",
  extra: "permissions: ['fetch:example.com'],",
})}`,
    );
    folder.write(
      'demo.js',
      adapterSource({
        normalize: "return [{ event: 'd', severity: 'info', title: String([1].includes(2)) }];",
      }),
    );
    const loader = await folder.open();
    await expect(loader.normalize('meddler', input({}))).resolves.toMatchObject([{ title: 'undefined' }]);
    await expect(loader.normalize('demo', input({}))).resolves.toMatchObject([{ title: 'false' }]);
  });

  it('keeps going when an adapter breaks its own JSON and Promise built-ins', async () => {
    folder.write(
      'broken.js',
      adapterSource({
        id: 'broken',
        normalize:
          "if (body.wreck) { JSON.stringify = () => ({ not: 'text' }); Promise.prototype.then = () => {}; } return [];",
      }),
    );
    folder.write('demo.js', adapterSource());
    const loader = await folder.open({ host: { timeoutMs: 500 } });
    await expect(loader.normalize('broken', input({ wreck: true }))).resolves.toEqual([]);
    await expect(loader.normalize('broken', input({}))).resolves.toEqual([]);
    await expect(loader.normalize('demo', input({ title: 'fine' }))).resolves.toMatchObject([
      { title: 'fine' },
    ]);
  });

  it('refuses dynamic imports that esbuild cannot see at build time', async () => {
    folder.write(
      'probe.js',
      adapterSource({
        id: 'probe',
        normalize: `
    const tries = [() => import(body.module), () => Function('return import("node:fs")')()];
    const codes = [];
    for (const attempt of tries) await attempt().then(() => codes.push('loaded'), (e) => codes.push(e.code));
    return [{ event: 'probe', severity: 'debug', title: codes.join(' ') }];`,
      }),
    );
    const loader = await folder.open();
    const [message] = await loader.normalize('probe', input({ module: 'node:fs' }));
    expect(message).toMatchObject({
      title: 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING',
    });
  });

  it('stops an adapter that runs too long, then carries on with every adapter', async () => {
    folder.write('slow.js', adapterSource({ id: 'slow', normalize: 'while (body.loop) {} return [];' }));
    folder.write('demo.js', adapterSource());
    const restarts: string[] = [];
    const loader = await folder.open({
      host: { timeoutMs: 300, onRestart: (reason) => restarts.push(reason) },
    });
    await expect(loader.normalize('slow', input({ loop: true }))).rejects.toThrow(
      'The adapter took longer than 0.3 s and was stopped',
    );
    expect(restarts).toEqual(['time limit']);
    await expect(loader.normalize('slow', input({ loop: false }))).resolves.toEqual([]);
    await expect(loader.normalize('demo', input({ title: 'after' }))).resolves.toMatchObject([
      { title: 'after' },
    ]);
  });

  it('stops an adapter that uses too much memory', async () => {
    folder.write(
      'hungry.js',
      adapterSource({
        id: 'hungry',
        normalize:
          'const keep = []; while (body.eat) keep.push(new Array(100000).fill(keep.length)); return [];',
      }),
    );
    const loader = await folder.open({ host: { memoryMb: 24, timeoutMs: 20_000 } });
    await expect(loader.normalize('hungry', input({ eat: true }))).rejects.toThrow(
      'The adapter used more than 24 MB of memory and was stopped',
    );
    await expect(loader.normalize('hungry', input({ eat: false }))).resolves.toEqual([]);
  }, 30_000);

  describe('fetch permission', () => {
    let server: Server;
    let other: Server;
    let host: string;
    let otherHost: string;

    const listen = (target: Server) =>
      new Promise<string>((resolve) =>
        target.listen(0, '127.0.0.1', () => resolve(`127.0.0.1:${(target.address() as AddressInfo).port}`)),
      );

    beforeAll(async () => {
      server = createServer((request, response) => {
        if (request.url === '/redirect') {
          response.writeHead(302, { location: `http://${otherHost}/` }).end();
        } else {
          response.end('poster.jpg');
        }
      });
      other = createServer((_, response) => response.end('elsewhere'));
      host = await listen(server);
      otherHost = await listen(other);
    });
    afterAll(() => {
      server.close();
      other.close();
    });

    const fetcher = () =>
      adapterSource({
        id: 'fetcher',
        normalize: `
    if (!fetch) return [{ event: 'f', severity: 'info', title: 'no fetch' }];
    const response = await fetch(body.url);
    return [{ event: 'f', severity: 'info', title: await response.text() }];`,
        extra: `permissions: ['fetch:${host}'],`,
      });

    it('gives fetch only after approval, and only for the approved host', async () => {
      folder.write('fetcher.js', fetcher());
      const loader = await folder.open();
      const call = (url: string) => loader.normalize('fetcher', input({ url }));
      expect(loader.list().adapters.find((a) => a.id === 'fetcher')?.permissions).toEqual({
        requested: [`fetch:${host}`],
        approved: [],
      });
      await expect(call(`http://${host}/`)).resolves.toMatchObject([{ title: 'no fetch' }]);

      await loader.setApprovals('fetcher', [`fetch:${host}`]);
      await expect(call(`http://${host}/`)).resolves.toMatchObject([{ title: 'poster.jpg' }]);
      await expect(call(`http://${otherHost}/`)).rejects.toThrow(`fetch to ${otherHost} is not approved`);
      await expect(call(`http://${host}/redirect`)).rejects.toThrow(/fetch failed/);
      await expect(call('file:///etc/passwd')).rejects.toThrow('fetch only allows http and https');

      await loader.setApprovals('fetcher', []);
      await expect(call(`http://${host}/`)).resolves.toMatchObject([{ title: 'no fetch' }]);
    });

    it('keeps approvals across a restart of the hub and of the worker', async () => {
      folder.write('fetcher.js', fetcher());
      folder.write('slow.js', adapterSource({ id: 'slow', normalize: 'while (body.loop) {} return [];' }));
      const first = await folder.open({ host: { timeoutMs: 300 } });
      await first.setApprovals('fetcher', [`fetch:${host}`]);
      await expect(first.normalize('slow', input({ loop: true }))).rejects.toThrow(/took longer/);
      await expect(first.normalize('fetcher', input({ url: `http://${host}/` }))).resolves.toMatchObject([
        { title: 'poster.jpg' },
      ]);
      await first.close();

      const second = await folder.open();
      await expect(second.normalize('fetcher', input({ url: `http://${host}/` }))).resolves.toMatchObject([
        { title: 'poster.jpg' },
      ]);
    });
  });
});
