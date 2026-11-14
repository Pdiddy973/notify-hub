import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAdapterLoader,
  type AdapterLoaderOptions,
  type AdapterRegistry,
} from '../../src/adapters/index.js';
import { createSqliteDatabase, openSqlite } from '../../src/db/index.js';
import { createSecretBox } from '../../src/security/index.js';
import { APP_SECRET } from './hub.js';

// The source of a small valid adapter file. normalize's body starts on line 6, which tests
// use to check reported positions.
export function adapterSource({
  id = 'demo',
  normalize = "return [{ event: 'demo', severity: 'info', title: String(body.title) }];",
  extra = '',
}: { id?: string; normalize?: string; extra?: string } = {}): string {
  return `export default {
  id: '${id}',
  name: 'Demo ${id}',
  parse: 'json',
  async normalize({ body, headers, config, fetch }) {
    ${normalize}
  },
  samples: [{ name: 'one', body: { title: 'hi' } }],
  ${extra}
};
`;
}

// A temporary adapters folder and database; open() starts loaders that close with it.
export function createAdapterFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'notify-hub-adapters-'));
  const sqlite = openSqlite(':memory:');
  const db = createSqliteDatabase(sqlite, createSecretBox(APP_SECRET));
  const loaders: AdapterRegistry[] = [];
  return {
    dir,
    db,
    sqlite,
    write(name: string, content: string) {
      writeFileSync(join(dir, name), content);
    },
    remove(name: string) {
      unlinkSync(join(dir, name));
    },
    async open(options: Partial<AdapterLoaderOptions> = {}): Promise<AdapterRegistry> {
      const loader = createAdapterLoader({ db, userDir: dir, watch: false, ...options });
      loaders.push(loader);
      await loader.ready;
      return loader;
    },
    async close() {
      for (const loader of loaders) await loader.close();
      sqlite.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type AdapterFolder = ReturnType<typeof createAdapterFolder>;

export const input = (body: unknown) => ({ body, headers: {}, config: {} });
