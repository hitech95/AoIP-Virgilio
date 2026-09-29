# netifd - OpenWrt network interface daemon
# Pinned to OpenWrt 25.12.5 stable. Requires ucode (proto-ucode) + libnl.
# udebug is a hard link dependency (upstream FIND_LIBRARY + ${udebug} in
# LIBS) -> listed in NETIFD_DEPENDENCIES; the patch below only compiles out
# the OpenWrt-only libnl udebug callbacks (nl_socket_set_{tx,rx}_debug_cb),
# which Buildroot's vanilla libnl lacks.
# Also installs scripts/netifd-proto.sh (proto shell infrastructure) to
# /lib/netifd/ as required by lib/netifd/proto/dhcp.sh.

NETIFD_VERSION = cbb83a1857407a28a63dc09412a1f209195914ef
NETIFD_SITE = https://github.com/openwrt/netifd
NETIFD_SITE_METHOD = git
NETIFD_LICENSE = GPL-2.0
NETIFD_DEPENDENCIES = libubox ubus uci json-c libnl ucode udebug

define NETIFD_INSTALL_PROTO_HELPERS
	$(INSTALL) -D -m 0755 $(@D)/scripts/netifd-proto.sh \
		$(TARGET_DIR)/usr/lib/netifd/netifd-proto.sh
	$(INSTALL) -D -m 0755 $(@D)/scripts/utils.sh \
		$(TARGET_DIR)/usr/lib/netifd/utils.sh
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/usr/lib/netifd/proto
	$(INSTALL) -m 0755 $(NETIFD_PKGDIR)/files/dhcp.sh \
		$(TARGET_DIR)/usr/lib/netifd/proto/dhcp.sh
	$(INSTALL) -m 0755 $(NETIFD_PKGDIR)/files/zcip.sh \
		$(TARGET_DIR)/usr/lib/netifd/proto/zcip.sh
	$(INSTALL) -m 0755 $(NETIFD_PKGDIR)/files/zcip.script \
		$(TARGET_DIR)/usr/lib/netifd/zcip.script
	$(INSTALL) -m 0755 $(NETIFD_PKGDIR)/files/dhcp.script \
		$(TARGET_DIR)/usr/lib/netifd/dhcp.script
	$(INSTALL) -D -m 0755 $(NETIFD_PKGDIR)/files/ipcalc.sh \
		$(TARGET_DIR)/usr/bin/ipcalc.sh
	$(INSTALL) -D -m 0644 $(NETIFD_PKGDIR)/files/etc/hotplug.d/iface/00-netstate \
		$(TARGET_DIR)/etc/hotplug.d/iface/00-netstate
endef
NETIFD_POST_INSTALL_TARGET_HOOKS += NETIFD_INSTALL_PROTO_HELPERS

$(eval $(cmake-package))
