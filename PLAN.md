# Discord Notification Hub: Build Plan


## 1. Overview

The hub is one self-hosted Node service that receives every webhook from your homelab, standardizes it, and posts it to the right Discord channel through a bot, all managed from a live web UI. It replaces your Notifiarr notification setup.

**Goals**

- One webhook endpoint family for all services, instead of many Discord webhook URLs.
- Every message formatted the same way (color by severity, source icon, timestamp).
- Everything configured in the UI: Discord connection, sources, routing, formatting.
- A searchable log showing the raw incoming payload, the formatted message, and any error.
- Room to add bot slash commands later without a rewrite.

**Also in scope:** new services added as a single adapter file you write (or have Claude write), automatic updates from GitHub releases with a backup first and rollback if something breaks, and remote access to the web UI through an outbound-only Cloudflare Tunnel with nothing opened inbound. Every source gets its own automatically generated token, and requests with a wrong token are discarded and logged.

**Sources to support at launch:** Sonarr, Radarr, Prowlarr, Plex, SABnzbd, Proxmox, Dockhand, Uptime Kuma, and health-check scripts running on your VMs.

**Not a goal:** replicating Notifiarr's TRaSH Guides sync or library stat reporting.

## 2. Scope

Version 1 covers receiving, normalizing, routing, logging, and managing everything from the UI; bot commands and advanced alerting come later.

| Area | In v1 | Later |
| --- | --- | --- |
| Ingest | Per-source webhook URLs with auto-generated tokens, wrong tokens discarded and logged, JSON and multipart | Email or syslog ingest |
| Normalize | Adapter files (built-in and your own), hot-reloaded | Community adapter packs |
| Deliver | Bot posts embeds to channels, queue with retries | Threads per source, message edits |
| Routing | Source to channel, filters by event type and severity | Time-based rules, quiet hours |
| Web UI | Log, live feed, sources, routing, formatting, settings | Multi-user roles |
| Bot | Posting only | Slash commands such as /mute and /status |
| Alerts | Error log and failed-delivery resend | Deduplication, grouping, escalation |
| Ops | Release tarball, install script, health endpoint, backup export, GitHub update checks with one-click or automatic apply | Metrics endpoint, signed releases |

**Out of scope:** TRaSH Guides profile sync, library statistics, and any inbound Discord-to-service control.

## 3. Architecture

One service receives, standardizes, and delivers every message, and the web UI manages it all against the same SQLite database.

&#91;embedded content: architecture · 5-step pipeline, 1 database\]

Services post to Ingest, which saves the raw request first; adapters, router, and queue run behind it, and the bot is the only part that talks to Discord. The web UI reads and writes the same database.

## 4. Tech stack

Everything is TypeScript on Node 22 LTS, shipped as a release tarball that runs under systemd in an LXC, so one language covers the receiver, bot, and UI.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, Node 22 | You already use Node; types protect the adapters |
| HTTP server | Fastify | Fast, schema validation, multipart plugin for Plex |
| Discord | discord.js v14 | Standard bot library, slash commands ready later |
| Database | SQLite via better-sqlite3 | One file, no extra service, plenty for this volume |
| Query layer | Drizzle ORM with migrations | Typed queries, simple migration files |
| Queue | SQLite-backed table with a worker loop | Survives restarts, no Redis needed |
| Web UI | React, Vite, Tailwind, TanStack Query | Live forms and tables; built to static files Fastify serves |
| Live updates | Server-sent events | Simpler than WebSockets for a one-way feed |
| Validation | Zod | Shared schemas between API and UI |
| Secrets | AES-256-GCM, key from environment | Bot token and source tokens encrypted at rest |
| Tests | Vitest, plus fixture payloads per source | Adapters tested against real captured JSON |
| Logging | pino | Structured app logs, separate from message logs |

**Added:** adapter files load with esbuild and run in worker threads; the hub updates itself with help from a small launcher shell script; release builds run in GitHub Actions and attach a tarball and checksum to each GitHub release.

**Repository layout:** a single repo with `server/` and `web/` packages in an npm workspace.

## 5. Data model

Eleven SQLite tables hold all configuration and history, so the UI is the only place settings live.

| Table | Purpose | Key fields |
| --- | --- | --- |
| settings | Key-value app settings | key, value, encrypted flag (bot token, guild id, retention days) |
| sources | One row per connected service | id, name, type, encrypted token, previous token and its expiry, enabled, adapter config JSON, embed style JSON |
| channels | Cached Discord channels from the bot | id, guild id, name, type, last synced |
| routes | Rules that pick a destination | id, source id, priority, match conditions JSON, channel id, enabled |
| messages | One row per received webhook | id, source id, received at, headers, raw payload, raw content type, status |
| deliveries | One row per send attempt | id, message id, channel id, formatted embed JSON, attempt, status, error, discord message id, sent at |
| samples | Saved payloads used as adapter fixtures | id, source id, payload, label |

**Four added tables:** `adapters` (id, file path, version, load status, last error, approved permissions), `updates` (checked at, running version, latest version, status, applied at, result), `health_events` (check name, status, started at, resolved at, detail), and `discarded` (first seen, last seen, repeat count, client address, source tried, reason, user agent, method, content type, content length, token hint).

**Statuses for messages:** received, normalized, queued, delivered, failed, unrouted, dropped.

**Notes**

- Raw payloads are stored after secret redaction, so API keys inside payloads never persist.
- Messages and deliveries are pruned by the retention setting, and discarded entries by their own shorter one (default 7 days); sources, routes, and settings are never pruned.
- Schema changes ship as numbered Drizzle migrations that run at startup.

## 6. Standard message format

Every adapter outputs one internal shape, and one renderer turns it into a Discord embed, which is what keeps all messages looking alike.

```json
{
  "source": "sonarr-main",
  "event": "download",
  "severity": "success",
  "title": "Episode downloaded",
  "body": "Show Name S02E05 - Episode Title",
  "fields": [
    { "name": "Quality", "value": "WEBDL-1080p", "inline": true },
    { "name": "Indexer", "value": "NZBgeek", "inline": true }
  ],
  "url": "https://sonarr.local/series/show-name",
  "imageUrl": "https://.../poster.jpg",
  "timestamp": "2026-10-09T16:20:00Z"
}
```

**Optional field:** `key` identifies what a message is about (for example host plus check) so the hub can track state changes; adapters set it when it applies, as described in section 7.

**Severity to color**

| Severity | Meaning | Color |
| --- | --- | --- |
| info | Neutral updates | Blue |
| success | Completed or healthy | Green |
| warning | Needs attention soon | Amber |
| error | Failed or down | Red |
| debug | Verbose or test | Grey |

**Embed template**

- Author line: source icon and source name.
- Title and URL from the standard message; description is the body.
- Up to 10 fields, inline where marked.
- Thumbnail or image when provided.
- Footer: event type; timestamp is the received time.
- Limits enforced by the renderer: title 256, description 4096, 25 fields, 6000 total characters; overflow is truncated with an ellipsis and the full text stays in the log.

