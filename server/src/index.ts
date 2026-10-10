import { loadConfig, readVersion } from './config/index.js';
import { buildServer } from './server.js';

const config = loadConfig();
const app = buildServer({ logger: { level: config.logLevel } });

await app.listen({ host: '0.0.0.0', port: config.port });
app.log.info({ version: readVersion() }, 'Notify Hub started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    void app.close().then(() => process.exit(0));
  });
}
