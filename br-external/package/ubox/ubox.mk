# Pinned to OpenWrt 25.12.5 stable.
# ubox - OpenWrt small system toolbox
# Pinned to the commit used by openwrt-23.05 (era-matched with our procd/netifd).
# Ships: kmodloader, validate_data + libvalidate, logd + logread (system
# logging via /etc/init.d/log). Patch disables getrandom/lsbloader.

UBOX_VERSION = 6f78fa496bf36c55864a41e353df7d13f04b1077
UBOX_SITE = https://github.com/openwrt/ubox
UBOX_SITE_METHOD = git
UBOX_LICENSE = GPL-2.0, ISC (kvlist)
UBOX_DEPENDENCIES = libubox uci

$(eval $(cmake-package))