Per-source style overrides (color map, icon, which fields to show, title template) are stored on the source and previewed live in the UI.

## 7. Sources and adapters

An adapter is a small module that takes one raw request and returns zero or more standard messages; each service gets its own, and you add your own as a single file.

| Source | How it sends | Payload | Adapter notes |
| --- | --- | --- | --- |
| Sonarr | Settings, Connect, Webhook | JSON | Map grab, import, upgrade, rename, health, and test events; show series, episode, quality |
| Radarr | Settings, Connect, Webhook | JSON | Same pattern as Sonarr with movie fields |
| Prowlarr | Settings, Connect, Webhook | JSON | Health and application-update events; indexer status |
| Uptime Kuma | Settings, Notifications, Webhook | JSON | Map up, down, pending, and maintenance statuses; show monitor name, URL, message, and ping |
| Plex | Webhooks (you have Plex Pass) | Multipart form with a JSON `payload` field | Parse the form, handle play, stop, new library item; ignore the thumbnail upload |
| SABnzbd | Notification script or Apprise | Depends on method | A short script POSTs JSON to the hub; map job complete and failed |
| Proxmox | Notification target of type webhook | Templated body you define | Provide a recommended body template to paste into Proxmox; map severity |
| Dockhand | To verify in its notification settings | Unknown | Check what it supports first; fall back to an adapter file or the health-check script |
| Health-check script | `curl` POST from the script | Fixed JSON contract | Built-in adapter plus a ready-made example script for VMs and anything without a built-in adapter (see below) |
| Anything else | Any JSON POST | Any | Your own adapter file |

**Adapter interface**

- Required: `id`, `name`, `parse`, `samples`, and either `normalize` or `map`.
- Optional: `version`, `config`, `style`, `help`, `permissions`.
- `normalize({ body, headers, config })` returns an array of standard messages; an empty array means the event is ignored on purpose.
- Adapters never handle tokens: ingest checks the source's token first, and a request with a wrong token never reaches an adapter (see section 8).

**Adapter files (one file per service, written by you)**

Each adapter is one file in the adapters folder, and built-in adapters use the same format, so yours are first-class. The hub loads every file on start, reloads it when it changes, and shows its status in the UI.

```js
// adapters/my-service.js
export default {
  id: 'my-service',
  name: 'My Service',
  version: 1,
  // fields the UI asks for when adding a source of this type
  config: {
    baseUrl: { type: 'string', label: 'Service URL' },
    pingOnError: { type: 'boolean', label: 'Ping on errors', default: false },
  },
  // default look, overridable per source in the UI
  style: { icon: 'https://example.com/icon.png', colors: { error: '#e74c3c' } },
  // body format: json, form, or text
  parse: 'json',
  // turn one request into standard messages
  normalize({ body, headers, config }) {
    return [{
      event: body.event,
      severity: body.ok ? 'success' : 'error',
      title: body.title,
      body: body.message,
      url: config.baseUrl,
    }];
  },
  // example payloads used by tests and the UI test button
  samples: [{ name: 'ok', body: { event: 'check', ok: true, title: 'All good', message: 'Check passed' } }],
  // setup text shown on the source page
  help: 'Add this URL as a webhook in My Service settings.',
};
```

For simple services, a declarative `map` can replace `normalize`, for example `map: { title: '{{body.event}} on {{body.host}}', severity: { from: 'body.status', values: { up: 'success', down: 'error' } } }`.

**How it works**

- **Where files live:** `/var/lib/notify-hub/adapters` in the data folder, so you edit them in VS Code and updates never overwrite them. A file with the same `id` as a built-in overrides it.
- **Creating one:** the UI's New adapter button or `npm run new-adapter <name>` copies `_template.js` into the folder with the fields filled in.
- **Configuration:** the file declares defaults and the config fields; the values for each source (URLs, options, secrets) are entered in the UI and stored in the database.
- **Validation:** each file is checked against a schema on load; syntax errors, bad shapes, and thrown errors show on the Adapters page with the line number, and the last working version keeps running.
- **Testing:** the hub runs every `samples` entry through `normalize` and shows the resulting embed; a button saves the last received payload as a new sample.
- **Isolation:** adapters run in a worker thread with a time limit and receive only the request data, never the database or secrets. This is not a hard sandbox, so only mount a folder you control. An adapter that needs network access, for example to look up a poster, must declare `permissions: ['fetch']`, and you approve it in the UI.
- **Writing them with Claude:** paste a real payload and ask for an adapter following `README.md` and `_template.js`; save the payload under `samples` first so the result is tested straight away.

**Template file**

`adapters/_template.js` is a fully commented starting point, shipped in the repo and the image, and copied into `/var/lib/notify-hub/adapters` on first run. Files starting with an underscore are never loaded as adapters.

- Covers every field: `id`, `name`, `version`, `config`, `style`, `parse`, `normalize`, `samples`, `help`, and `permissions`.
- Includes the declarative `map` alternative, commented out, for simple services.
- Has one working sample, so the copy passes validation and shows a test embed straight away.
- Comments stay short and only say what each field does.
- Copy it with the New adapter button, `npm run new-adapter <name>`, or by hand, then change `id`, `name`, and `normalize`.
- `README.md` (Adapters section) explains each field in one line and lists the standard message fields and severities.

**Uptime Kuma adapter**

Uptime Kuma sends one webhook per status change, so the built-in `uptime-kuma` adapter turns each one into a single message.

- In Uptime Kuma, open Settings, Notifications, add a notification of type Webhook, paste the source URL from the hub, and choose the JSON content type.
- Heartbeat status maps to severity: up is success, down is error, pending is warning, maintenance is info.
- The message shows the monitor name, URL, status message, and ping time; a recovery also shows how long the monitor was down, using the hub's state tracking.
- Turn on Apply on all existing monitors so every monitor reports through the one source.
- As with every adapter, a real payload from your install is saved as a fixture before the mapping is written.

**Health-check script and contract**

For any service without a built-in adapter, a small script runs checks and POSTs the results in one fixed format, so no new adapter is needed. The built-in `health-check` adapter accepts that format, and the example script sends it.

| Field | Required | Meaning |
| --- | --- | --- |
| `host` | Yes | Machine name, used as the title prefix |
| `check` | Yes | Check name, such as `disk /` or `plex` |
| `status` | Yes | `ok`, `warn`, or `fail` |
| `message` | No | One line of detail |
| `value` | No | A number such as a percentage or milliseconds |
| `unit` | No | Unit for the value |
| `details` | No | Object of extra name and value pairs, shown as embed fields |

Status maps to severity: ok is success (green), warn is warning (amber), fail is error (red). The title reads `host · check`.

**State tracking:** an adapter can return an optional `key` (the health-check adapter uses host plus check). With Only post when status changes on, which is the default for health checks, the hub posts the first result and then only changes, such as fail to ok as a recovery, with the time spent in the previous state. A repeat-reminder interval can be set per source.

