# Notify Hub

Self-hosted webhook router for Discord. Point all your services at one endpoint; the hub gives each one its own token, standardizes every message, and posts it to the right channel through a bot, all managed from a live web UI.

![Live log](docs/live-log.png)

**Contents:** [Quick start](#quick-start) · [Install](#install) · [Sources and tokens](#sources-and-tokens) · [Adapters](#adapters) · [Routing and formatting](#routing-and-formatting) · [Web UI](#web-ui) · [Reliability and self-checks](#reliability-and-self-checks) · [Remote access](#remote-access) · [Updates](#updates) · [Security](#security) · [API reference](#api-reference) · [Moving from Notifiarr](#moving-from-notifiarr) · [Development](#development) · [Roadmap](#roadmap)

## Quick start

1. On the Proxmox host, run the install command (below).
2. Open `http://<lxc-ip>:8080`, enter the setup code the installer printed, create the admin login, paste your Discord bot token, and pick your server.
3. Add a source, choose its adapter, and paste the generated URL into the service.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/create-lxc.sh)"
```

---

## Install

The hub runs natively in a small Debian LXC as a systemd service. One command on the Proxmox host creates the container and installs everything; the same installer also works inside an LXC you already have.

<details>
<summary>What it does</summary>

`scripts/create-lxc.sh` runs on the Proxmox host:

- Picks the next free container ID (or uses `CTID`) and downloads the Debian 12 template with `pveam` if it is missing.
- Creates an unprivileged container with 1 core, 512 MB RAM, a 4 GB disk, DHCP networking, and start on boot.
- Starts it, runs `install.sh` inside, and prints the web address.

`scripts/install.sh` runs inside the LXC as root:

1. Checks for Debian or Ubuntu.
2. Installs `curl`, `jq`, `ca-certificates`, `unattended-upgrades`, and the pinned Node.js major version from NodeSource.
3. Creates the `notifyhub` user and the folders below.
4. Downloads the latest GitHub release and checksum, verifies it, and extracts it.
5. Writes `/etc/notify-hub.env` with a generated `APP_SECRET`.
6. Installs `launcher.sh` and the systemd unit, then starts the service.

</details>

<details>
<summary>Install commands</summary>

On the Proxmox host (creates the LXC and installs the hub):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/create-lxc.sh)"
```

Override the defaults with variables (`CTID`, `HOSTNAME`, `STORAGE`, `BRIDGE`, `CORES`, `MEMORY`, `DISK`):

```bash
CTID=120 STORAGE=local-lvm BRIDGE=vmbr0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/create-lxc.sh)"
```

Inside an existing Debian or Ubuntu LXC, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/install.sh)"
```

The same thing by hand (adjust the template name to what `pveam list local` shows):

```bash
pct create 120 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname notify-hub --cores 1 --memory 512 --swap 256 \
  --rootfs local-lvm:4 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --onboot 1 --start 1
pct exec 120 -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pdiddy973/notify-hub/main/scripts/install.sh)"
```

Private repository: create a fine-grained token limited to this repository with read-only Contents access, export it as `GITHUB_TOKEN`, and pass it in the curl header. The scripts use the same token to download the release.

```bash
export GITHUB_TOKEN=<token>
bash -c "$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw+json" \
  https://api.github.com/repos/Pdiddy973/notify-hub/contents/scripts/create-lxc.sh)"
```

Inside an existing LXC, use the same command with `install.sh` in place of `create-lxc.sh`.

Both scripts also accept `VERSION` (a release tag such as `v0.1.0`; the latest release by default) and `REPO` (`owner/name`).

</details>

<details>
<summary>Folders and service</summary>

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
ProtectHome=true
ReadWritePaths=/opt/notify-hub /var/lib/notify-hub
UMask=0027

[Install]
WantedBy=multi-user.target
```

Logs: `journalctl -u notify-hub -f`. Status: `systemctl status notify-hub`.

</details>

<details>
<summary>Configuration</summary>

Set in `/etc/notify-hub.env`; everything else is configured in the web UI.

