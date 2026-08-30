# udebug - OpenWrt debug library
# Pinned to OpenWrt 25.12.5 stable.

UDEBUG_VERSION = 875e1a7af6ca9d86524d18169c3a79f4a1920053
UDEBUG_SITE = https://git.openwrt.org/project/udebug.git
UDEBUG_SITE_METHOD = git
UDEBUG_LICENSE = GPL-2.0
UDEBUG_INSTALL_STAGING = YES
UDEBUG_DEPENDENCIES = libubox ubus ucode

# ucode headers needed for the ucode module (lib-ucode.c)
UDEBUG_CONF_OPTS = -DABIVERSION=20260116

$(eval $(cmake-package))