**Example script** (`scripts/notify-check.sh`)

```bash
#!/usr/bin/env bash
# notify-check.sh: run checks and report each result to the hub
HUB_URL="${HUB_URL:-http://hub.local:8080/hook/health-vms/YOUR_TOKEN}"
HOST="$(hostname -s)"

# send one result: check name, status (ok|warn|fail), message, optional value and unit
report() {
  local check="$1" status="$2" message="$3" value="${4:-null}" unit="${5:-}"
  jq -n --arg host "$HOST" --arg check "$check" --arg status "$status" \
        --arg message "$message" --argjson value "$value" --arg unit "$unit" \
        '{host:$host, check:$check, status:$status, message:$message, value:$value, unit:$unit}' |
    curl -fsS -m 10 -X POST "$HUB_URL" -H 'Content-Type: application/json' -d @- >/dev/null ||
    echo "hub unreachable for check: $check" >&2
}

# disk usage on a mount point: warn at 80%, fail at 90%
check_disk() {
  local mount="$1" pct
  pct=$(df --output=pcent "$mount" | tail -1 | tr -dc '0-9')
  if [ "$pct" -ge 90 ]; then report "disk $mount" fail "$mount is at ${pct}%" "$pct" "%"
  elif [ "$pct" -ge 80 ]; then report "disk $mount" warn "$mount is at ${pct}%" "$pct" "%"
  else report "disk $mount" ok "$mount is at ${pct}%" "$pct" "%"
  fi
}

# HTTP endpoint answers with a success code
check_http() {
  local name="$1" url="$2"
  if curl -fsS -m 10 -o /dev/null "$url"; then report "$name" ok "$url responded"
  else report "$name" fail "$url did not respond"
  fi
}

# systemd unit is active
check_service() {
  local unit="$1"
  if systemctl is-active --quiet "$unit"; then report "service $unit" ok "$unit is running"
  else report "service $unit" fail "$unit is not running"
  fi
}

# edit below: list the checks for this machine
check_disk /
check_http "plex" "http://localhost:32400/identity"
check_service docker
```

- Needs `bash`, `curl`, and `jq`.
- The Sources page for a health-check source shows this script with that source's URL and token already filled in, plus a copy button.
- To add a check, write a function that calls `report`, then list it at the bottom.
- Run it every 5 minutes from cron (`*/5 * * * * /opt/notify-check.sh`) or a systemd timer.
- To send a single message from any other script:

```bash
curl -fsS -X POST "$HUB_URL" -H 'Content-Type: application/json' \
  -d '{"host":"nas","check":"backup","status":"ok","message":"Backup finished"}'
```

**Discord-format passthrough:** a `/discord` style endpoint accepts payloads written for Discord webhooks, so services that can only send those still work; the hub reads the embed and restyles it.

**Rule for every adapter:** capture a real payload first, save it as a fixture, and write the test before the mapping. Never build from documentation alone.

## 8. HTTP API and endpoints

Senders only ever touch the ingest endpoint on the LAN listener (port 8080); the tunnel listener serves only the web UI and admin API, and everything except ingest and health requires a login.

**Ingest (called by your services)**

| Method and path | Purpose |
| --- | --- |
| `POST /hook/:sourceId/:token` | Receive a webhook for a source; returns 202 fast, work happens in the queue |
| `POST /hook/:sourceId/:token/discord` | Accept Discord-format payloads and restyle them |
| `GET /health` | Liveness and Discord connection status, no auth |

**Admin API (used by the web UI)**

| Resource | Endpoints |
| --- | --- |
| Setup and session | `POST /api/setup`, `POST /api/login`, `POST /api/logout` |
| Discord | `GET/PUT /api/discord` (token, guild), `POST /api/discord/sync-channels` |
| Sources | `GET/POST /api/sources`, `PATCH/DELETE /api/sources/:id`, `POST /api/sources/:id/rotate-token`, `POST /api/sources/:id/test` |
| Routes | `GET/POST /api/routes`, `PATCH/DELETE /api/routes/:id`, `POST /api/routes/preview` |
| Messages | `GET /api/messages` (filters, paging), `GET /api/messages/:id`, `POST /api/messages/:id/resend` |
| Live feed | `GET /api/stream` (server-sent events) |
| Adapters | `GET /api/adapters`, `POST /api/adapters`, `POST /api/adapters/:id/run-samples` |
| Settings | `GET/PUT /api/settings`, `GET /api/export`, `POST /api/import` |

**Update endpoints:** `GET /api/updates` (status), `POST /api/updates/check`, `POST /api/updates/apply`, `POST /api/updates/rollback`, `PUT /api/updates/settings`.

**Health endpoints:** `GET /health` (public, ok or not ok), `GET /api/health` (per check), `POST /api/health/run` (run all checks now), `PUT /api/health/settings` (alert channel, interval, thresholds, fallback).

**Discarded log endpoints:** `GET /api/discarded` (filters, paging), `DELETE /api/discarded` (clear), `PUT /api/discarded/settings` (retention, blocking threshold, alert threshold).

**Rules**

- Ingest always returns quickly: 202 when stored, 404 for a wrong token or unknown source (the same response, so nothing can be probed), 413 for oversize bodies, 429 for a temporarily blocked address.
- Body size limit of 1 MB by default, configurable.
- Every request body is validated with Zod; invalid admin requests return structured errors the UI can show.

**Tokens and the discarded log**

Every source has its own token, so one leaked or mistyped token only affects that source.

- **Generation:** when you add a source by choosing an adapter, the hub creates a 256-bit random token automatically, builds the full webhook URL, and shows it with a Copy button and the adapter's setup instructions. You never type or invent a token. The New adapter flow ends with the same step, so a new adapter file gets a ready-to-use source and URL.
- **Where it goes:** in the URL path (`/hook/:sourceId/:token`), or in an `X-Hub-Token` header for services that can set headers but not long URLs; either one is enough.
- **Check order:** the token is checked first, before the body is read, parsed, or stored. A request with a wrong or missing token never reaches an adapter, the queue, or the messages table.
- **Discard:** the sender gets a generic 404, identical to the response for an unknown source, so nothing can be probed. The request is recorded in the discarded log and nowhere else.
- **Discarded log:** one row per sender and reason, with a repeat count so a misconfigured service does not flood the table. It keeps first and last seen times, client address, the source tried, the reason (wrong token, missing token, unknown source, or disabled source), user agent, method, content type, and content length. It never stores the body, or the token that was sent beyond its first 4 characters and length, which helps spot a typo.
- **UI:** a Discarded page and a dashboard counter list the entries, with filters, a Clear button, and a link to the source that was tried. Retention is its own setting (default 7 days) with a row cap.
- **Protection:** an address that sends more than a set number of bad requests in 10 minutes (default 20) is blocked for a while and answered with 429 without further logging. Both numbers are settings, and your LAN ranges can be exempted. An optional alert posts to the alert channel when discards spike (default 50 in 10 minutes).
- **Rotation:** Rotate token creates a new token and keeps the old one valid for 10 minutes, so you can update the sender without losing messages.
- **Storage:** tokens are stored encrypted, so the URL can be shown again, and compared in constant time.

