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
- When a piece of work is done, write `what-was-done/YYYY-MM-DD.md` for that day, or add to it if it already exists: what was done, problems solved, decisions made, what is still open, and the commits.
