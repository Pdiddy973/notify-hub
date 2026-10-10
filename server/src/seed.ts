// Temporary seed script: saves the Discord connection, one source, and one route,
// until the web UI handles setup. Run with: npm run seed
// Options: --bot-token, --guild, --channel; anything not given is asked for.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from './config/index.js';
import { createSqliteDatabase, openSqlite, settingKeys } from './db/index.js';
import { botTokenProblem } from './discord/token.js';
import { createSecretBox, generateToken } from './security/index.js';

const SOURCE_ID = 'test';

const { values } = parseArgs({
  options: {
    'bot-token': { type: 'string' },
    guild: { type: 'string' },
    channel: { type: 'string' },
  },
});

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const sqlite = openSqlite(join(config.dataDir, 'hub.db'));
const db = createSqliteDatabase(sqlite, createSecretBox(config.appSecret));
const prompt = createInterface({ input: stdin, output: stdout });

// Uses the option, else asks; Enter keeps the saved value when there is one.
async function value(option: string | undefined, question: string, saved?: string): Promise<string> {
  if (option) return option;
  const hint = saved ? ' (Enter keeps the saved value)' : '';
  const answer = (await prompt.question(`${question}${hint}: `)).trim();
  if (answer) return answer;
  if (saved) return saved;
  throw new Error(`${question} is required`);
}

try {
  const botToken = await value(
    values['bot-token'],
    'Discord bot token',
    db.getSetting(settingKeys.discordToken),
  );
  const problem = botTokenProblem(botToken);
  if (problem) {
    throw new Error(`${problem} Copy it from the Developer Portal: your application, Bot, Reset Token.`);
  }
  const guildId = await value(values.guild, 'Discord server ID', db.getSetting(settingKeys.discordGuildId));
  const savedRoute = db.listRoutes(SOURCE_ID)[0];
  const channelId = await value(values.channel, 'Discord channel ID', savedRoute?.channelId);

  db.setSetting(settingKeys.discordToken, botToken, { encrypted: true });
  db.setSetting(settingKeys.discordGuildId, guildId);

  const token = db.getSource(SOURCE_ID)?.token ?? generateToken();
  db.saveSource({ id: SOURCE_ID, name: 'Test', type: 'standard', token, enabled: true, config: {} });
  db.replaceRoutes(SOURCE_ID, [{ priority: 1, channelId, enabled: true }]);

  const url = `http://localhost:${config.port}/hook/${SOURCE_ID}/${token}`;
  const body = '{"event":"test","severity":"success","title":"Hello from Notify Hub","body":"It works."}';
  console.log(`
Saved. Start the hub with npm run dev, then send a test message.

PowerShell:
  Invoke-RestMethod -Method Post -Uri "${url}" -ContentType "application/json" -Body '${body}'

Command Prompt, bash, or Git Bash:
  curl -X POST -H "Content-Type: application/json" -d "${body.replaceAll('"', '\\"')}" ${url}

Webhook URL for the test source: ${url}
`);
} finally {
  prompt.close();
  sqlite.sqlite.close();
}