## 9. Web UI

The UI is the control plane: eleven pages cover setup, daily monitoring, and every setting, and the log updates live without a refresh.

| Page | What it does |
| --- | --- |
| First-run setup | Create the admin account, paste the bot token, pick the Discord server, sync channels |
| Dashboard | Messages per source today, failure count, queue depth, bot connection status, last message per source, discarded requests today |
| Live log | Streaming table of messages with source, event, destination, status, and time; filters for source, status, severity, and text search |
| Message detail | Tabs for raw payload (headers and body), normalized message, rendered Discord embed preview, delivery attempts and errors, and a resend button |
| Sources | Add a source by choosing a type; generates a token automatically and shows the full webhook URL, a copy button, setup instructions, test-send, enable toggle, rotate token |
| Routing | Table of rules with drag-to-reorder priority, conditions (event, severity, text contains), target channel dropdown, and a rule tester |
| Formatting | Per-source colors, icon, title template, and visible fields, with a live embed preview; adapter-specific options come from the adapter file's config |
| Settings | Discord connection, retention days, body size limit, admin password, export and import, about and version |

**Three more pages:** Adapters (loaded files, status and errors, run samples, New adapter, approve permissions) and Updates (running version, check now, release notes, apply, roll back, auto-update settings), and Discarded (requests rejected for a wrong token or unknown source, with filters, a Clear button, and the retention and blocking settings).

**Behavior**

- Live updates use server-sent events; the log table prepends new rows and highlights failures.
- Errors always show where and why: adapter failed, no route matched, Discord rejected the message, rate limited, bot offline.
- The bot token is never shown after saving; source tokens are masked in lists, with Copy URL and Rotate actions.
- The layout works on a phone, since you will often check it from one.
- Dark mode by default, matching Discord.

## 10. Security

The hub holds your bot token and routing, so it is LAN-first, authenticates every admin action, and keeps secrets encrypted.

| Concern | Approach |
| --- | --- |
| Ingest authentication | Each source has a random token in its URL; stored encrypted and compared in constant time; wrong tokens are discarded and logged; rotatable from the UI with a 10-minute grace period |
| Admin login | Local admin account with an Argon2 password hash and a secure session cookie |
| Remote UI access | Cloudflare Tunnel plus Cloudflare Access in front of a localhost-only UI listener; the hub verifies the Access token on every tunneled request |
| Public exposure | `/hook/*` is not served on the tunnel listener; no inbound ports or port forwarding are used |
| Secrets at rest | Bot token and any API keys encrypted with AES-256-GCM using a key from `APP_SECRET` in the environment |
| Payload redaction | Configurable list of header and field names (authorization, apikey, token, password) masked before storage and display |
| Request limits | Body size cap, per-source rate limit, and a request timeout to blunt abuse or loops |
| Discord token | Bot gets only the permissions it needs: view channel, send messages, embed links |
| Backups | Export file excludes secrets by default; optional encrypted export |

**Added for adapter files and updates**

- Adapter files run in worker threads with time limits and no access to secrets; network use needs your approval per adapter.
- The service runs as an unprivileged user and can write only to its own program and data folders; there is no Docker socket or other elevated access.
- Updates download only from your own repository's releases and are checked against a SHA-256 checksum; a GitHub token, needed only for a private repo, is stored encrypted and read-only.
- Every update takes a database backup first.

**Cloudflare setup notes**

- The tunnel points at the localhost-only UI listener, which has no webhook or health routes; the steps are in section 12.
- The Access policy allows only your email, and the hub verifies the Access token on every tunneled request.
- Nothing is opened on your router, and webhook senders never go through Cloudflare.

## 11. Reliability

No message is silently lost: every request is stored first, delivery is retried, and anything that cannot be delivered stays visible in the log.

| Topic | Design |
| --- | --- |
| Store first | The raw request is written to SQLite before the 202 response is sent |
| Queue | A worker reads queued deliveries in order; the queue survives restarts |
| Retries | Exponential backoff (for example 2s, 10s, 1m, 5m, 30m) up to a set maximum, then status failed |
| Discord rate limits | Per-channel send pacing; honor `retry-after` headers; discord.js handles the bucket details |
| Bursts | A queue with per-channel pacing absorbs bursts; merging them into one embed is a later feature (grouping, item 3 in TODO.md) |
| Bot offline | Messages wait in the queue and send when the bot reconnects; status shown on the dashboard |
| Unrouted messages | Go to a configurable fallback channel, or are logged as unrouted if none is set |
| Adapter errors | Raw payload is kept; a plain-text fallback embed is sent so nothing is lost |
| Loop protection | Ignore payloads the hub itself generated and cap per-source rate |
| Retention | Daily job deletes messages and deliveries older than the retention setting; default 30 days |
| Database care | WAL mode, periodic vacuum, and a nightly backup copy to a mounted folder |
| Monitoring | `/health` endpoint, plus the self-checks and alerts below |

**Self-checks and alerts**

The hub tests itself every minute, and the bot posts an error to Discord when something stops working, then a recovery message when it clears. The bot talks to the backend only through its API, so these checks exercise the same path real messages take.

| Check | How it is tested | Failure means |
| --- | --- | --- |
| Database | Write and read a test row | SQLite locked, disk full, or file damaged |
| Queue worker | Oldest queued item is younger than a set age and the worker ran recently | Worker stuck or crashed |
| Ingest path | The bot sends a silent canary request, using the token of a built-in canary source, to the hub's own ingest endpoint and checks it is stored and routed | Web server, router, or adapter loader broken |
| Discord connection | Gateway is connected and a REST call to `/users/@me` succeeds | Bot offline, token revoked, or a Discord outage |
| Channel access | Bot can view and send in each routed channel, checked on start and hourly | A channel was deleted or permissions changed |
| Adapters | Every adapter file loads and passes its samples | A broken or edited adapter file |
| Tunnel (if enabled) | The cloudflared service is active and reports a connection | Remote access is down; local access is unaffected |

**Rules**

- A check must fail twice in a row before alerting, so a single blip stays quiet.
- Alerts go to a dedicated alert channel set in Settings, as an error embed showing what failed, since when, and the last error text; a recovery embed follows with the downtime.
- Canary messages run the whole pipeline except the final Discord post, and are hidden from the log by default.
- If Discord itself is the problem, the alert cannot be posted there: the UI shows a red banner, the failure is logged, and an optional fallback is used (a plain Discord webhook to another server, ntfy, or email).
- If the whole hub is down, nothing inside it can announce that. Add an external check: an Uptime Kuma HTTP monitor on `/health`, which alerts through its own path, and optionally a push heartbeat from the hub to a Kuma push monitor.
- `/health` returns only ok or not ok without a login; the dashboard shows each check with its last run time and status.
- Because the bot only uses the API, it can later run as a separate process without code changes.

