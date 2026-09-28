# inferno - unofficial Dante protocol implementation (AoIP)
# Workspace (branch dev): inferno_aoip, searchfire, inferno2pipe,
# alsa_pcm_inferno; recursive git submodules (alsa-sys-all, searchfire,
# usrvclock-rs). Built like camilladsp: cargo with NEON RUSTFLAGS,
# network build (vendoring disabled).

INFERNO_VERSION = 75d9198bf06bae732cd4cc0df9d46326dae77710
INFERNO_SITE = https://github.com/teodly/inferno
INFERNO_SITE_METHOD = git
INFERNO_GIT_SUBMODULES = YES
INFERNO_LICENSE = GPL-3.0 or AGPL-3.0
INFERNO_LICENSE_FILES = LICENSE
INFERNO_DEPENDENCIES = alsa-lib

INFERNO_CARGO_ENV = \
	CARGO_TARGET_$(call UPPERCASE,$(RUSTC_TARGET_NAME))_RUSTFLAGS="--remap-path-prefix=$(HOST_DIR)=/usr -Clink-arg=-Wl,--allow-multiple-definition $(VIRGILIO_RUST_CPU_FLAGS)" \
	RUSTFLAGS="$(VIRGILIO_RUST_CPU_FLAGS)"

define INFERNO_BUILD_CMDS
	cd $(@D) && \
	$(TARGET_MAKE_ENV) \
	$(TARGET_CONFIGURE_OPTS) \
	$(PKG_CARGO_ENV) \
	$(INFERNO_CARGO_ENV) \
	cargo build --release
endef

define INFERNO_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/target/$(RUSTC_TARGET_NAME)/release/inferno2pipe \
		$(TARGET_DIR)/usr/bin/inferno2pipe
	$(INSTALL) -D -m 0755 $(@D)/target/$(RUSTC_TARGET_NAME)/release/libasound_module_pcm_inferno.so \
		$(TARGET_DIR)/usr/lib/alsa-lib/libasound_module_pcm_inferno.so
	cp -a --remove-destination $(INFERNO_PKGDIR)/files/. $(TARGET_DIR)/
endef

$(eval $(cargo-package))

# Build with network (recursive submodules + git dependencies; vendoring
# disabled like camilladsp/statime).
INFERNO_DOWNLOAD_POST_PROCESS =
