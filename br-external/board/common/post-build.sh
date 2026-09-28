#!/bin/sh
# Post-build: flatten the kernel module tree to OpenWrt layout.
# ubox's kmodloader only globs top-level /lib/modules/<ver>/*.ko (OpenWrt
# installs modules flat); Buildroot keeps the kernel's nested kernel/** tree.
# Move every .ko to the top of its version dir, drop the empty tree and
# regenerate modules.dep with the host depmod.

set -e

[ -d "${TARGET_DIR}/lib/modules" ] || exit 0

# Drop Buildroot's busybox-style SysV scripts: procd walks /etc/rc.d
# itself (procd rcS.c) after /etc/init.d/rcS (ours: a stub, see
# virgilio-base) exits. The skeleton scripts (S01syslogd, S02klogd,
# S02sysctl, S11modules, S40network, S50crond, ...) fight procd, netifd
# and kmodloader (S40network would race netifd's interface setup,
# S01syslogd starts a second syslog alongside ubox logd).
rm -f "${TARGET_DIR}"/etc/init.d/S??*
rm -f "${TARGET_DIR}"/etc/init.d/rcK

# Drop Buildroot's stock mpd SysV script: it duplicates our procd init
# (/etc/init.d/mpd) and pollutes the `service` listing as /etc/init.d/S95mpd.
rm -f "${TARGET_DIR}"/etc/init.d/S95mpd

# Drop Buildroot's nginx SysV script: /etc/init.d/nginx (procd, from the
# webui package) replaces it.
rm -f "${TARGET_DIR}"/etc/init.d/S50nginx

# Overlay removals do NOT propagate into the accumulating target dir --
# purge anything a previous build may have left behind (T2: mpd is off by
# default, enabled manually on the source guest; T9: no shipped test
# assets -- radio/FIR/wav are user data, not image content).
# Exception: a source-appliance board ships etc/virgilio/flags/keep-mpd
# to keep its S96mpd rc.d link (the flag dir itself is harmless in the
# image and documents the intent).
if [ ! -e "${TARGET_DIR}"/etc/virgilio/flags/keep-mpd ]; then
	rm -f "${TARGET_DIR}"/etc/rc.d/S96mpd
fi
rm -f "${TARGET_DIR}"/etc/rc.d/S96aoip-bridge "${TARGET_DIR}"/usr/bin/mpd-ctl
# purge the camilladsp package extras, but KEEP the vendor coeffs dir the
# locked conv filters point at (rootfs-overlay/usr/share/camilladsp/coeffs;
# this script runs AFTER the overlay, a plain rm -rf would reap it too)
if [ -d "${TARGET_DIR}"/usr/share/camilladsp ]; then
	find "${TARGET_DIR}"/usr/share/camilladsp -mindepth 1 -maxdepth 1 \
		! -name coeffs -exec rm -rf {} +
fi
rm -rf "${TARGET_DIR}"/usr/share/mpd

# Prod root layout mountpoints: the rootfs is READ-ONLY (squashfs), so
# /etc/preinit cannot mkdir them at boot — they must exist in the image.
# (/data = rw data partition, /rom = ro lower view after the pivot,
# /mnt = overlay assembly point; all hidden/overmounted after preinit.)
mkdir -p "${TARGET_DIR}/data" "${TARGET_DIR}/rom" "${TARGET_DIR}/mnt"

# OpenWrt-style volatile layout: /var and /run are symlinks into the tmpfs
# (/tmp, mounted by procd early). Keeps logs, run sockets, lock files and
# uci state deltas in RAM instead of wearing the rootfs (SPI NAND on real
# hardware). procd pre-creates /tmp/{shm,run,lock,state}; /etc/init.d/boot's
# mkdirs then just re-create tmpfs dirs, which is harmless.
rm -rf "${TARGET_DIR}"/var "${TARGET_DIR}"/run
ln -s tmp "${TARGET_DIR}/var"
ln -s var/run "${TARGET_DIR}/run"

# Keep /tmp/run real so the /run -> var/run -> tmp/run chain never dangles
# in the accumulating target dir (nginx's install does `test -d run ||
# mkdir -p run`, which EEXISTs on a dangling symlink).
mkdir -p "${TARGET_DIR}/tmp/run"

# Run-once uci defaults dir (executed by /etc/init.d/boot's uci_apply_defaults,
# scripts deleted after success). Ships empty like OpenWrt base-files - a
# placeholder file would be executed and removed as if it were a script.
mkdir -p "${TARGET_DIR}"/etc/uci-defaults

# Factory-reset snapshot for the webui (webui.factory_reset): the shipped
# /etc/config state (incl. /etc/shadow -- the pristine empty root password
# IS part of factory state), captured after every package + overlay step.
mkdir -p "${TARGET_DIR}/usr/share/webui/defaults"
tar -C "${TARGET_DIR}" -cf "${TARGET_DIR}/usr/share/webui/defaults/etc-config.tar" \
	etc/config etc/shadow

for kdir in "${TARGET_DIR}"/lib/modules/*; do
	[ -d "${kdir}" ] || continue

	find "${kdir}" -mindepth 2 -name '*.ko' -exec mv {} "${kdir}/" \;
	find "${kdir}" -mindepth 1 -depth -type d -empty -delete

	"${HOST_DIR}/sbin/depmod" -b "${TARGET_DIR}" "$(basename "${kdir}")"
done

exit 0