## 12. Deployment

The hub runs natively in a Proxmox LXC as a systemd service, installs with one command, and updates itself from GitHub releases.

**Create the LXC and install**

One command on the Proxmox host creates the container and installs the hub:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/create-lxc.sh)"
```

`scripts/create-lxc.sh` runs on the Proxmox host and does the following:

- Picks the next free container ID (or uses `CTID`) and downloads the Debian 12 template with `pveam` if it is missing.
- Creates an unprivileged container with 1 core, 512 MB RAM, a 4 GB disk, DHCP networking, and start on boot.
- Starts it, then runs `install.sh` inside it with `pct exec`.
- Prints the web address to open.

Defaults can be overridden with environment variables: `CTID`, `HOSTNAME`, `STORAGE`, `BRIDGE`, `CORES`, `MEMORY`, `DISK`.

The same thing by hand, for reference (adjust the template name to what `pveam list local` shows):

```bash
pct create 120 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname notify-hub --cores 1 --memory 512 --swap 256 \
  --rootfs local-lvm:4 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --onboot 1 --start 1
pct exec 120 -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/install.sh)"
```

**Install script**

For an existing Debian or Ubuntu LXC, run this inside it as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/install.sh)"
```

`scripts/install.sh` does the following:

1. Checks it is running as root on Debian or Ubuntu.
2. Installs `curl`, `jq`, `ca-certificates`, `unattended-upgrades`, and the pinned Node.js major version from NodeSource.
3. Creates the `notifyhub` user and the folders shown in the layout below.
4. Downloads the latest GitHub release tarball and checksum, verifies it, and extracts it to `releases/<version>`.
5. Writes `/etc/notify-hub.env` with a generated `APP_SECRET`, readable only by root and the service.
6. Installs `launcher.sh` and the systemd unit, then enables and starts the service.
7. Prints the address to open to finish setup in the browser.

Running it again repairs the install; it never overwrites the data folder or `/etc/notify-hub.env`. A private repository needs a read-only token passed in the curl header (see `README.md`).

**systemd unit**

```ini
[Unit]
Description=Notify Hub
After=network-online.target
Wants=network-online.target

[Service]
User=notifyhub
EnvironmentFile=/etc/notify-hub.env
ExecStart=/opt/notify-hub/launcher.sh
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/notify-hub /var/lib/notify-hub

[Install]
WantedBy=multi-user.target
```

**Environment variables:** `APP_SECRET` (generated by the installer), `PORT` (default 8080, LAN listener), UI\_PORT (default 8081, localhost only, used by the tunnel), `DATA_DIR` (default `/var/lib/notify-hub`), `LOG_LEVEL`.

**Remote access with a Cloudflare Tunnel**

The tunnel is outbound-only: `cloudflared` inside the LXC opens a connection out to Cloudflare, so you open no ports and add no port forwarding. Only the web UI is reachable from outside, behind Cloudflare Access; webhooks from your services, the bot, and health checks all stay on the LAN.

The hub runs two listeners, which keeps the outside path small by design:

| Listener | Address | Serves |
| --- | --- | --- |
| LAN | `0.0.0.0:8080` (`PORT`) | Everything: ingest, health, web UI, admin API |
| Tunnel | `127.0.0.1:8081` (`UI_PORT`) | Web UI and admin API only; the `/hook` and `/health` routes do not exist on it |

**Setup steps**

1. In Cloudflare Zero Trust, open Networks, then Tunnels, create a tunnel, and copy its token.
2. Add a public hostname such as `hub.yourdomain.com` that points to `http://localhost:8081`.
3. In Zero Trust, open Access, then Applications, and add a self-hosted application for that hostname with a policy that allows only your email (one-time PIN or your identity provider).
4. On the LXC, run the tunnel setup script with the token; it adds Cloudflare's apt repository, installs `cloudflared`, and runs it as a systemd service:
5. In the hub under Settings, then Remote access, enter the hostname, your Access team domain, and the application AUD tag, and turn on Require Cloudflare Access.
6. From outside your network, open the hostname and check that the Access login appears, then the hub login, and that `/hook/anything` on that hostname returns 404.

```bash
sudo /opt/notify-hub/current/scripts/setup-tunnel.sh <token>
```

The installer accepts the same token, for example `TUNNEL_TOKEN=<token>` in front of the install command, so the tunnel can be set up in the same step as the install.

**How it stays safe**

- Nothing inbound: no port forwarding and no public IP; the LXC firewall can also drop everything except LAN traffic to port 8080.
- Ingest is not on the tunnel: the tunnel target has no webhook routes at all, so no Cloudflare rule is needed to hide them.
- Every request on the tunnel listener must carry a valid Cloudflare Access token, which the hub verifies against your team domain and AUD tag; anything else is rejected.
- The hub login still applies after Access, giving two layers. An option lets you trust the Access identity and skip the second login for tunneled sessions.
- Cookies are Secure and SameSite when served over HTTPS.
- The live log works through the tunnel: the hub sends a keep-alive comment on the event stream every 15 seconds so idle streams are not closed.
- If the tunnel goes down, the dashboard shows Remote access down, and local access is unaffected. If the token leaks, rotate it in the Cloudflare dashboard.

**Logs, updates, and backups**

- Logs: `journalctl -u notify-hub -f`; status: `systemctl status notify-hub`.
- Updates: the hub updates itself from GitHub releases (section 18); migrations run automatically on start.
- Backups: a nightly Proxmox backup of the whole LXC, plus the hub's own database backups in `/var/lib/notify-hub/backups`.

**Why a native LXC**

Decision: run it natively in an LXC under systemd. That is the one option where the hub can update itself without compose commands, a Docker socket, or an updater container; Docker is the alternative that was weighed and not chosen.

| Concern | Native in an LXC | Docker container |
| --- | --- | --- |
| Auto-update | The hub swaps in a new release folder and restarts itself under systemd, with no outside helper | Needs an updater container with Docker socket access, or Watchtower; the hub cannot replace itself |
| Setup | One install script creates the user, folders, and service | Compose file; Docker inside an LXC needs nesting, and Proxmox recommends a VM for Docker |
| Resources | Lowest: Node and the app | Adds the Docker daemon |
| Reproducible runtime | Depends on the Node version installed in the LXC | Identical everywhere |
| Backup and rollback | Proxmox snapshot or PBS backup of the whole LXC, plus the hub's own backup | Image tags plus a volume backup |
| Security surface | No Docker socket; unprivileged user with systemd hardening | The updater needs the Docker socket, which is root-equivalent |
| Portability | Linux with a compatible Node | Anywhere Docker runs |

**How native self-update works**

