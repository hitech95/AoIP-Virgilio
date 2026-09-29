# virgilio-mpd: shared media-source wiring (mpd.conf + procd init + stop
# link). The files/ tree is copied verbatim into the target during the
# package phase; board overlays may still override parts.

VIRGILIO_MPD_SITE = $(BR2_EXTERNAL_VIRGILIO_PATH)/package/virgilio-mpd/files
VIRGILIO_MPD_SITE_METHOD = local
VIRGILIO_MPD_LICENSE = GPL-3.0-or-later

define VIRGILIO_MPD_INSTALL_TARGET_CMDS
	mkdir -p $(TARGET_DIR)
	cp -a --remove-destination $(@D)/. $(TARGET_DIR)/
endef

$(eval $(generic-package))
