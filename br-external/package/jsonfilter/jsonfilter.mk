# jsonfilter - OpenWrt JSON filter utility (jsonpath)
# Pinned to OpenWrt 25.12.5 (PKG_SOURCE_VERSION).
# Upstream installs the binary as 'jsonpath'; OpenWrt renames it to
# 'jsonfilter' in packaging - we do the same.

JSONFILTER_VERSION = b9034210bd331749673416c6bf389cccd4e23610
JSONFILTER_SITE = https://github.com/openwrt/jsonpath
JSONFILTER_SITE_METHOD = git
JSONFILTER_LICENSE = ISC
JSONFILTER_DEPENDENCIES = json-c libubox

define JSONFILTER_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/jsonpath \
		$(TARGET_DIR)/usr/bin/jsonfilter
endef

$(eval $(cmake-package))
