# webui - appliance web UI (nginx front + ucode RPC daemon + OUI frontend)
# M1: webuid SCGI daemon (login via /etc/shadow, sessions, /_auth, ubus
# bridge). M2: vendored OUI shell + patched login + webui-app-status.
# See plan/webui.md for the frozen contract and milestones.

WEBUI_VERSION = 0.2.0
WEBUI_SITE = $(BR2_EXTERNAL_RK3506QEMU_PATH)/package/webui
WEBUI_SITE_METHOD = local
WEBUI_LICENSE = GPL-3.0-or-later (daemon, apps) / MIT (vendored oui parts)
WEBUI_DEPENDENCIES = ucode nginx

# Frontend build uses the HOST node (OUI's CONFIG_OUI_USE_HOST_NODE model):
# node is a build tool only, nothing node-shaped ships in the image.
# npm install needs network (same precedent as the camilladsp cargo build).
define WEBUI_BUILD_FRONTEND
	PATH=$(PATH) HOME=$(HOME) \
		$(BR2_EXTERNAL_RK3506QEMU_PATH)/../scripts/webui/build-frontend.sh \
		$(@D)/frontend-staging
endef

define WEBUI_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(WEBUI_PKGDIR)/daemon/webuid \
		$(TARGET_DIR)/usr/bin/webuid
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/usr/share/webui/ucode
	# core modules (daemon/core/) + per-app modules (src/webui-app-*/daemon/)
	$(INSTALL) -m 0644 $(WEBUI_PKGDIR)/daemon/core/*.uc \
		$(TARGET_DIR)/usr/share/webui/ucode/
	$(INSTALL) -m 0644 $(WEBUI_PKGDIR)/src/*/daemon/*.uc \
		$(TARGET_DIR)/usr/share/webui/ucode/
	$(INSTALL) -D -m 0755 $(WEBUI_PKGDIR)/files/webui.init \
		$(TARGET_DIR)/etc/init.d/webui
	$(INSTALL) -D -m 0755 $(WEBUI_PKGDIR)/files/nginx.init \
		$(TARGET_DIR)/etc/init.d/nginx
	$(INSTALL) -D -m 0644 $(WEBUI_PKGDIR)/files/nginx.conf \
		$(TARGET_DIR)/etc/nginx/nginx.conf
	$(INSTALL) -D -m 0644 $(WEBUI_PKGDIR)/files/nginx-locations.conf \
		$(TARGET_DIR)/etc/nginx/webui-locations.conf
	$(INSTALL) -D -m 0644 $(WEBUI_PKGDIR)/files/nginx-security-headers.conf \
		$(TARGET_DIR)/etc/nginx/webui-security.conf
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/usr/share/webui/nginx
	$(INSTALL) -m 0644 $(WEBUI_PKGDIR)/files/nginx-http.conf \
		$(WEBUI_PKGDIR)/files/nginx-redirect.conf \
		$(WEBUI_PKGDIR)/files/nginx-https.conf.in \
		$(TARGET_DIR)/usr/share/webui/nginx/
	$(INSTALL) -D -m 0644 $(WEBUI_PKGDIR)/files/webui.config \
		$(TARGET_DIR)/etc/config/webui
	$(INSTALL) -D -m 0644 $(WEBUI_PKGDIR)/files/zoneinfo.json \
		$(TARGET_DIR)/usr/share/webui/zoneinfo.json

	# frontend (built in WEBUI_BUILD_CMDS): shell + views + menus
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/usr/share/webui
	cp -a $(@D)/frontend-staging/ui $(TARGET_DIR)/usr/share/webui/
	cp -a $(@D)/frontend-staging/menu.d $(TARGET_DIR)/usr/share/webui/

	# boot enablement (same pattern as the camilladsp overlay symlinks)
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/etc/rc.d
	ln -sf ../init.d/nginx $(TARGET_DIR)/etc/rc.d/S84nginx
	ln -sf ../init.d/webui $(TARGET_DIR)/etc/rc.d/S85webui
	ln -sf ../init.d/webui $(TARGET_DIR)/etc/rc.d/K15webui
	ln -sf ../init.d/nginx $(TARGET_DIR)/etc/rc.d/K16nginx
endef

WEBUI_BUILD_CMDS += $(WEBUI_BUILD_FRONTEND)

$(eval $(generic-package))
