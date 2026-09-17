#!/usr/bin/env bash
# Watch and live-sync the EQ UMD view into a running slirp QEMU guest.
#
# The firmware image remains untouched: Vite rebuilds the local bundle, a tiny
# host HTTP server exposes dist/, and the guest pulls the new gzip bundle via
# its serial console. Open /dsp/eq?eq-dev=1 to opt into browser auto-reload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${ROOT}/br-external/package/webui/src/webui-app-eq/htdoc"

CONSOLE_PORT="${EQ_QEMU_CONSOLE_PORT:-5557}"
HOST_HTTP_PORT="${EQ_WATCH_HTTP_PORT:-5174}"
GUEST_HOST="${EQ_QEMU_HOST:-10.0.2.2}"
GUEST_VIEW_DIR="/usr/share/webui/ui/views"
ARTIFACT="${APP}/dist/eq.umd.js.gz"
VERSION_FILE="${APP}/dist/eq.version"

for command in node npm python3 nc stat; do
  command -v "${command}" >/dev/null || {
    printf 'missing required command: %s\n' "${command}" >&2
    exit 1
  }
done

if ! nc -z -w 1 127.0.0.1 "${CONSOLE_PORT}"; then
  printf 'QEMU serial console is not reachable on 127.0.0.1:%s\n' "${CONSOLE_PORT}" >&2
  printf 'Start the guest first, for example: ./scripts/run-qemu.sh --console telnet:%s ...\n' "${CONSOLE_PORT}" >&2
  exit 1
fi

if [ ! -d "${APP}/node_modules" ]; then
  printf 'Installing EQ frontend dependencies...\n'
  npm --prefix "${APP}" install --no-audit --no-fund
fi

mkdir -p "${APP}/dist"
printf 'VITE_APP_NAME=eq\n' > "${APP}/.env.local"

SERVER_PID=""
WATCH_PID=""

cleanup() {
  [ -z "${WATCH_PID}" ] || kill "${WATCH_PID}" 2>/dev/null || true
  [ -z "${SERVER_PID}" ] || kill "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python3 -m http.server "${HOST_HTTP_PORT}" --bind 0.0.0.0 --directory "${APP}/dist" \
  >/tmp/eq-watch-http.log 2>&1 &
SERVER_PID=$!

sync_guest() {
  local version
  version="$(date +%s%N)"
  printf '%s\n' "${version}" > "${VERSION_FILE}"

  # BusyBox wget runs in the guest. Slirp exposes the host as 10.0.2.2.
  # Publish atomically: the version marker changes only after the full UMD
  # bundle is in place, so ?eq-dev=1 never reloads into a partial asset.
  {
    printf '\n'
    printf 'wget -q -O %s/.eq.umd.js.gz.new http://%s:%s/eq.umd.js.gz && mv %s/.eq.umd.js.gz.new %s/eq.umd.js.gz && wget -q -O %s/.eq.version.new http://%s:%s/eq.version && mv %s/.eq.version.new %s/eq.version\n' \
      "${GUEST_VIEW_DIR}" "${GUEST_HOST}" "${HOST_HTTP_PORT}" \
      "${GUEST_VIEW_DIR}" "${GUEST_VIEW_DIR}" \
      "${GUEST_VIEW_DIR}" "${GUEST_HOST}" "${HOST_HTTP_PORT}" \
      "${GUEST_VIEW_DIR}" "${GUEST_VIEW_DIR}"
    sleep 1
  } | nc -w 2 127.0.0.1 "${CONSOLE_PORT}" >/dev/null || {
    printf 'Failed to sync the EQ bundle to the guest console.\n' >&2
    return 1
  }

  printf 'Synced EQ bundle to guest; browser reload requested for ?eq-dev=1.\n'
}

printf 'Starting Vite watch build for EQ...\n'
npm --prefix "${APP}" run watch >/tmp/eq-watch-vite.log 2>&1 &
WATCH_PID=$!

last_mtime=""
while kill -0 "${WATCH_PID}" 2>/dev/null; do
  if [ -f "${ARTIFACT}" ]; then
    mtime="$(stat -c '%Y:%s' "${ARTIFACT}")"
    if [ "${mtime}" != "${last_mtime}" ]; then
      sync_guest
      last_mtime="${mtime}"
    fi
  fi
  sleep 0.25
done

wait "${WATCH_PID}"
