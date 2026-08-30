#!/usr/bin/env bash
# Mode B (see plan/plan.md, 6.6): build sdcard.img with genimage.
# Enable with BR2_ROOTFS_POST_IMAGE_SCRIPT="board/rk3506qemu/post-image.sh"
# and BR2_PACKAGE_HOST_GENIMAGE=y. Mode A (direct boot) needs neither.
set -euo pipefail

BOARD_DIR="${BR2_EXTERNAL_RK3506QEMU_PATH}/board/rk3506qemu"
GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

# TODO (Mode B): once idbloader.bin/u-boot.itb placeholders exist:
#   rm -rf "${GENIMAGE_TMP}"
#   genimage --rootpath "${TARGET_DIR}" --tmppath "${GENIMAGE_TMP}" \
#     --inputpath "${BINARIES_DIR}" --outputpath "${BINARIES_DIR}" \
#     --config "${BOARD_DIR}/genimage.cfg"

echo "post-image: Mode B (sdcard.img) not enabled yet — see plan/plan.md 6.6" >&2