1. The release workflow builds a tarball (compiled server, built UI, production dependencies with native modules prebuilt) and a SHA-256 checksum, and attaches both to the GitHub release.
2. The hub finds the new release, downloads both files, and verifies the checksum.
3. It extracts the release to its own folder, backs up SQLite, and writes an update-pending marker.
4. It switches the `current` symlink to the new folder and exits; systemd restarts it on the new code, and migrations run on start.
5. When the new version passes its self-checks for 60 seconds, it removes the marker.
6. If it crashes first, the launcher script that starts the service sees the marker after two failed starts, points `current` back at the previous release, restores the backup, and starts the old version.

```text
/opt/notify-hub/
  current -> releases/v1.2.0
  releases/            last 3 releases kept
  launcher.sh
/var/lib/notify-hub/
  hub.db
  backups/
  adapters/
/etc/notify-hub.env    APP_SECRET, PORT, UI_PORT
```

- **Node:** install a pinned major version from NodeSource; each release declares the Node version it needs, and the updater refuses a release your Node cannot run.
- **Install:** `install.sh` creates the `notifyhub` user, folders, systemd unit, and Node, then fetches the latest release; run it once in a fresh Debian or Ubuntu LXC.
- **Service:** runs as an unprivileged user with `Restart=always` and `ProtectSystem=strict`, with write access only to the two folders above.
- **Patching:** `unattended-upgrades` for the OS and a nightly Proxmox backup of the LXC.
- **Docker mode:** not part of version 1; if you move to Docker later, the hub would only notify about updates unless an updater container is added.

**Decision made:** native LXC under systemd. The repository setup is Step 0 in section 14, and the matching changes are in sections 3, 18, and 20.

## 13. Project structure and conventions

A two-package npm workspace keeps server and UI separate while sharing types, and a `CLAUDE.md` at the root keeps every coding session consistent.

```text
notify-hub/
  CLAUDE.md
  PLAN.md
  README.md
  TODO.md
  docs/            screenshots only
  scripts/           create-lxc.sh, install.sh, setup-tunnel.sh, launcher.sh, notify-check.sh
  adapters/          _template.js, copied to the data folder on first run
  .github/workflows/ ci.yml, release.yml
  package.json
  server/
    src/
      index.ts
      config/
      db/            schema, migrations, queries
      ingest/        routes for /hook, body parsing, auth
      adapters/      built-in adapter files, same format as yours
      core/          standard message types, renderer, router
      queue/         worker, retry, rate pacing
      discord/       bot client, channel sync, sender
      api/           admin routes for the UI
      security/      crypto, sessions, redaction
    test/
      fixtures/      captured payloads per source
  web/
    src/
      pages/
      components/
      lib/
  shared/            Zod schemas and types used by both
```

**Conventions for `CLAUDE.md`**

- TypeScript strict mode; no `any` without a reason.
- Code comments are concise and only describe what the code does; they never mention past changes or history.
- Every adapter has a fixture file and a test before it is considered done.
- All config lives in the database; the only environment variables are the ones listed in the deployment section.
- Never log secrets; run all stored payloads through the redaction function.
- Database changes only through numbered migrations.
- Small commits per task, one phase per branch.
- UI components that render full-page layouts use the entire viewport width with a modest buffer around the content.

* The README is the single documentation file: each topic has a short overview and collapsed sections for the details.

## 14. Build phases

The build runs in ten phases, each ending in something you can run and check; do them in order, one branch per phase.

**Step 0: Set up the GitHub repository**

Do this once, before any code.

1. On GitHub, create a repository named `notify-hub` (private until you want to share it) with a Node `.gitignore`, a README, and a license.
2. Clone it and open it in VS Code (commands below).
3. Add this plan as `PLAN.md` (export the doc as Markdown) and commit it to `main`.
4. Add `.env` and `data/` to `.gitignore`; the bot token and `APP_SECRET` are never committed.
5. In the repository settings, under Actions, then General, set workflow permissions to Read and write, so the release workflow can attach files to releases.
6. Optional for a solo project: protect `main` so changes go through a pull request with passing CI, and work each phase on its own branch (`phase-0`, `phase-1`, and so on).
7. Private repository only: the installer and the hub's update checks need a fine-grained personal access token with read-only access to Contents. Create it later, at the Phase 0 task just before the install scripts, not now.
8. On your computer, install Git, Node.js 22 LTS, VS Code, and the Claude Code extension.

```bash
git clone https://github.com/Pdiddy973/notify-hub.git
cd notify-hub
code .
```

To publish a release later, push a version tag; the release workflow then builds the tarball and checksum and attaches them to a GitHub release.

```bash
git tag v0.1.0
git push origin v0.1.0
```

- Done when: the repository is cloned, `PLAN.md` is on `main`, and Actions is enabled.

**Phase 0: Foundation**

- [x] README with the overview, quick start, and section skeleton (section 20)

* [x] Create the repo, npm workspace, TypeScript config, lint, and Vitest
* [x] Add `CLAUDE.md` with the conventions above and this plan as `PLAN.md`
* [x] Empty Fastify server with `/health`

- [x] CI workflow that runs lint and tests on every push
- [x] Release workflow that builds the tarball and checksum when a version tag is pushed
- [x] Private repository only: create a fine-grained personal access token (repository `notify-hub`, Contents read-only) for the installer and update checks; keep it out of git (not needed: the repository is public)
- [x] `scripts/create-lxc.sh`, `scripts/install.sh`, and `launcher.sh` that install a tagged release into a fresh LXC

* Done when: `npm run dev` serves `/health`, CI passes, and a tagged release installs into a fresh LXC with one command and serves `/health`.

**Phase 1: Core pipeline**

- [x] SQLite schema and migrations for all tables in section 5
- [x] Ingest endpoint with token check, discarded log for wrong tokens, raw storage, and 202 response
- [x] Standard message type, embed renderer, and truncation rules
- [x] Discord bot login, channel sync, and a sender with a basic queue worker
- [x] Temporary seed script for one source and one route

* Done when: a `curl` POST to the hook shows up as a styled embed in the chosen channel and appears in the database.

**Phase 2: Web UI shell and live log**

- [x] Admin login and first-run setup flow with token entry
- [x] Live log page with filters and message detail (raw, normalized, embed preview, errors)
- [x] Server-sent events feed

* Done when: you can set up from a fresh database in the browser and watch test messages arrive live.

**Phase 3: Sources and routing in the UI**

- [ ] Sources page: add (token generated automatically), edit, disable, rotate token, copy URL, test-send
- [ ] Routing page with rule priority, conditions, and the rule tester
- [ ] Unrouted fallback channel setting

* [ ] Discarded page and dashboard counter, with retention, address blocking, and spike alert settings

- Done when: no seed script is needed and every setting is changed through the UI.

**Phase 4: First adapters**

- [ ] Adapter file format, the commented \_template.js, loader with hot reload, validation, and sample runner; built-in adapters use it too

