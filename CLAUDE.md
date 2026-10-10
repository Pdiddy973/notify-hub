# CLAUDE.md

Read PLAN.md before starting any task, and read the newest file in `what-was-done/` to see where the last session left off.

## Project

Discord Notification Hub: one self-hosted Node service that receives every webhook from the homelab, standardizes it, and posts it to the right Discord channel through a bot, all managed from a live web UI. It replaces the Notifiarr notification setup.

- One webhook endpoint family for all services; every source gets its own generated token, and requests with a wrong token are discarded and logged.
- Every message formatted the same way: color by severity, source icon, timestamp.
- Everything configured in the UI: Discord connection, sources, routing, formatting.
- A searchable log with the raw payload, the formatted message, and any error.
- New services are added as a single adapter file.
- Also in scope: automatic updates from GitHub releases (backup first, rollback on failure) and remote UI access through an outbound-only Cloudflare Tunnel.
- Launch sources: Sonarr, Radarr, Prowlarr, Plex, SABnzbd, Proxmox, Dockhand, Uptime Kuma, and VM health-check scripts.
- Not a goal: Notifiarr's TRaSH Guides sync or library stat reporting.

## Stack

TypeScript on Node 22 LTS: Fastify, discord.js v14, SQLite via better-sqlite3, Drizzle ORM with migrations, a SQLite-backed queue, Zod, pino, and AES-256-GCM for secrets at rest. Web UI: React, Vite, Tailwind, TanStack Query, with server-sent events for live updates. Adapters load with esbuild and run in worker threads. Ships as a release tarball that runs under systemd in an LXC.

## Layout

```text
docs/                screenshots only
what-was-done/       work log, one file per day (YYYY-MM-DD.md)
scripts/             create-lxc.sh, install.sh, setup-tunnel.sh, launcher.sh, notify-check.sh
adapters/            _template.js, copied to the data folder on first run
.github/workflows/   ci.yml, release.yml
server/src/          index.ts, config/, db/, ingest/, adapters/, core/, queue/, discord/, api/, security/
server/test/         fixtures/ holds captured payloads per source
web/src/             pages/, components/, lib/
shared/              Zod schemas and types used by both
```

## Run and test

- `npm run dev` starts the server.
- `npm test` runs the Vitest suite; adapters are tested against fixture payloads.
- CI runs lint and tests on every push.

## Conventions

- TypeScript strict mode; no `any` without a reason.
- Code comments are concise and only describe what the code does; they never mention past changes or history.
- Every adapter has a fixture file and a test before it is considered done.
- All config lives in the database; the only environment variables are the ones listed in the deployment section of PLAN.md.
- Never log secrets; run all stored payloads through the redaction function.
- Database changes only through numbered migrations.
- Small commits per task, one phase per branch.
- Full-page UI layouts use the entire viewport width with a modest buffer around the content.
- The README is the single documentation file: each topic has a short overview and collapsed sections for the details. The work log in `what-was-done/` is the one exception.
- Before committing anything that touches auth, secrets, ingest, logging, or the admin API, review it against the Security section below.
- When a piece of work is done, write `what-was-done/YYYY-MM-DD.md` for that day, or add to it if it already exists: what was done, problems solved, decisions made, what is still open, and the commits.

## Security

The hub holds the bot token, source tokens, and the admin login, so every change is checked against these rules. A full audit was done on 2026-10-09 (see `what-was-done/`).

**Rules for every change**

- Admin API routes need a session; a route marked `config: { public: true }` needs a stated reason. Validate every body and query with a shared Zod schema through `parseWith`.
- Secrets (bot token, source tokens, API keys, GitHub and tunnel tokens) are stored through the `SecretBox`, never returned by the API after saving, never logged, and left out of exports unless encrypted. Compare them with `tokensMatch`.
- Never log request bodies, headers, or full webhook URLs; logged URLs go through `maskHookToken`. Read every new log line and error message for secrets.
- Ingest checks the token before reading the body; a rejected request gets the shared 404 and only a discarded-log row. Every stored payload goes through the redactor, and a new body format (such as multipart) needs redaction before it is stored.
- Changes from the browser rely on SameSite=Strict cookies plus the same-origin check in the admin API; do not loosen either, and do not add CORS headers.
- UI: no `dangerouslySetInnerHTML`; links only to http(s) URLs with `rel="noreferrer"`; keep the Content-Security-Policy in `server.ts` strict.
- Queries go through Drizzle parameters; escape `%`, `_`, and `\` in LIKE patterns.
- Outbound requests go only to fixed hosts (Discord, GitHub releases) or hosts an adapter's approved permissions allow.
- Each security property gets a test: 401 without a session, secrets absent from the database, responses, and logs, rejected requests stored nowhere.

**Open items, by phase**

- Phase 3: give the discarded log its retention, row cap, and address blocking (it grows by sender, source, and reason today). Remove `npm run seed`, which shows the bot token on screen and accepts it as a command-line argument. Rotated source tokens stay valid for 10 minutes only.
- Phase 3 settings: changing the admin password asks for the current one and ends every other session.
- Phase 4: adapters run in worker threads with time limits and no access to the database or secrets; network use only with an approved `fetch` permission.
- Phase 5: redact multipart bodies (Plex) before storage.
- Phase 6 tunnel: trust proxy headers only from 127.0.0.1 so `request.ip` and `request.protocol` are right; key the login limiter on the real client address; mark cookies Secure (consider the `__Host-` prefix) and send HSTS over HTTPS; verify the Cloudflare Access token on every tunneled request; make the redaction list configurable; exports leave secrets out.
- Phase 6 service: test further systemd hardening on the LXC (PrivateDevices, ProtectKernelTunables, ProtectKernelModules, ProtectControlGroups, RestrictNamespaces, an empty CapabilityBoundingSet).
- Phase 7 updates: download only from this repository, verify the checksum before extracting, and store the GitHub token encrypted.

**Accepted for now**

- On the LAN the UI is plain HTTP, so the password and session cookie cross the network unencrypted; remote access goes through the tunnel's HTTPS.
- Whether a source id exists can be guessed from response timing; ids are names, not secrets.
- Encrypted values are not bound to the setting they belong to, which matters only to someone who can already write to the database.
