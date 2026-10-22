import type { AdapterInfo, AdapterList, SampleRun } from '@notify-hub/shared';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { severityColors } from '../src/core/index.js';
import { adapterSource } from './support/adapters.js';
import { adminClient, createTestHub, postHook, SOURCE_ID, type TestHub } from './support/hub.js';

describe('adapters API', () => {
  let dir: string;
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;

  const write = (name: string, content: string) => writeFileSync(join(dir, name), content);
  const list = async () => (await api('GET', '/api/adapters')).json<AdapterList>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'notify-hub-api-adapters-'));
    write('demo.js', adapterSource({ extra: "permissions: ['fetch:posters.example.com']," }));
    write('broken.js', 'export default {,};');
    write('boom.js', adapterSource({ id: 'boom', normalize: "throw new Error('no luck');" }));
    hub = createTestHub({ adaptersDir: dir, adapterHost: { timeoutMs: 500 } });
    api = await adminClient(hub);
  });
  afterEach(async () => {
    await hub.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the folder, each adapter with its status, and files that never loaded', async () => {
    const { folder, adapters, failed } = await list();
    expect(folder).toBe(dir);
    expect(adapters.map((adapter) => adapter.id).sort()).toEqual(['boom', 'demo', 'standard']);
    expect(adapters.find((adapter) => adapter.id === 'demo')).toMatchObject({
      origin: 'file',
      file: 'demo.js',
      active: true,
      status: 'ok',
      samples: ['one'],
      permissions: { requested: ['fetch:posters.example.com'], approved: [] },
    });
    expect(adapters.find((adapter) => adapter.id === 'boom')).toMatchObject({
      status: 'samples-failing',
      error: expect.stringContaining('no luck (boom.js:6:'),
    });
    expect(failed).toEqual([{ file: 'broken.js', error: expect.stringMatching(/^broken\.js:1:\d+: /) }]);
  });

  it('runs samples and renders their embeds', async () => {
    const runs = (await api('POST', '/api/adapters/demo/run-samples')).json<SampleRun[]>();
    expect(runs).toEqual([
      {
        name: 'one',
        messages: [expect.objectContaining({ event: 'demo', severity: 'info', title: 'hi', source: 'demo' })],
        embeds: [
          expect.objectContaining({ title: 'hi', color: severityColors.info, author: { name: 'Demo demo' } }),
        ],
      },
    ]);
    const failing = (await api('POST', '/api/adapters/boom/run-samples')).json<SampleRun[]>();
    expect(failing).toEqual([{ name: 'one', error: expect.stringContaining('no luck (boom.js:6:') }]);
    expect((await api('POST', '/api/adapters/nope/run-samples')).statusCode).toBe(404);
  });

  it('approves only permissions the adapter asks for, and keeps them across a restart', async () => {
    const refused = await api('PUT', '/api/adapters/demo/permissions', {
      approved: ['fetch:evil.example.com'],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().issues[0]).toMatchObject({ path: 'approved' });

    const approved = await api('PUT', '/api/adapters/demo/permissions', {
      approved: ['fetch:posters.example.com'],
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<AdapterInfo>().permissions.approved).toEqual(['fetch:posters.example.com']);

    await hub.restart();
    api = await adminClient(hub);
    const demo = (await list()).adapters.find((adapter) => adapter.id === 'demo');
    expect(demo?.permissions.approved).toEqual(['fetch:posters.example.com']);

    expect((await api('PUT', '/api/adapters/demo/permissions', { approved: 'all' })).statusCode).toBe(400);
  });

  it('warns on the source page when its adapter is missing or failing', async () => {
    hub.db.saveSource({
      id: 'gone',
      name: 'Gone',
      type: 'nope',
      token: 't'.repeat(40),
      enabled: true,
      config: {},
    });
    hub.db.saveSource({
      id: 'boomy',
      name: 'Boomy',
      type: 'boom',
      token: 'u'.repeat(40),
      enabled: true,
      config: {},
    });
    expect((await api('GET', '/api/sources/gone')).json().adapterProblem).toMatch(/There is no nope adapter/);
    expect((await api('GET', '/api/sources/boomy')).json().adapterProblem).toMatch(/samples of the boom\.js/);
    expect((await api('GET', `/api/sources/${SOURCE_ID}`)).json().adapterProblem).toBeUndefined();
  });

  it('delivers webhooks through an adapter file', async () => {
    hub.sqlite.sqlite.prepare('UPDATE sources SET type = ? WHERE id = ?').run('demo', SOURCE_ID);
    await postHook(hub, { title: 'From a file' });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    expect(hub.send.mock.calls[0]![1]).toMatchObject({ title: 'From a file', footer: { text: 'demo' } });
  });

  it('turns an adapter that runs over its time limit into an adapter error and keeps going', async () => {
    write('slow.js', adapterSource({ id: 'slow', normalize: 'while (body.loop) {} return [];' }));
    await hub.restart();
    hub.sqlite.sqlite.prepare('UPDATE sources SET type = ? WHERE id = ?').run('slow', SOURCE_ID);
    await postHook(hub, { loop: true });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(hub.send.mock.calls[0]![1]).toMatchObject({ footer: { text: 'adapter-error' } });
    expect(hub.db.getMessage(1)?.error).toBe('The adapter took longer than 0.5 s and was stopped');

    hub.sqlite.sqlite.prepare('UPDATE sources SET type = ? WHERE id = ?').run('standard', SOURCE_ID);
    await postHook(hub, { event: 'e', severity: 'info', title: 'Next' });
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(hub.send.mock.calls[1]![1]).toMatchObject({ title: 'Next' });
  });
});