* [ ] Capture real payloads from Sonarr, Radarr, and Prowlarr and save as fixtures
* [ ] Adapters with tests for grab, import, upgrade, health, and test events
* [ ] Setup help text shown on each source page

- Done when: real events from your three apps produce correct embeds.

**Phase 5: More adapters**

- [ ] Uptime Kuma adapter, with a fixture captured from your install

* [ ] Plex (multipart) with play, stop, and new-library events
* [ ] Proxmox with a recommended body template
* [ ] SABnzbd notification script
* [ ] Health-check adapter with state tracking, the JSON contract, the README health-check section, and the notify-check.sh example script, plus a sample `curl` script
* [ ] Dockhand, after checking what it can send

- Done when: every service on your list sends through the hub.

**Phase 6: Formatting and adapter tools**

- [ ] Per-source style editor with live preview
- [ ] Adapter scaffold script, New adapter button, README adapter guide, and per-adapter config forms in the UI
- [ ] Discord-format passthrough endpoint

* Done when: a brand-new service can be added by dropping in one adapter file, with no changes to the hub code.

**Phase 7: Hardening**

- [ ] README screenshots and a final read-through so the setup steps are still accurate

* [ ] Retry and backoff tuning, rate-limit pacing, and a 200-message burst test
* [ ] Payload redaction list, retention job, backups, export and import
* [ ] Localhost-only UI listener, scripts/setup-tunnel.sh, Cloudflare Access token check, the Remote access settings page, and UI polish for mobile

- [ ] Self-checks with canary, alert channel, recovery messages, fallback notice, and an external Uptime Kuma monitor on `/health`

* Done when: a 200-message burst delivers completely and a bot restart loses nothing.

**Phase 8: Automatic updates**

- [ ] Release checker with stable and pre-release channels, plus the Updates page
- [ ] In-app update: download, checksum check, extract, backup, symlink switch, restart
- [ ] `launcher.sh` rollback after failed starts, tested with a deliberately broken release
- [ ] Maintenance window, pause-when-busy, Node version check, and a Discord notice of each result

* Done when: tagging a new release updates a test LXC by itself, and a deliberately broken release rolls back.

**Phase 9: Cutover and later features**

- [ ] Run alongside Notifiarr, then switch each service over (see the cutover plan)
- [ ] Optional: pick features from section 19

## 15. Notifiarr cutover and testing

Switch services over one at a time while Notifiarr keeps running, so a bad adapter never leaves you without alerts.

**Cutover steps**

1. Build a test Discord channel per source (or one `#hub-test`) and route the hub there first.
2. Add each service's hub webhook as a second connection, leaving the Notifiarr one enabled.
3. Compare messages for a few days: same events arrive, nothing missing, formatting acceptable.
4. Move the route to the real channel and disable the Notifiarr connection for that service.
5. When all services are moved, keep Notifiarr installed but idle for a week, then remove the notification setup.

If you use Notifiarr's TRaSH sync or library reports, leave those running; this project does not replace them.

**Testing plan**

| Level | What is tested |
| --- | --- |
| Unit | Each adapter against its fixtures; renderer truncation; redaction; routing rule matching |
| Integration | Ingest to queue to a mocked Discord sender; retry and backoff; restart recovery |
| End to end | Real test channel; send every event type from each service's Test button |
| Load | Burst of 200 messages from one source; confirm order, pacing, and no loss |
| Failure | Wrong token (discarded and logged), oversize body, malformed JSON, bot offline, Discord 429 and 5xx responses |
| Security | Unauthenticated access to every admin route is rejected; requests with a wrong token never reach the queue; secrets absent from logs and exports |

## 16. Open questions and risks

Several facts should be confirmed before Phase 5, and most risks come from adapters and Discord limits rather than architecture.

**Open questions**

- [x] Plex Pass: confirmed, so Plex webhooks are available.
- [x] Where to run it: native LXC under systemd (decided).
- [x] Senders: all on the LAN, and ingest is never exposed outside (decided).
- [ ] What can Dockhand send (webhook, Apprise, script)? Check its notification settings before building its adapter.
- [ ] Which SABnzbd version do you run, and does it offer Apprise or only notification scripts?
- [ ] One Discord server or several? One guild is assumed.
- [ ] Should any messages ping roles or users, and should that be a routing option?
- [ ] Which domain and email should the tunnel hostname and Access policy use, and is Cloudflare Zero Trust already set up?

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Payloads differ between app versions | An adapter silently misses fields | Fixtures from your real versions; unknown fields fall back to a raw field list |
| Discord rate limits | Delayed or dropped messages in bursts | Queue with per-channel pacing; grouping bursts comes later |
| Bot token leaks | Full control of the bot | Encrypted at rest, masked in UI, regenerate from the Discord developer portal if exposed |
| Single point of failure | All alerts stop if the hub is down | Health check, systemd restart, and an Uptime Kuma monitor on /health from a separate service |
| Scope growth | Project never reaches usable | Phases end in working states; extra features such as commands wait until after cutover |
| Alert loops | Hub alert triggers another alert | Loop protection and per-source rate limits |
| Wrong or guessed tokens | Forged messages or a flooded log | 256-bit random tokens, constant-time check, identical 404 responses, the discarded log, and temporary address blocking |
| Lost APP\_SECRET | Encrypted secrets cannot be read after a restore | The env file is inside the LXC backup; keep a copy in your password manager |

## 17. VS Code and Claude workflow

Export this doc as Markdown and save it as `PLAN.md` in the repo root, then work one phase at a time with Claude Code in VS Code so every session starts with the full context.

**Setup**

1. Complete Step 0 in section 14 first, then in the cloned repo in VS Code add `PLAN.md` from this doc.
2. Create `CLAUDE.md` containing the conventions from section 13 and one line: "Read PLAN.md before starting any task."
3. Start a new Claude Code session per phase, so context stays small and focused.
4. Review the diff and run the tests before committing each task.

**Kickoff prompts**

```text
Phase 0:
Read PLAN.md. Complete Phase 0 only. Set up the npm workspace with server, web,
and shared packages, TypeScript strict mode, lint, Vitest, a CI workflow, a release
workflow that builds the tarball, and scripts/install.sh. Add a Fastify /health endpoint. Stop when the Phase 0 done-when
condition is met and list what you created.
```

```text
Phase 1:
Read PLAN.md sections 5, 6, 8, and 11. Complete Phase 1 only. Create the SQLite
schema with Drizzle migrations, the ingest endpoint, the standard message type,
the embed renderer, the Discord bot sender, and the queue worker. Add unit tests
for the renderer and an integration test for ingest to a mocked sender.
```

```text
Adapter phases (4 and 5):
Read PLAN.md section 7. I have saved real payloads for <service> in
server/test/fixtures/<service>/. Write the adapter and its tests against those
fixtures only. Do not invent fields that are not in the fixtures.
```

**Tips**

