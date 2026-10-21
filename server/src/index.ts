import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, readVersion } from './config/index.js';
import { openSqlite } from './db/index.js';
import { connectDiscord } from './discord/index.js';
import { createHub } from './hub.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const sqlite = openSqlite(join(config.dataDir, 'hub.db'));

const hub = createHub({
  sqlite,
  appSecret: config.appSecret,
  version: readVersion(),
  logger: { level: config.logLevel },
  connect: connectDiscord,
  webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)),
});

await hub.app.listen({ host: '0.0.0.0', port: config.port });
hub.app.log.info({ version: readVersion(), dataDir: config.dataDir }, 'Notify Hub started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    hub.app.log.info({ signal }, 'Shutting down');
    void hub.close().then(() => {
      sqlite.sqlite.close();
      process.exit(0);
    });
  });
}
