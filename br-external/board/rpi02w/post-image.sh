#!/usr/bin/env bash
# virgilio rpi2b post-image: assemble the sdcard (boot FAT + squashfs
# root + data ext4) with genimage. Replaces the upstream raspberrypi
# post-image: our layout has a read-only squashfs root and a rw data
# partition for the overlay (see ../genimage.cfg).
set -euo pipefail

BOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

# keep the firmware boot files current: rpi-firmware's install stamps do
# not track edits to our config.txt/cmdline.txt, so refresh them here
# (config.txt stays as installed unless we ship a board one); comments
# (#) are stripped so the kernel log gets no unknown-parameter noise
grep -v '^#' "${BOARD_DIR}/cmdline.txt" | sed '/^\s*$/d' > "${BINARIES_DIR}/rpi-firmware/cmdline.txt"

rm -rf "${GENIMAGE_TMP}"
genimage \
	--rootpath "${TARGET_DIR}" \
	--tmppath "${GENIMAGE_TMP}" \
	--inputpath "${BINARIES_DIR}" \
	--outputpath "${BINARIES_DIR}" \
	--config "${BOARD_DIR}/genimage.cfg"