| Variable | Purpose |
| --- | --- |
| `APP_SECRET` | Encryption key for stored secrets, generated by the installer (required) |
| `PORT` | LAN listener, default 8080 |
| `UI_PORT` | Localhost-only listener used by the tunnel, default 8081 |
| `DATA_DIR` | Data folder, default `/var/lib/notify-hub` |
| `LOG_LEVEL` | Log verbosity |

Keep a copy of `APP_SECRET` in your password manager; without it, stored secrets cannot be read after a restore.

</details>

<details>
<summary>Repair and uninstall</summary>

Running `install.sh` again repairs the install and never touches the data folder or the env file.

To uninstall:

```bash
systemctl disable --now notify-hub
rm -rf /opt/notify-hub /etc/notify-hub.env /etc/systemd/system/notify-hub.service
userdel notifyhub
```

The data folder `/var/lib/notify-hub` is kept unless you delete it.

</details>

---

## Sources and tokens

A source is one connected service. Each source has its own adapter, its own settings, and its own automatically generated token, so one leaked or mistyped token only affects that source.

<details>
<summary>What it does</summary>

- Gives every service a webhook URL of the form `/hook/<source-id>/<token>`.
- Checks the token before anything else; a request with a wrong token never reaches an adapter, the queue, or the message log.
- Records rejected requests in a separate Discarded log.

</details>

<details>
<summary>Add a source</summary>

1. Open Sources and choose Add source.
2. Pick an adapter. The hub generates a 256-bit random token and builds the full webhook URL.
3. Copy the URL (or the ready-made script for health checks) and paste it into the service, following the setup help shown on the page.
4. Use Test send to confirm a message reaches Discord.

You never type or invent a token. The New adapter flow ends with the same step, so a new adapter file gets a source and URL straight away.

</details>

<details>
<summary>Tokens and the discarded log</summary>

- The token goes in the URL path, or in an `X-Hub-Token` header for services that can set headers but not long URLs.
- A wrong or missing token gets a generic 404, identical to an unknown source, so nothing can be probed.
- The Discarded page lists one row per sender and reason (wrong token, missing token, unknown source, disabled source), with a repeat count, client address, user agent, and the source that was tried. It never stores the body, or the token sent beyond its first 4 characters and length.
- An address that sends more than 20 bad requests in 10 minutes is blocked for a while and answered with 429. Both numbers are settings, and your LAN ranges can be exempted.
- An optional alert posts to the alert channel when discards spike (default 50 in 10 minutes).
- Retention for the Discarded log is its own setting (default 7 days).

</details>

<details>
<summary>Rotate a token</summary>

Rotate token creates a new token and keeps the old one valid for 10 minutes, so you can update the sender without losing messages. Tokens are stored encrypted, so the URL can be shown again from the source page.

</details>

---

## Adapters

An adapter turns one service's raw request into standard messages. Each adapter is a single file, and the built-in ones use the same format as yours.

<details>
<summary>What it does</summary>

- Takes a request body (JSON, form, or text) and returns zero or more standard messages.
- Declares the fields the UI asks for when you add a source of that type.
- Ships sample payloads that are run as tests and by the UI's test button.
- Loads on start and reloads when the file changes; the last working version keeps running if a reload fails.

</details>

<details>
<summary>Included adapters</summary>

| Service | How it sends | Notes |
| --- | --- | --- |
| Sonarr | Settings, Connect, Webhook | Grab, import, upgrade, rename, health, and test events |
| Radarr | Settings, Connect, Webhook | Same as Sonarr with movie fields |
| Prowlarr | Settings, Connect, Webhook | Health and application-update events |
| Plex | Webhooks (needs Plex Pass) | Multipart form with a JSON `payload` field; play, stop, new library item |
| SABnzbd | Notification script or Apprise | A short script posts JSON to the hub |
| Proxmox | Notification target of type webhook | Paste the recommended body template |
| Dockhand | Depends on what it supports | Falls back to an adapter file or the health-check script |
| Uptime Kuma | Notification of type Webhook | Up, down, pending, and maintenance statuses |
| Health-check script | `curl` from any machine | Fixed JSON contract, see below |

