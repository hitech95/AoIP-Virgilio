# procd - OpenWrt system process manager
# Pinned to OpenWrt 25.12.5 stable (58eb263, 2026-03-13).
# udebug is a hard link dependency at 25.12.5 (FIND_LIBRARY + ${udebug} in
# LIBS, udebug.h includes) -> listed in PROCD_DEPENDENCIES (deviation D7).
# procd spawns /sbin/ubusd itself; init chain: /sbin/init (procd initd)
# -> /etc/preinit -> /sbin/procd -> inittab -> /etc/rc.d/{S,K}*.

PROCD_VERSION = 58eb263d5abe03f8c1280bdfa65a3b052614215d
PROCD_SITE = https://github.com/openwrt/procd
PROCD_SITE_METHOD = git
PROCD_LICENSE = GPL-2.0
PROCD_DEPENDENCIES = libubox ubus json-c udebug

# SECCOMP_SUPPORT / JAIL_SUPPORT / UTRACE_SUPPORT default OFF; no libcap,
# no libseccomp needed. EARLY_PATH not needed.
# Full PATH for procd and everything it spawns (services, proto handlers):
# default EARLY_PATH is /sbin:/bin which misses /usr/bin (ipcalc, jsonfilter
# live in /usr/bin under merged-/usr Buildroot).
PROCD_CONF_OPTS = -DEARLY_PATH="/usr/sbin:/usr/bin:/sbin:/bin"

$(eval $(cmake-package))
