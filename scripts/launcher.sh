#!/usr/bin/env bash
# launcher.sh: starts the current release of Notify Hub. systemd runs it as the
# notifyhub user with the variables from /etc/notify-hub.env.
set -euo pipefail

app_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
cd "$app_dir/current"
exec node server/dist/index.js
