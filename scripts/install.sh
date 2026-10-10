#!/usr/bin/env bash
# install.sh: installs or repairs Notify Hub in a Debian or Ubuntu LXC. Run as root.
# Running it again reinstalls the release and service; the data folder and
# /etc/notify-hub.env are never overwritten.
#
# Optional variables:
#   REPO          GitHub repository (default Pdiddy973/notify-hub)
#   VERSION       release tag to install, such as v0.1.0 (default: latest release)
#   GITHUB_TOKEN  read-only fine-grained token, required for a private repository
set -euo pipefail

REPO="${REPO:-Pdiddy973/notify-hub}"
VERSION="${VERSION:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

NODE_MAJOR=22
SERVICE_USER=notifyhub
APP_DIR=/opt/notify-hub
DATA_DIR=/var/lib/notify-hub
ENV_FILE=/etc/notify-hub.env
UNIT_FILE=/etc/systemd/system/notify-hub.service
KEEP_RELEASES=3

TAG=""
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Calls the GitHub API, with the token when one is set; extra arguments go to curl.
github() {
  local url="$1"
  shift
  local auth=()
  if [[ -n "$GITHUB_TOKEN" ]]; then auth=(-H "Authorization: Bearer $GITHUB_TOKEN"); fi
  curl -fsSL -H "X-GitHub-Api-Version: 2022-11-28" "${auth[@]}" "$@" "$url"
}

check_system() {
  [[ $EUID -eq 0 ]] || die "run this as root"
  [[ -r /etc/os-release ]] || die "cannot read /etc/os-release"
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == debian || "${ID:-}" == ubuntu ]] || die "needs Debian or Ubuntu, found ${ID:-unknown}"
  command -v systemctl >/dev/null || die "needs systemd"
}

install_packages() {
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl jq ca-certificates gnupg unattended-upgrades >/dev/null
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

install_node() {
  if command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" == "$NODE_MAJOR" ]]; then
    log "Node.js $(node -v) is already installed"
    return
  fi
  log "Installing Node.js $NODE_MAJOR from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  log "Installed Node.js $(node -v)"
}

create_user_and_folders() {
  if ! id "$SERVICE_USER" &>/dev/null; then
    log "Creating the $SERVICE_USER user"
    useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$APP_DIR" "$APP_DIR/releases"
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/backups" "$DATA_DIR/adapters"
}

# Downloads the release tarball and checksum, verifies them, and extracts to releases/<tag>.
install_release() {
  local api="https://api.github.com/repos/$REPO/releases" release
  if [[ -n "$VERSION" ]]; then
    release="$(github "$api/tags/$VERSION")" || die "release $VERSION not found in $REPO"
  else
    release="$(github "$api/latest")" ||
      die "no release found in $REPO (for a private repository, set GITHUB_TOKEN)"
  fi
  TAG="$(jq -r '.tag_name' <<<"$release")"
  log "Downloading release $TAG"

  local name="notify-hub-$TAG.tar.gz" file url
  for file in "$name" "$name.sha256"; do
    url="$(jq -r --arg name "$file" '.assets[] | select(.name == $name) | .url' <<<"$release")"
    [[ -n "$url" ]] || die "release $TAG has no file named $file"
    github "$url" -H "Accept: application/octet-stream" -o "$WORK_DIR/$file"
  done
  (cd "$WORK_DIR" && sha256sum --check --quiet "$name.sha256") || die "checksum mismatch for $name"

  local target="$APP_DIR/releases/$TAG"
  rm -rf "$target.partial"
  mkdir -p "$target.partial"
  tar -xzf "$WORK_DIR/$name" -C "$target.partial"
  rm -rf "$target"
  mv "$target.partial" "$target"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$target"
  ln -sfn "releases/$TAG" "$APP_DIR/current"
  chown -h "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/current"
}

# Keeps the newest releases and always the current one.
prune_releases() {
  local current dir
  current="$(readlink "$APP_DIR/current")"
  find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn | tail -n +$((KEEP_RELEASES + 1)) | cut -d' ' -f2- |
    while read -r dir; do
      if [[ "releases/$(basename "$dir")" != "$current" ]]; then rm -rf "$dir"; fi
    done
}

write_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Keeping the existing $ENV_FILE"
    return
  fi
  log "Writing $ENV_FILE with a new APP_SECRET"
  install -m 0640 -o root -g "$SERVICE_USER" /dev/null "$ENV_FILE"
  cat >"$ENV_FILE" <<EOF
APP_SECRET=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
PORT=8080
UI_PORT=8081
DATA_DIR=$DATA_DIR
LOG_LEVEL=info
EOF
}

install_service() {
  log "Installing the launcher and systemd service"
  install -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR/current/scripts/launcher.sh" "$APP_DIR/launcher.sh"
  cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Notify Hub
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/launcher.sh
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR $DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --quiet notify-hub
  systemctl restart notify-hub
}

wait_for_health() {
  local port ip
  port="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
  port="${port:-8080}"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      ip="$(hostname -I | awk '{print $1}')"
      log "Notify Hub $TAG is running at http://$ip:$port"
      return
    fi
    sleep 1
  done
  die "the service did not answer on /health; see: journalctl -u notify-hub -n 50"
}

check_system
install_packages
install_node
create_user_and_folders
install_release
prune_releases
write_env_file
install_service
wait_for_health
