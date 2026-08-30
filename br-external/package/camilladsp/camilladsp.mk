# camilladsp - flexible audio DSP engine (IIR/FIR, crossovers, room correction)
# Pinned to v4.1.3 (musl, edition 2024, rust-version 1.90). Buildroot 2026.05.2
# ships rust 1.96, so no downgrade needed.
# Features: ALSA backend always built on Linux; websocket for runtime control.
# 32bit feature (float32 processing) is enabled: recommended on 32-bit CPUs.
# Config is NOT shipped: it is generated at runtime from uci into /tmp
# (see M6 config-generator integration).
# v4.1.3 has no Cargo.lock in git, so vendoring is disabled and the build
# runs with network (see DOWNLOAD_POST_PROCESS below).

CAMILLADSP_VERSION = 05e9cfcdf43c0dfe078ed3feb8af4c8bd701fd74
CAMILLADSP_SITE = https://github.com/HEnquist/camilladsp
CAMILLADSP_SITE_METHOD = git
CAMILLADSP_LICENSE = GPL-3.0 or MPL-2.0
CAMILLADSP_LICENSE_FILES = LICENSE_GPLv3.txt LICENSE_MPL2.0.txt
CAMILLADSP_DEPENDENCIES = alsa-lib

# NEON: the armv7 rust target does not enable it by default. Must preserve the
# arm link workaround that pkg-cargo.mk injects (-Clink-arg for multiple
# definitions), so we include it explicitly. musl defaults to crt-static
# (+crt-static) which tries -lasound statically; use dynamic linking instead.
CAMILLADSP_CARGO_ENV = \
	CARGO_TARGET_$(call UPPERCASE,$(RUSTC_TARGET_NAME))_RUSTFLAGS="--remap-path-prefix=$(HOST_DIR)=/usr -Clink-arg=-Wl,--allow-multiple-definition -C target-cpu=cortex-a7 -C target-feature=+neon -C target-feature=-crt-static" \
	RUSTFLAGS="-C target-cpu=cortex-a7 -C target-feature=+neon -C target-feature=-crt-static"

CAMILLADSP_CARGO_BUILD_OPTS = --features 32bit

define CAMILLADSP_BUILD_CMDS
	cd $(@D) && \
	$(TARGET_MAKE_ENV) \
	$(TARGET_CONFIGURE_OPTS) \
	$(PKG_CARGO_ENV) \
	$(CAMILLADSP_CARGO_ENV) \
	cargo build --release --manifest-path Cargo.toml $(CAMILLADSP_CARGO_BUILD_OPTS)
endef

define CAMILLADSP_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/target/$(RUSTC_TARGET_NAME)/release/camilladsp \
		$(TARGET_DIR)/usr/bin/camilladsp
endef

$(eval $(cargo-package))

# v3.0.1 has no Cargo.lock in git. Disable Buildroot's vendoring (which needs
# --locked) and build with network at build time. Must be after eval since
# cargo-package sets it to 'cargo' unconditionally.
CAMILLADSP_DOWNLOAD_POST_PROCESS =