</details>

<details>
<summary>Write your own adapter</summary>

Copy `adapters/_template.js` into `/var/lib/notify-hub/adapters/` (or use New adapter in the UI, or `npm run new-adapter <name>`), then change `id`, `name`, and `normalize`. Files starting with an underscore are never loaded.

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

For simple services, a declarative `map` can replace `normalize`:

```js
map: { title: '{{body.event}} on {{body.host}}', severity: { from: 'body.status', values: { up: 'success', down: 'error' } } }
```

</details>

<details>
<summary>Adapter fields</summary>

| Field | Required | Meaning |
| --- | --- | --- |
| `id`, `name` | Yes | Identifier and display name; a file with the same `id` as a built-in overrides it |
| `parse` | Yes | `json`, `form`, or `text` |
| `normalize` or `map` | Yes | Returns an array of standard messages; an empty array ignores the event on purpose |
| `samples` | Yes | Example payloads for tests and the test button |
| `version` | No | Adapter version |
| `config` | No | Fields the UI asks for per source (URLs, options, secrets); values are stored in the database |
| `style` | No | Default icon and colors |
| `help` | No | Setup text on the source page |
| `permissions` | No | `['fetch']` if the adapter needs network access; you approve it in the UI |

Adapters never handle tokens: the hub checks them first.

</details>

<details>
<summary>Testing and safety</summary>

- The hub runs every `samples` entry through `normalize` and shows the resulting embed; a button saves the last received payload as a new sample.
- Syntax errors, bad shapes, and thrown errors show on the Adapters page with the line number.
- Adapters run in a worker thread with a time limit and receive only the request data, never the database or secrets. This is not a hard sandbox, so only use files you wrote or trust.
- Rule for every adapter: capture a real payload first, save it as a fixture, and write the test before the mapping.

</details>

<details>
<summary>Writing adapters with Claude</summary>

Paste a real payload and ask for an adapter that follows `adapters/_template.js` and the fields table above. Save the payload under `samples` first so the result is tested straight away.

</details>

<details>
<summary>Uptime Kuma setup</summary>

In Uptime Kuma, open Settings, Notifications, add a notification of type Webhook, paste the source URL from the hub, choose the JSON content type, and turn on Apply on all existing monitors. Heartbeat status maps to severity: up is success, down is error, pending is warning, maintenance is info. A recovery also shows how long the monitor was down.

</details>

<details>
<summary>Health-check script and contract</summary>

For any machine or service without a built-in adapter, `scripts/notify-check.sh` runs checks and posts the results in one fixed format. The Sources page shows the script with that source's URL and token already filled in.

| Field | Required | Meaning |
| --- | --- | --- |
| `host` | Yes | Machine name, used as the title prefix |
| `check` | Yes | Check name, such as `disk /` or `plex` |
| `status` | Yes | `ok`, `warn`, or `fail` |
| `message` | No | One line of detail |
| `value` | No | A number such as a percentage or milliseconds |
| `unit` | No | Unit for the value |
| `details` | No | Object of extra name and value pairs, shown as embed fields |

Status maps to severity (ok is success, warn is warning, fail is error). With Only post when status changes on, which is the default, the hub posts the first result and then only changes, such as a recovery with the time spent in the previous state.

- Needs `bash`, `curl`, and `jq`.
- To add a check, write a function that calls `report`, then list it at the bottom of the script.
- Run it every 5 minutes from cron: `*/5 * * * * /opt/notify-check.sh`
- To send a single message from any script:

```bash
curl -fsS -X POST "$HUB_URL" -H 'Content-Type: application/json' \
  -d '{"host":"nas","check":"backup","status":"ok","message":"Backup finished"}'
```

</details>

<details>
<summary>Discord-format passthrough</summary>

`POST /hook/<source-id>/<token>/discord` accepts payloads written for Discord webhooks, so services that can only send those still work; the hub reads the embed and restyles it.

</details>

---

## Routing and formatting

