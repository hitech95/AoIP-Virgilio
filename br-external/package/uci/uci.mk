# uci - OpenWrt Unified Configuration Interface
 # Pinned to OpenWrt 25.12.5 stable.
# (files/uci.sh, from openwrt-23.05 packaging) is installed as
# /lib/config/uci.sh, required by /lib/functions.sh (config_load, uci_get)
# and the netifd proto handlers.

UCI_VERSION = 66127cd76c5d0bd46d5a90302cc6110f53a4e2f8
UCI_SITE = https://github.com/openwrt/uci
UCI_SITE_METHOD = git
UCI_LICENSE = LGPL-2.1
UCI_INSTALL_STAGING = YES
UCI_DEPENDENCIES = libubox

UCI_CONF_OPTS = -DBUILD_LUA=OFF

define UCI_INSTALL_UCLIB
	$(INSTALL) -D -m 0755 $(UCI_PKGDIR)/files/uci.sh \
		$(TARGET_DIR)/usr/lib/config/uci.sh
endef
UCI_POST_INSTALL_TARGET_HOOKS += UCI_INSTALL_UCLIB

# The shell wrappers (lib/config/uci.sh) hardcode /sbin/uci (OpenWrt layout);
# upstream CMake installs the CLI to bin - move it to match.
define UCI_MOVE_CLI_TO_SBIN
	mv $(TARGET_DIR)/usr/bin/uci $(TARGET_DIR)/usr/sbin/uci
endef
UCI_POST_INSTALL_TARGET_HOOKS += UCI_MOVE_CLI_TO_SBIN

$(eval $(cmake-package))
