import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const migrations = fileURLToPath(new URL('../migrations', import.meta.url));

// A copy of the migrations folder that stops after the given number of migrations.
function migrationsUpTo(count: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'notify-hub-migrations-'));
  cpSync(migrations, folder, { recursive: true });
  const journalFile = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

describe('migrations 0002 and 0003', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('keeps Phase 2 routes and deliveries and fills in the new columns', () => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const orm = drizzle(sqlite);
    const before = migrationsUpTo(2);
    folders.push(before);
    migrate(orm, { migrationsFolder: before });

    sqlite.exec(`
      INSERT INTO sources (id, name, type, token) VALUES ('test', 'Test', 'standard', 'sealed');
      INSERT INTO routes (source_id, priority, conditions, channel_id, enabled) VALUES ('test', 1, '{}', '222', 1);
      INSERT INTO messages (source_id, received_at, headers, raw_payload, raw_content_type, status)
        VALUES ('test', '2026-10-09T00:00:00Z', '{}', '{}', 'application/json', 'delivered');
      INSERT INTO deliveries (message_id, channel_id, embed, attempt, status) VALUES (1, '222', '{}', 1, 'sent');
    `);

    migrate(orm, { migrationsFolder: migrations });

    expect(sqlite.prepare('SELECT * FROM routes').all()).toEqual([
      {
        id: 1,
        name: '',
        source_id: 'test',
        priority: 1,
        conditions: '{}',
        action: 'send',
        channel_id: '222',
        mentions: '[]',
        enabled: 1,
        continue_matching: 0,
      },
    ]);
    expect(sqlite.prepare('SELECT route_id, fallback, content, status FROM deliveries').all()).toEqual([
      { route_id: null, fallback: 0, content: null, status: 'sent' },
    ]);
    // Rules can now apply to any source, and still go with a deleted source.
    sqlite.exec(`INSERT INTO routes (source_id, priority, channel_id) VALUES (NULL, 2, '333')`);
    sqlite.exec(`DELETE FROM sources WHERE id = 'test'`);
    expect(sqlite.prepare('SELECT source_id FROM routes').all()).toEqual([{ source_id: null }]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });
});
