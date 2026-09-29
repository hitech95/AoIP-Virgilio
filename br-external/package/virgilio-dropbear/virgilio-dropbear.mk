# virgilio-dropbear: shared ssh access wiring (procd init + uci config +
# rc.d enablement). The files/ tree is copied verbatim into the target
# during the package phase; board overlays may still override parts.

VIRGILIO_DROPBEAR_SITE = $(BR2_EXTERNAL_VIRGILIO_PATH)/package/virgilio-dropbear/files
VIRGILIO_DROPBEAR_SITE_METHOD = local
VIRGILIO_DROPBEAR_LICENSE = GPL-3.0-or-later

define VIRGILIO_DROPBEAR_INSTALL_TARGET_CMDS
	mkdir -p $(TARGET_DIR)
	cp -a --remove-destination $(@D)/. $(TARGET_DIR)/
endef

$(eval $(generic-package))
