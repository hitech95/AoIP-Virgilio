# virgilio-base: common rootfs parts (OpenWrt base-files role) shared by
# every device. The files/ tree is copied verbatim into the target; it is
# installed during the *package* phase, so per-board rootfs overlays
# (applied after all packages) can still override any file shipped here.

VIRGILIO_BASE_SITE = $(BR2_EXTERNAL_VIRGILIO_PATH)/package/virgilio-base/files
VIRGILIO_BASE_SITE_METHOD = local
# OpenWrt-derived scripts (GPL-2.0-or-later) + project files (GPL-3.0-or-later)
VIRGILIO_BASE_LICENSE = GPL-2.0-or-later, GPL-3.0-or-later

define VIRGILIO_BASE_INSTALL_TARGET_CMDS
	mkdir -p $(TARGET_DIR)
	cp -a $(@D)/. $(TARGET_DIR)/
endef

$(eval $(generic-package))
