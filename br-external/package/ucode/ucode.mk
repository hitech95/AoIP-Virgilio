# ucode - tiny scripting language (VM)
# Pinned to OpenWrt 25.12.5 stable.

UCODE_VERSION = 85922056ef7abeace3cca3ab28bc1ac2d88e31b1
UCODE_SITE = https://github.com/jow-/ucode
UCODE_SITE_METHOD = git
UCODE_LICENSE = ISC
UCODE_INSTALL_STAGING = YES
UCODE_DEPENDENCIES = libubox ubus json-c zlib uci

# Matches OpenWrt package/utils/ucode defaults: FS/MATH/STRUCT/DEBUG/ZLIB on,
# everything else off (keeps dependencies minimal; netifd only needs
# FS/MATH/STRUCT). ULOOP+SOCKET+UBUS on for /usr/bin/ptp-monitor (timers,
# process spawn, AF_UNIX datagrams, ubus object publish; uloop is part of
# libubox, ubus adds libubus which is already in the image). UCI on for the
# webui daemon's generic uci RPC bridge (plan/webui.md §4; libuci already
# in the image).
UCODE_CONF_OPTS = \
	-DSOVERSION=20230711 \
	-DFS_SUPPORT=ON \
	-DMATH_SUPPORT=ON \
	-DSTRUCT_SUPPORT=ON \
	-DDEBUG_SUPPORT=ON \
	-DZLIB_SUPPORT=ON \
	-DNL80211_SUPPORT=OFF \
	-DRESOLV_SUPPORT=OFF \
	-DRTNL_SUPPORT=OFF \
	-DUBUS_SUPPORT=ON \
	-DUCI_SUPPORT=ON \
	-DULOOP_SUPPORT=ON \
	-DLOG_SUPPORT=OFF \
	-DDIGEST_SUPPORT=OFF \
	-DIO_SUPPORT=OFF \
	-DSOCKET_SUPPORT=ON

$(eval $(cmake-package))
