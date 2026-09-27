# webui - appliance web UI (nginx front + ucode RPC daemon + OUI frontend)
# M1: webuid SCGI daemon (login via /etc/shadow, sessions, /_auth, ubus
# bridge). M2: vendored OUI shell + patched login + webui-app-status.
# See plan/webui.md for the frozen contract and milestones.

WEBUI_VERSION = 0.2.0
WEBUI_SITE = $(BR2_EXTERNAL_VIRGILIO_PATH)/package/webui
WEBUI_SITE_METHOD = local
WEBUI_LICENSE = GPL-3.0-or-later (daemon, apps) / MIT (vendored oui parts)
WEBUI_DEPENDENCIES = ucode nginx

# Feature apps installed per Kconfig (login is always installed); the app
# options select the service packages each app needs (netifd, ubox,
# camilladsp, inferno). WEBUI_APP_DSP covers both dsp editors + the live
# EQ view (they share the camilladsp websocket/RPCs).
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_HOME) += home
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_STATUS) += status
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_SYSTEM) += system
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_NETSTAT) += netstat
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_NETWORK) += network
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_LOGS) += logs
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_DSP) += dsp dsp-live
WEBUI_APPS-$(BR2_PACKAGE_WEBUI_APP_INFERNO) += inferno
WEBUI_APPS = $(WEBUI_APPS-y)

# Frontend build uses the HOST node (OUI's CONFIG_OUI_USE_HOST_NODE model):
# node is a build tool only, nothing node-shaped ships in the image.
# npm install needs network (same precedent as the camilladsp cargo build).
define WEBUI_BUILD_FRONTEND
	PATH=$(PATH) HOME=$(HOME) \
		$(BR2_EXTERNAL_VIRGILIO_PATH)/../scripts/webui/build-frontend.sh \
		$(@D)/frontend-staging login $(WEBUI_APPS)
endef

define WEBUI_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(WEBUI_PKGDIR)/daemon/webuid \
		$(TARGET_DIR)/usr/bin/webuid
	$(INSTALL) -d -m 0755 $(TARGET_DIR)/usr/share/webui/ucode
	# core modules (daemon/core/) + per-app modules (only the apps
	# selected in Kconfig; login ships with the shell)
	$(INSTALL) -m 0644 $(WEBUI_PKGDIR)/daemon/core/*.uc \
		$(TARGET_DIR)/usr/share/webui/ucode/
	for app in login $(WEBUI_APPS); do \
		if [ -d "$(WEBUI_PKGDIR)/src/webui-app-$(app)/daemon" ]; then \
			$(INSTALL) -m 0644 $(WEBUI_PKGDIR)/src/webui-app-$(app)/daemon/*.uc \
				$(TARGET_DIR)/usr/share/webui/ucode/; \
		fi; \
	done
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
