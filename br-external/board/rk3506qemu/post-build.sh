#!/bin/sh
# Post-build: flatten the kernel module tree to OpenWrt layout.
# ubox's kmodloader only globs top-level /lib/modules/<ver>/*.ko (OpenWrt
# installs modules flat); Buildroot keeps the kernel's nested kernel/** tree.
# Move every .ko to the top of its version dir, drop the empty tree and
# regenerate modules.dep with the host depmod.

set -e

[ -d "${TARGET_DIR}/lib/modules" ] || exit 0

# Drop Buildroot's busybox-style SysV scripts: procd's rc.d is the only init
# mechanism in this firmware (OpenWrt init scripts replaced them).
#rm -f "${TARGET_DIR}"/etc/init.d/S??*

# Drop Buildroot's stock mpd SysV script: it duplicates our procd init
# (/etc/init.d/mpd) and pollutes the `service` listing as /etc/init.d/S95mpd.
rm -f "${TARGET_DIR}"/etc/init.d/S95mpd

# Overlay removals do NOT propagate into the accumulating target dir --
# purge anything a previous build may have left behind (T2: mpd is off by
# default, enabled manually on the source guest; T9: no shipped test
# assets -- radio/FIR/wav are user data, not image content).
rm -f "${TARGET_DIR}"/etc/rc.d/S96mpd "${TARGET_DIR}"/etc/rc.d/S96aoip-bridge
rm -rf "${TARGET_DIR}"/usr/share/camilladsp "${TARGET_DIR}"/usr/share/mpd

# OpenWrt-style volatile layout: /var and /run are symlinks into the tmpfs
# (/tmp, mounted by procd early). Keeps logs, run sockets, lock files and
# uci state deltas in RAM instead of wearing the rootfs (SPI NAND on real
# hardware). procd pre-creates /tmp/{shm,run,lock,state}; /etc/init.d/boot's
# mkdirs then just re-create tmpfs dirs, which is harmless.
rm -rf "${TARGET_DIR}"/var "${TARGET_DIR}"/run
ln -s tmp "${TARGET_DIR}"/var
ln -s var/run "${TARGET_DIR}"/run

# Run-once uci defaults dir (executed by /etc/init.d/boot's uci_apply_defaults,
# scripts deleted after success). Ships empty like OpenWrt base-files - a
# placeholder file would be executed and removed as if it were a script.
mkdir -p "${TARGET_DIR}"/etc/uci-defaults

for kdir in "${TARGET_DIR}"/lib/modules/*; do
	[ -d "${kdir}" ] || continue

	find "${kdir}" -mindepth 2 -name '*.ko' -exec mv {} "${kdir}/" \;
	find "${kdir}" -mindepth 1 -depth -type d -empty -delete

	"${HOST_DIR}/sbin/depmod" -b "${TARGET_DIR}" "$(basename "${kdir}")"
done

exit 0
