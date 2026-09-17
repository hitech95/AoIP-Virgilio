#!/usr/bin/env bash
# Build the webui frontend from the vendored OUI (deps/oui) + our custom
# apps (br-external/package/webui/src/), into $1 (staging root):
#   $1/ui/         shell dist (index.html + assets, gzipped)
#   $1/ui/views/   per-app UMD bundles (login, layout, home, status, ...)
#   $1/menu.d/     merged menu.json files (read by webuid's ui.get_menus)
#
# Node comes from the host (OUI's CONFIG_OUI_USE_HOST_NODE model): this is
# a host build tool, nothing node-shaped ships in the image. Requires
# network for `npm install` (same precedent as the camilladsp cargo build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUI="${ROOT}/deps/oui"
SRC="${ROOT}/br-external/package/webui/src"
PATCHES="${ROOT}/br-external/package/webui/patches"
OUT="${1:?usage: build-frontend.sh <staging-dir>}"

command -v node >/dev/null || { echo "node not found in PATH" >&2; exit 1; }
NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "${NODE_MAJOR}" -ge 18 ] || { echo "node >= 18 required (found $(node -v))" >&2; exit 1; }

WORK="$(mktemp -d /tmp/webui-fe.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

# --- sources: shell + upstream apps we ship + our apps --------------------
# login + home are OUR apps (firstboot flow, LAN dashboard): OUI's are not
# shipped. layout stays upstream.
mkdir -p "${WORK}/applications"
cp -a "${OUI}/oui-ui-core" "${WORK}/"
for app in oui-app-layout; do
	cp -a "${OUI}/applications/${app}" "${WORK}/applications/"
done
cp -a "${SRC}"/* "${WORK}/applications/"
rm -rf "${WORK}"/applications/*/htdoc/node_modules

# --- apply our patches against the pinned OUI rev -------------------------
for p in "${PATCHES}"/*.patch; do
	[ -e "$p" ] || continue
	echo "applying $(basename "$p")"
	patch -d "${WORK}" -Np1 --fuzz=0 < "$p"
done

build_app() { # <dir> <VITE_APP_NAME>
	local dir="$1" name="$2"
	echo "=== building app: ${name}"
	echo "VITE_APP_NAME=${name}" > "${dir}/.env.local"
	npm --prefix "${dir}" install --no-audit --no-fund >/dev/null
	npm --prefix "${dir}" run build >/dev/null
}

export HOME="${HOME:-$(mktemp -d)}"

# --- shell ----------------------------------------------------------------
build_app "${WORK}/oui-ui-core/htdoc" ui-core
mkdir -p "${OUT}/ui"
cp -a "${WORK}/oui-ui-core/htdoc/dist/." "${OUT}/ui/"

# --- skin (fonts etc): injected into index.html, ships beside the dist ----
SKIN="${ROOT}/br-external/package/webui/files/skin.css"
if [ -f "${SKIN}" ]; then
	cp "${SKIN}" "${OUT}/ui/skin.css"
	sed -i 's|</head>|<link rel="stylesheet" href="/skin.css"></head>|' \
		"${OUT}/ui/index.html"
fi

# --- shell menu (top-level entries with icons) ----------------------------
mkdir -p "${OUT}/menu.d"
cp "${OUI}/oui-ui-core/files/menu.json" "${OUT}/menu.d/00-core.json"

# --- apps: UMD bundles -> ui/views/, menus -> menu.d/ ----------------------
mkdir -p "${OUT}/ui/views"
for appdir in "${WORK}/applications"/*; do
	[ -d "${appdir}/htdoc" ] || continue
	# view names strip BOTH vendor prefixes (OUI: APP_NAME:=home etc.)
	name="$(basename "${appdir}" | sed 's/^oui-app-//; s/^webui-app-//')"
	build_app "${appdir}/htdoc" "${name}"
	cp -a "${appdir}/htdoc/dist/." "${OUT}/ui/views/"
	if [ -f "${appdir}/files/menu.json" ]; then
		cp "${appdir}/files/menu.json" "${OUT}/menu.d/${name}.json"
	fi
done

echo "=== frontend staged in ${OUT}:"
find "${OUT}" -type f | sed "s|${OUT}/||" | sort | head -30