Routes decide which Discord channel gets a message, and one renderer gives every message the same look.

<details>
<summary>Routing rules</summary>

- A rule maps a source to a channel, with optional conditions on event type, severity, or text.
- Rules are ordered by priority; drag to reorder. The rule tester shows which rule a sample message would match.
- Channels come from the bot, so targets are dropdowns, not pasted IDs.
- Unrouted messages go to a fallback channel you choose, or are logged as unrouted if none is set.

</details>

<details>
<summary>Message format</summary>

Every adapter outputs one internal shape:

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

Optional `key` identifies what a message is about (for example host plus check) so the hub can track state changes.

</details>

<details>
<summary>Embed layout and severity colors</summary>

| Severity | Meaning | Color |
| --- | --- | --- |
| info | Neutral updates | Blue |
| success | Completed or healthy | Green |
| warning | Needs attention soon | Amber |
| error | Failed or down | Red |
| debug | Verbose or test | Grey |

- Author line: source icon and name. Title and URL from the message; description is the body.
- Up to 10 fields, inline where marked; thumbnail or image when provided.
- Footer: event type, with the received time as the timestamp.
- Discord limits are enforced (title 256, description 4096, 25 fields, 6000 characters in total); overflow is cut with an ellipsis and the full text stays in the log.
- Per-source color map, icon, visible fields, and title template are set on the Formatting page with a live preview.

</details>

---

## Web UI

The UI is the control plane: setup, daily monitoring, and every setting live here, and the log updates live without a refresh. It works on a phone and defaults to dark mode.

<details>
<summary>Pages</summary>

| Page | What it does |
| --- | --- |
| First-run setup | Create the admin account, paste the bot token, pick the server, sync channels |
| Dashboard | Messages per source, failures, queue depth, bot status, last message per source, discarded requests today |
| Live log | Streaming table with filters for source, status, severity, and text |
| Message detail | Raw payload, normalized message, embed preview, delivery attempts and errors, resend |
| Sources | Add a source, copy its URL, setup help, test send, enable, rotate token |
| Routing | Rules, priority, conditions, channel, rule tester |
| Formatting | Per-source colors, icon, title template, visible fields, live preview |
| Adapters | Loaded files, status and errors, run samples, New adapter, approve permissions |
| Updates | Running version, check now, release notes, apply, roll back, settings |
| Discarded | Requests rejected for a wrong token or unknown source, with filters and settings |
| Settings | Discord connection, retention, body size limit, admin password, remote access, export and import |

</details>

<details>
<summary>Behavior</summary>

- Live updates use server-sent events; failures are highlighted.
- Errors always say where and why: adapter failed, no route matched, Discord rejected the message, rate limited, or bot offline.
- The bot token is never shown after saving; source tokens are masked in lists with Copy URL and Rotate actions.

</details>

---

## Reliability and self-checks

No message is silently lost: every valid request is stored first, delivery is retried, and anything that cannot be delivered stays visible in the log. The hub also tests itself every minute and tells you in Discord when something stops working.

<details>
<summary>Queue and retries</summary>

- The raw request is written to SQLite before the 202 response is sent, and the queue survives restarts.
- Retries use exponential backoff (for example 2s, 10s, 1m, 5m, 30m) up to a maximum, then the delivery is marked failed and can be resent from the UI.
- Sends are paced per channel and honor Discord's `retry-after`.
- If the bot is offline, messages wait in the queue and send when it reconnects.
- A broken adapter keeps the raw payload and sends a plain-text fallback embed.

</details>

<details>
<summary>Retention and backups</summary>

- A daily job deletes messages and deliveries older than the retention setting (default 30 days); the Discarded log has its own shorter setting.
- SQLite runs in WAL mode with periodic vacuum and a nightly backup copy in `/var/lib/notify-hub/backups`.
- Also run a nightly Proxmox backup of the whole LXC.

</details>

<details>
<summary>Self-checks</summary>

