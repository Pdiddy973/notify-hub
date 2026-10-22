import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterTemplateFile, parseBody } from '../src/adapters/index.js';
import { adapterSource, createAdapterFolder, input, type AdapterFolder } from './support/adapters.js';

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

describe('adapter loader', () => {
  let folder: AdapterFolder;
  beforeEach(() => {
    folder = createAdapterFolder();
  });
  afterEach(() => folder.close());

  const find = (loader: Awaited<ReturnType<AdapterFolder['open']>>, file: string) =>
    loader.list().adapters.find((adapter) => adapter.file === file);
  const failure = (loader: Awaited<ReturnType<AdapterFolder['open']>>, file: string) =>
    loader.list().failed.find((item) => item.file === file)?.error;

  it('loads the built-in adapters and copies the template, which is not loaded itself', async () => {
    const loader = await folder.open();
    expect(existsSync(join(folder.dir, '_template.js'))).toBe(true);
    const { folder: shown, adapters, failed } = loader.list();
    expect(shown).toBe(folder.dir);
    expect(failed).toEqual([]);
    expect(adapters.map((adapter) => adapter.id)).not.toContain('my-service');
    expect(adapters.find((adapter) => adapter.id === 'standard')).toMatchObject({
      origin: 'built-in',
      active: true,
      status: 'ok',
      parse: 'json',
      samples: ['basic'],
    });
  });

  it('passes the standard fixture through the built-in standard adapter', async () => {
    const loader = await folder.open();
    const raw = fixture('standard/download.json');
    expect(await loader.normalize('standard', input(parseBody(raw, 'json')))).toEqual([JSON.parse(raw)]);
  });

  it('loads a copy of the template without problems', async () => {
    copyFileSync(adapterTemplateFile, join(folder.dir, 'my-service.js'));
    const loader = await folder.open();
    expect(find(loader, 'my-service.js')).toMatchObject({
      id: 'my-service',
      status: 'ok',
      version: 1,
      samples: ['check passed'],
      origin: 'file',
    });
    const [message] = await loader.normalize(
      'my-service',
      input({ event: 'check', ok: false, title: 'Down', message: 'No answer', host: 'nas' }),
    );
    expect(message).toEqual({
      event: 'check',
      severity: 'error',
      title: 'Down',
      body: 'No answer',
      fields: [{ name: 'Host', value: 'nas', inline: true }],
    });
  });

  it('lets a file override a built-in adapter with the same id', async () => {
    folder.write(
      'standard.js',
      adapterSource({
        id: 'standard',
        normalize: "return [{ event: 'mine', severity: 'debug', title: 'x' }];",
      }),
    );
    const loader = await folder.open();
    const standard = loader.list().adapters.filter((adapter) => adapter.id === 'standard');
    expect(standard).toHaveLength(2);
    expect(standard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: 'built-in', active: false }),
        expect.objectContaining({ origin: 'file', active: true, file: 'standard.js' }),
      ]),
    );
    expect(await loader.normalize('standard', input({}))).toEqual([
      { event: 'mine', severity: 'debug', title: 'x' },
    ]);

    folder.remove('standard.js');
    await loader.reload();
    expect(loader.get('standard')?.origin).toBe('built-in');
  });

  it('reports a syntax error with the file, line, and column', async () => {
    folder.write('bad.js', "export default {\n  id: 'bad',,\n};\n");
    const loader = await folder.open();
    expect(failure(loader, 'bad.js')).toMatch(/^bad\.js:2:\d+: /);
    expect(loader.get('bad')).toBeUndefined();
  });

  it('refuses imports of packages, Node modules, and files outside the folder', async () => {
    folder.write('fs.js', `import fs from 'node:fs';\n${adapterSource({ id: 'fs' })}`);
    folder.write('pkg.js', `import { z } from 'zod';\n${adapterSource({ id: 'pkg' })}`);
    folder.write('up.js', `import x from '../outside.js';\n${adapterSource({ id: 'up' })}`);
    const loader = await folder.open();
    expect(failure(loader, 'fs.js')).toMatch(/fs\.js:1:\d+: Adapters cannot import "node:fs"/);
    expect(failure(loader, 'pkg.js')).toMatch(/cannot import "zod"/);
    expect(failure(loader, 'up.js')).toMatch(/"\.\.\/outside\.js" is outside the adapters folder/);
  });

  it('bundles helper files starting with _ without loading them as adapters', async () => {
    folder.write('_shout.js', 'export const shout = (text) => text.toUpperCase();\n');
    folder.write(
      'helped.js',
      `import { shout } from './_shout.js';\n${adapterSource({
        id: 'helped',
        normalize: "return [{ event: 'e', severity: 'info', title: shout(body.title) }];",
      })}`,
    );
    const loader = await folder.open();
    expect(loader.list().failed).toEqual([]);
    expect(await loader.normalize('helped', input({ title: 'quiet' }))).toMatchObject([{ title: 'QUIET' }]);
  });

  it('explains files with the wrong shape', async () => {
    folder.write('typo.js', adapterSource({ id: 'typo', extra: 'normalise() {},' }));
    folder.write(
      'both.js',
      adapterSource({ id: 'both', extra: "map: { event: 'e', severity: 'info', title: 't' }," }),
    );
    folder.write(
      'nosamples.js',
      adapterSource({ id: 'nosamples' }).replace(/samples: \[.*\],/, 'samples: [],'),
    );
    folder.write('Bad-Id.js', adapterSource({ id: 'Bad Id' }));
    const loader = await folder.open();
    expect(failure(loader, 'typo.js')).toMatch(/not valid[\s\S]*normalise/);
    expect(failure(loader, 'both.js')).toMatch(/either normalize or map/);
    expect(failure(loader, 'nosamples.js')).toMatch(/at least one sample/);
    expect(failure(loader, 'Bad-Id.js')).toMatch(/id must be up to 48 lowercase/);
  });

  it('shows where a file throws while loading', async () => {
    folder.write('throws.js', `throw new Error('not today');\n${adapterSource({ id: 'throws' })}`);
    const loader = await folder.open();
    expect(failure(loader, 'throws.js')).toBe('not today (throws.js:1:7)');
  });

  it('loads an adapter whose samples fail, and says which sample and why', async () => {
    folder.write('noseverity.js', adapterSource({ id: 'noseverity', normalize: "return [{ title: 'x' }];" }));
    folder.write('boom.js', adapterSource({ id: 'boom', normalize: "throw new Error('boom');" }));
    const loader = await folder.open();
    expect(find(loader, 'noseverity.js')).toMatchObject({
      status: 'samples-failing',
      error: expect.stringMatching(/Sample "one" is not a standard message[\s\S]*severity/),
    });
    expect(find(loader, 'boom.js')).toMatchObject({
      status: 'samples-failing',
      error: expect.stringMatching(/^Sample "one": boom \(boom\.js:6:\d+\)$/),
    });
  });

  it('reports where normalize throws, in the original file', async () => {
    folder.write(
      'demo.js',
      adapterSource({ normalize: "if (body.fail) throw new Error('bad payload'); return [];" }),
    );
    const loader = await folder.open();
    await expect(loader.normalize('demo', input({ fail: true }))).rejects.toThrow(
      /^bad payload \(demo\.js:6:\d+\)$/,
    );
    await expect(loader.normalize('demo', input({ fail: false }))).resolves.toEqual([]);
  });

  it('requires normalize to return an array', async () => {
    folder.write('single.js', adapterSource({ id: 'single', normalize: "return { title: 'x' };" }));
    const loader = await folder.open();
    expect(find(loader, 'single.js')?.error).toMatch(/must return an array/);
  });

  it('keeps the last working version running while a change is broken', async () => {
    folder.write('demo.js', adapterSource());
    const loader = await folder.open();
    expect(find(loader, 'demo.js')?.status).toBe('ok');

    folder.write('demo.js', adapterSource().replace("parse: 'json',", "parse: 'json',,"));
    await loader.reload();
    expect(find(loader, 'demo.js')).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/^demo\.js:4:\d+: /),
    });
    expect(await loader.normalize('demo', input({ title: 'still' }))).toMatchObject([{ title: 'still' }]);

    folder.write(
      'demo.js',
      adapterSource({ normalize: "return [{ event: 'v2', severity: 'info', title: 'new' }];" }),
    );
    await loader.reload();
    expect(find(loader, 'demo.js')).toMatchObject({ status: 'ok' });
    expect(find(loader, 'demo.js')?.error).toBeUndefined();
    expect(await loader.normalize('demo', input({}))).toMatchObject([{ event: 'v2' }]);
  });

  it('unloads removed files', async () => {
    folder.write('demo.js', adapterSource());
    const loader = await folder.open();
    folder.remove('demo.js');
    await loader.reload();
    expect(loader.get('demo')).toBeUndefined();
    await expect(loader.normalize('demo', input({}))).rejects.toThrow('No adapter named demo');
  });

  it('gives an id to the first file only', async () => {
    folder.write('a.js', adapterSource({ id: 'dup' }));
    folder.write('b.js', adapterSource({ id: 'dup' }));
    const loader = await folder.open();
    expect(find(loader, 'a.js')?.status).toBe('ok');
    expect(failure(loader, 'b.js')).toBe('a.js already uses the id "dup"; give each adapter its own id');
  });

  it('runs declarative map adapters', async () => {
    folder.write(
      'kuma.js',
      `export default {
  id: 'kuma',
  name: 'Kuma',
  parse: 'json',
  map: {
    event: 'status',
    severity: { from: 'body.up', values: { true: 'success', false: 'error' } },
    title: '{{body.name}} is {{body.state}}',
    fields: [{ name: 'Ping', value: '{{body.ping}}', inline: true }],
  },
  samples: [{ name: 'up', body: { name: 'nas', state: 'up', up: true, ping: 12 } }],
};
`,
    );
    const loader = await folder.open();
    expect(find(loader, 'kuma.js')?.status).toBe('ok');
    expect(await loader.normalize('kuma', input({ name: 'nas', state: 'down', up: false }))).toEqual([
      { event: 'status', severity: 'error', title: 'nas is down' },
    ]);
  });

  it('records the load result of each adapter in the database', async () => {
    folder.write('boom.js', adapterSource({ id: 'boom', normalize: "throw new Error('boom');" }));
    await folder.open();
    const rows = folder.sqlite.sqlite
      .prepare('SELECT id, load_status AS status, last_error AS error FROM adapters ORDER BY id')
      .all();
    expect(rows).toEqual([
      { id: 'boom', status: 'samples-failing', error: expect.stringContaining('boom') },
      { id: 'standard', status: 'ok', error: null },
    ]);
  });

  it('reloads on its own when the folder changes', async () => {
    const loader = await folder.open({ watch: true });
    folder.write('demo.js', adapterSource());
    await vi.waitFor(() => expect(loader.get('demo')).toBeDefined(), { timeout: 5000 });
  });
});