- Keep each prompt to one phase, and ask Claude to stop and summarize at the done-when condition.
- For adapters, paste a real captured payload into the fixtures folder first; this is the single biggest quality lever.
- Ask Claude to update the checkboxes in `PLAN.md` as tasks finish, so the file always shows progress.
- Keep the bot token and `APP_SECRET` in a local `.env` that is git-ignored.

## 18. Automatic updates from GitHub

The hub checks your GitHub repository for new releases, shows them in the UI, and can apply them on its own, with a backup first and automatic rollback if the new version does not start. Folder layout and the launcher are in section 12.

**How it works**

1. You push a version tag such as `v1.2.0`; a GitHub Actions workflow builds the release tarball and a SHA-256 checksum and attaches both to the GitHub release.
2. The hub calls the GitHub Releases API on a schedule (default every 6 hours) and compares the latest tag with its running version.
3. The Updates page shows the new version and its release notes, with Apply now, Skip this version, or automatic apply.
4. To apply, the hub downloads the tarball, verifies the checksum, extracts it to a new release folder, backs up SQLite, and writes an update-pending marker.
5. It switches the `current` symlink and exits; systemd restarts it on the new code, and migrations run.
6. After 60 seconds of passing self-checks the new version removes the marker. If it fails to start twice, the launcher switches back to the previous release, restores the backup, and the result appears in the UI and in Discord.

**Settings on the Updates page**

| Setting | Choices |
| --- | --- |
| Channel | Stable releases only, or include pre-releases |
| Mode | Notify only, or apply automatically |
| Maintenance window | Only apply between set hours, for example overnight |
| Pause when busy | Wait until the queue is empty |
| Pin version | Stay on a chosen version and ignore newer ones |
| Notifications | Post update results to a Discord channel |

**Rules**

- Releases that contain a database migration are marked "includes database changes" and apply only inside the maintenance window.
- Your data folder (`/var/lib/notify-hub`), including adapter files, is never touched; built-in adapters ship inside the release.
- Updates download only from your own repository's releases and must match the checksum.
- A release that needs a newer Node.js than the one installed is shown but not applied, and the notice says which version to install.
- A private repository needs a read-only fine-grained GitHub token, stored encrypted in settings.
- The last 3 releases and last 3 database backups are kept for rollback.

**Options considered**

| Option | Verdict |
| --- | --- |
| Hub updates itself under systemd in an LXC | Chosen: no outside helper, rollback by switching a symlink |
| Docker image with an updater container | Not used: needs the Docker socket, which is root-equivalent |
| Watchtower | Not used: no release notes, backup, or in-app status |
| Git pull and build on the LXC | Avoid: needs build tools and can leave a half-built app |

**Open questions for updates**

- [x] Is the GitHub repository public or private? Public.
- [ ] Notify only at first, or apply automatically from day one?
- [ ] What maintenance window suits you?

## 19. Recommended extra features

Start with heartbeats, grouping, snooze, and phone push, because they fix the common failures of any notification system: silence, noise, and missed alerts.

| Feature | What it does | Effort | Value |
| --- | --- | --- | --- |
| Heartbeat monitoring | Expects a message from a source every set interval and alerts if it goes silent; ideal for VM health checks and backups, since a dead machine sends nothing | Low | High |
| Grouping and digests | Merges bursts, like a 20-episode Sonarr import, into one embed, with an optional daily summary | Medium | High |
| Mute and snooze | Silences a source or rule for an hour or a day, from the UI first and a slash command later | Low | High |
| Phone push for critical alerts | Extra outputs to ntfy, Pushover, or Telegram so errors reach you if Discord goes unread | Medium | High |
| Deduplication | Collapses identical repeated alerts into one message with a count | Medium | High |
| Quiet hours and severity rules | Holds info messages overnight, always delivers errors, and mentions a role on critical | Low | Medium |
| Slash commands and buttons | `/status`, `/mute`, `/last`, plus buttons such as Retry search or Open in Sonarr | Medium | Medium |
| Status message updated in place | One message per host that shows its current state, edited instead of reposted | Medium | Medium |
| Acknowledge and escalate | An Ack button, with a re-ping if an error stays unacknowledged | Medium | Medium |
| Multiple outputs and forwarding | Sends one message to several destinations or forwards it to another webhook or email | Medium | Medium |
| Home Assistant link | Receives Home Assistant events as a source and sends hub events back through a webhook or MQTT | Medium | Medium |
| Message templates | Per-route templates for titles and fields | Low | Medium |
| Metrics endpoint | Prometheus `/metrics` with counts per source, failures, and queue depth for Grafana | Low | Medium |
| `notify` command-line helper | Sends a message from any script, for example `notify send --source backups --severity error "Backup failed"` | Low | Medium |
| Configuration in git | Exports sources and routes as files you can version and restore | Low | Medium |
| Daily or weekly report | Counts and failures per source in one summary | Low | Low |
| Users, roles, and audit log | Several logins and a record of who changed what | Medium | Low for a single user |

**Suggested order after cutover:** heartbeats, then mute and snooze, then grouping, then phone push, then slash commands.

Each feature has a short scope, a done-when condition, and a ready-to-paste Claude prompt in `TODO.md` at the repo root.

## 20. README for the GitHub repo

The repo has one `README.md` that documents everything. Each topic has a short plain-language overview, then collapsed sections for the details, one per aspect such as what it does, install or setup, and configuration.

**Rules**

- One file: there is no separate `ADAPTERS.md` or `docs/` pages; the `docs/` folder holds only screenshots.
- The top of the file stays short: description, screenshot, contents links, and a three-step quick start with the Proxmox install command.
- Every topic follows the same pattern: an overview paragraph, then collapsed `<details>` blocks.
- Plain language, no marketing; commands use `<you>` as the placeholder until you give your GitHub username.
- It is written in Phase 0 as a skeleton, filled in as each phase finishes, and read through in the final hardening pass.

**Outline**

| Topic | Collapsed sections inside |
| --- | --- |
| Install | What it does; Install commands; Folders and service; Configuration; Repair and uninstall |
| Sources and tokens | What it does; Add a source; Tokens and the discarded log; Rotate a token |
| Adapters | What it does; Included adapters; Write your own; Adapter fields; Testing and safety; Writing with Claude; Uptime Kuma setup; Health-check script and contract; Discord-format passthrough |
| Routing and formatting | Routing rules; Message format; Embed layout and severity colors |
| Web UI | Pages; Behavior |
| Reliability and self-checks | Queue and retries; Retention and backups; Self-checks; If the whole hub is down |
| Remote access | What it does; Set up the tunnel; How it stays safe |
| Updates | How it works; Settings; Safety rules |
| Security | Summary |
| API reference | Ingest; Admin API |
| Moving from Notifiarr | Cutover steps |
| Development | Repository layout; Run and test; Conventions; Releases |
| Roadmap | Link to `TODO.md` |

The finished `README.md` was delivered as a file and is the starting point. Its license line says MIT as a placeholder, so pick the license you want before publishing.