| Check | How it is tested | Failure means |
| --- | --- | --- |
| Database | Write and read a test row | SQLite locked, disk full, or file damaged |
| Queue worker | Oldest queued item is young enough and the worker ran recently | Worker stuck or crashed |
| Ingest path | A silent canary request through a built-in canary source | Web server, router, or adapter loader broken |
| Discord connection | Gateway connected and a REST call succeeds | Bot offline, token revoked, or a Discord outage |
| Channel access | Bot can view and send in each routed channel | A channel was deleted or permissions changed |
| Adapters | Every adapter file loads and passes its samples | A broken or edited adapter file |
| Tunnel (if enabled) | The `cloudflared` service is active | Remote access is down; local access is unaffected |

- A check must fail twice in a row before alerting.
- Alerts go to a dedicated alert channel as an error embed with what failed, since when, and the last error; a recovery embed follows with the downtime.
- If Discord itself is the problem, the UI shows a red banner and the failure is logged; an optional fallback (a plain Discord webhook to another server, ntfy, or email) can send the alert.
- `GET /health` returns only ok or not ok without a login; the dashboard shows each check.

</details>

<details>
<summary>If the whole hub is down</summary>

Nothing inside the hub can announce that it is down. Add an Uptime Kuma HTTP monitor on `/health`, which alerts through its own path, and optionally a push heartbeat from the hub to a Kuma push monitor.

</details>

---

## Remote access

Nothing from outside needs to reach your network. To open the web UI away from home, a Cloudflare Tunnel makes an outbound-only connection from the LXC to Cloudflare, and only the UI goes through it, behind Cloudflare Access. Webhooks, the bot, and health checks stay on your LAN.

<details>
<summary>What it does</summary>

The hub runs two listeners:

| Listener | Address | Serves |
| --- | --- | --- |
| LAN | `0.0.0.0:8080` (`PORT`) | Everything: ingest, health, web UI, admin API |
| Tunnel | `127.0.0.1:8081` (`UI_PORT`) | Web UI and admin API only; the `/hook` and `/health` routes do not exist on it |

</details>

<details>
<summary>Set up the tunnel</summary>

1. In Cloudflare Zero Trust, open Networks, then Tunnels, create a tunnel, and copy its token.
2. Add a public hostname such as `hub.yourdomain.com` that points to `http://localhost:8081`.
3. Open Access, then Applications, and add a self-hosted application for that hostname with a policy that allows only your email.
4. On the LXC, run the tunnel script with the token:

```bash
sudo /opt/notify-hub/current/scripts/setup-tunnel.sh <token>
```

5. In the hub under Settings, then Remote access, enter the hostname, your Access team domain, and the application AUD tag, and turn on Require Cloudflare Access.
6. From outside your network, open the hostname: the Access login appears, then the hub login, and `/hook/anything` on that hostname returns 404.

The installer accepts the same token as `TUNNEL_TOKEN=<token>` in front of the install command.

</details>

<details>
<summary>How it stays safe</summary>

- No port forwarding and no public IP; the LXC firewall can also drop everything except LAN traffic to port 8080.
- The tunnel target has no webhook routes at all.
- Every request on the tunnel listener must carry a valid Cloudflare Access token, verified against your team domain and AUD tag.
- The hub login still applies after Access; an option lets you trust the Access identity and skip the second login.
- The live log works through the tunnel: the event stream sends a keep-alive every 15 seconds.
- If the token leaks, rotate it in the Cloudflare dashboard.

</details>

---

## Updates

The hub checks your GitHub repository for new releases, shows them in the UI, and can apply them on its own, with a backup first and automatic rollback if the new version does not start.

<details>
<summary>How it works</summary>

1. You push a version tag such as `v1.2.0`; a GitHub Actions workflow builds a release tarball and a SHA-256 checksum and attaches both to the release.
2. The hub checks the GitHub Releases API on a schedule (default every 6 hours).
3. The Updates page shows the new version and its release notes, with Apply now, Skip this version, or automatic apply.
4. To apply, the hub downloads the tarball, verifies the checksum, extracts it to a new release folder, backs up SQLite, and writes an update-pending marker.
5. It switches the `current` symlink and exits; systemd restarts it on the new code and migrations run.
6. After 60 seconds of passing self-checks the marker is removed. If the new version fails to start twice, `launcher.sh` switches back to the previous release and restores the backup, and the result appears in the UI and in Discord.

