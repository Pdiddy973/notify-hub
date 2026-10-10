#!/usr/bin/env bash
# create-lxc.sh: creates a Debian 12 LXC on a Proxmox host and installs Notify Hub in it.
# Run as root on the Proxmox host.
#
# Optional variables:
#   CTID              container ID (default: next free ID)
#   HOSTNAME          container hostname (default notify-hub)
#   STORAGE           storage for the root disk (default local-lvm)
#   BRIDGE            network bridge (default vmbr0)
#   CORES             CPU cores (default 1)
#   MEMORY            RAM in MB (default 512)
#   DISK              disk size in GB (default 4)
#   TEMPLATE_STORAGE  storage that holds container templates (default local)
#   REPO, VERSION, GITHUB_TOKEN  passed to install.sh (see that script)
set -euo pipefail

REPO="${REPO:-Pdiddy973/notify-hub}"
VERSION="${VERSION:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# bash sets HOSTNAME to this host's own name when it is not exported, so that value counts as unset.
ct_hostname="${HOSTNAME:-}"
if [[ "$ct_hostname" == "$(hostname)" ]]; then ct_hostname=""; fi
ct_hostname="${ct_hostname:-notify-hub}"
storage="${STORAGE:-local-lvm}"
bridge="${BRIDGE:-vmbr0}"
cores="${CORES:-1}"
memory="${MEMORY:-512}"
disk="${DISK:-4}"
template_storage="${TEMPLATE_STORAGE:-local}"

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

[[ $EUID -eq 0 ]] || die "run this as root on the Proxmox host"
command -v pct >/dev/null || die "pct not found; run this on a Proxmox VE host"

ctid="${CTID:-$(pvesh get /cluster/nextid)}"
if pct status "$ctid" &>/dev/null; then die "container $ctid already exists"; fi

log "Fetching install.sh from $REPO"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
installer="$work_dir/install.sh"
{
  printf 'export REPO=%q VERSION=%q GITHUB_TOKEN=%q\n' "$REPO" "$VERSION" "$GITHUB_TOKEN"
  github "https://api.github.com/repos/$REPO/contents/scripts/install.sh?ref=${VERSION:-main}" \
    -H "Accept: application/vnd.github.raw+json"
} >"$installer" || die "could not download install.sh (for a private repository, set GITHUB_TOKEN)"
chmod 600 "$installer"

log "Finding the Debian 12 template"
pveam update >/dev/null
template="$(pveam available --section system | awk '$2 ~ /^debian-12-standard_/ {print $2}' | sort -V | tail -n 1)"
[[ -n "$template" ]] || die "no debian-12-standard template is available"
if ! pveam list "$template_storage" | grep -q "$template"; then
  log "Downloading $template"
  pveam download "$template_storage" "$template" >/dev/null
fi

log "Creating container $ctid ($ct_hostname)"
pct create "$ctid" "$template_storage:vztmpl/$template" \
  --hostname "$ct_hostname" --ostype debian \
  --cores "$cores" --memory "$memory" --swap 256 \
  --rootfs "$storage:$disk" --net0 "name=eth0,bridge=$bridge,ip=dhcp" \
  --unprivileged 1 --features nesting=1 --onboot 1
pct start "$ctid"

log "Waiting for the network"
ip=""
for _ in $(seq 1 60); do
  ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -n "$ip" ]]; then break; fi
  sleep 1
done
[[ -n "$ip" ]] || die "container $ctid did not get an IP address"

log "Running install.sh inside container $ctid"
pct push "$ctid" "$installer" /root/notify-hub-install.sh --perms 0600
status=0
pct exec "$ctid" -- bash /root/notify-hub-install.sh || status=$?
pct exec "$ctid" -- rm -f /root/notify-hub-install.sh
[[ $status -eq 0 ]] || die "install.sh failed inside container $ctid (exit $status)"

log "Done. Container $ctid is serving Notify Hub at http://$ip:8080"
