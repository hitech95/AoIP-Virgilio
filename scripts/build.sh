#!/usr/bin/env bash
# Build the firmware with Buildroot (see plan/plan.md, M1).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILDROOT="${ROOT}/buildroot"
OUT="${ROOT}/output"

DEFCONFIG="rk3506qemu_defconfig"
JOBS="${JOBS:-$(nproc)}"

# Host shim: Buildroot 2025.02 is incompatible with uutils 'install'
# (Ubuntu >= 25.10). Route through GNU install when needed.
if install --version 2>/dev/null | grep -q uutils && [ -x /usr/bin/gnuinstall ]; then
  export PATH="${ROOT}/scripts/host-shim:${PATH}"
fi

make -C "${BUILDROOT}" O="${OUT}" BR2_EXTERNAL="${ROOT}/br-external" "${DEFCONFIG}"
make -j"${JOBS}" -C "${BUILDROOT}" O="${OUT}" BR2_EXTERNAL="${ROOT}/br-external" "${@}"