Publish a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

</details>

<details>
<summary>Settings</summary>

| Setting | Choices |
| --- | --- |
| Channel | Stable releases only, or include pre-releases |
| Mode | Notify only, or apply automatically |
| Maintenance window | Only apply between set hours |
| Pause when busy | Wait until the queue is empty |
| Pin version | Stay on a chosen version |
| Notifications | Post update results to a Discord channel |

</details>

<details>
<summary>Safety rules</summary>

- Releases with a database migration apply only inside the maintenance window.
- Your data folder, including adapter files, is never touched; built-in adapters ship inside the release.
- Updates download only from your own repository's releases and must match the checksum.
- A release that needs a newer Node.js than the one installed is shown but not applied.
- A private repository needs a read-only fine-grained GitHub token, stored encrypted in settings.
- The last 3 releases and 3 database backups are kept for rollback.

</details>

---

## Security

The hub holds your bot token and routing, so it is LAN-first, authenticates every admin action, and keeps secrets encrypted.

<details>
<summary>Summary</summary>

| Concern | Approach |
| --- | --- |
| Ingest authentication | Per-source random token, stored encrypted and compared in constant time; wrong tokens are discarded and logged |
| First-run setup | Creating the admin account needs a one-time code from the hub log (installer output or `journalctl -u notify-hub`), so nobody else on the network, or a website using DNS rebinding, can claim the hub first |
| Admin login | Local account with an Argon2 password hash; HttpOnly, SameSite=Strict session cookie whose id is stored only as a hash; addresses are blocked for 10 minutes after 5 failed logins; changes sent from other sites are refused |
| Remote UI access | Cloudflare Tunnel plus Access in front of a localhost-only listener |
| Public exposure | Nothing inbound; `/hook/*` is not served on the tunnel listener |
| Secrets at rest | AES-256-GCM with a key from `APP_SECRET` |
| Payload redaction | Any header or field whose name contains authorization, cookie, password, passwd, secret, token, apikey, privatekey, or credential is masked before storage |
| Request limits | Body size cap, per-source rate limit, request timeout, address blocking for bad tokens |
| Discord permissions | View channel, send messages, and embed links only |
| Service account | Unprivileged `notifyhub` user with systemd hardening and no Docker socket |
| Exports | Exclude secrets by default |

</details>

---

## API reference

<details>
<summary>Ingest (called by your services)</summary>

| Method and path | Purpose |
| --- | --- |
| `POST /hook/:sourceId/:token` | Receive a webhook; returns 202 fast, work happens in the queue |
| `POST /hook/:sourceId/:token/discord` | Accept Discord-format payloads and restyle them |
| `GET /health` | Ok or not ok, no login |

Responses: 202 stored, 404 for a wrong token or unknown source (the same response), 413 oversize body, 429 temporarily blocked address. The body limit is 1 MB by default.

</details>

<details>
<summary>Admin API (used by the web UI)</summary>

| Resource | Endpoints |
| --- | --- |
| Setup and session | `POST /api/setup`, `POST /api/login`, `POST /api/logout` |
| Discord | `GET/PUT /api/discord`, `POST /api/discord/sync-channels` |
| Sources | `GET/POST /api/sources`, `PATCH/DELETE /api/sources/:id`, `POST /api/sources/:id/rotate-token`, `POST /api/sources/:id/test` |
| Routes | `GET/POST /api/routes`, `PATCH/DELETE /api/routes/:id`, `POST /api/routes/preview` |
| Messages | `GET /api/messages`, `GET /api/messages/:id`, `POST /api/messages/:id/resend` |
| Live feed | `GET /api/stream` (server-sent events) |
| Adapters | `GET /api/adapters`, `POST /api/adapters`, `POST /api/adapters/:id/run-samples` |
| Updates | `GET /api/updates`, `POST /api/updates/check`, `POST /api/updates/apply`, `POST /api/updates/rollback`, `PUT /api/updates/settings` |
| Health | `GET /api/health`, `POST /api/health/run`, `PUT /api/health/settings` |
| Discarded | `GET /api/discarded`, `DELETE /api/discarded`, `PUT /api/discarded/settings` |
| Settings | `GET/PUT /api/settings`, `GET /api/export`, `POST /api/import` |

Every request body is validated; errors come back in a structured form the UI can show.

</details>

---

## Moving from Notifiarr

The hub replaces Notifiarr's notification setup. It does not replace TRaSH Guides sync or library reports, so leave those running if you use them.

<details>
<summary>Cutover steps</summary>

1. Create a test Discord channel (or one `#hub-test`) and route the hub there first.
2. Add each service's hub webhook as a second connection, leaving the Notifiarr one enabled.
3. Compare messages for a few days: same events arrive, nothing missing, formatting acceptable.
4. Move the route to the real channel and disable the Notifiarr connection for that service.
5. When all services are moved, keep Notifiarr installed but idle for a week, then remove the notification setup.

</details>

---

## Development

<details>
<summary>Repository layout</summary>

```text
notify-hub/
  README.md
  CLAUDE.md
  PLAN.md
  TODO.md
  scripts/           create-lxc.sh, install.sh, setup-tunnel.sh, launcher.sh, notify-check.sh
  adapters/          _template.js, copied to the data folder on first run
  .github/workflows/ ci.yml, release.yml
  package.json
  server/
    migrations/      numbered SQL migrations, run on start
    src/
      index.ts
      config/
      db/            schema and queries
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
  docs/              screenshots
```

</details>

<details>
<summary>Run and test</summary>

Copy `.env.example` to `.env` and set `APP_SECRET` (the file shows a command that generates one). The local database goes in `./data`.

```bash
npm install
npm run dev        # hub on http://localhost:8080, restarts on changes
npm run dev:web    # web UI with hot reload on http://localhost:5173, API calls go to the hub
npm test
npm run lint
npm run format     # Prettier
npm run build      # compiles to dist/; npm start runs the build
```

Open the web UI and follow the first-run setup: admin account, bot token, server, and a test channel. After `npm run build`, the hub on port 8080 also serves the built UI. `npm run seed` still exists as a temporary command-line alternative until the Sources page arrives.

Database changes: edit `server/src/db/schema.ts`, then run `npm run db:generate -w @notify-hub/server` to write the next numbered migration into `server/migrations/`. Migrations run when the hub starts.

TypeScript strict mode on Node 22 LTS; Fastify, discord.js v14, SQLite through better-sqlite3 and Drizzle, React with Vite and Tailwind, Zod, pino, and Vitest.

</details>

<details>
<summary>Conventions</summary>

- Every adapter has a fixture file and a test before it is considered done.
- Database changes go through numbered migrations.
- Settings live in the database; the only environment variables are the ones listed under Install.
- Secrets are never logged; stored payloads pass through the redaction function.
- Code comments are concise and only describe what the code does.
- Small commits, one phase per branch.

</details>

<details>
<summary>Releases</summary>

Push a version tag such as `v0.1.0` (a tag with a suffix, such as `v0.2.0-beta.1`, becomes a pre-release). The release workflow runs lint and tests, sets the package version from the tag, builds, installs production dependencies, and attaches `notify-hub-<tag>.tar.gz` and its `.sha256` checksum to a GitHub release. `ci.yml` runs lint, type checks, tests, and shellcheck on every push.

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow needs Read and write workflow permissions (repository Settings, Actions, General).

</details>

---

## Roadmap

Planned features, each with a scope and a done-when condition, are listed in [TODO.md](TODO.md): heartbeat monitoring, mute and snooze, grouping and digests, phone push, deduplication, quiet hours, slash commands and buttons, in-place status messages, acknowledge and escalate, multiple outputs, Home Assistant, templates, metrics, a command-line helper, configuration in git, reports, and multiple users.

## License

MIT
