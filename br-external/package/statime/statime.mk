# statime - PTP daemon (fork with PTPv1 / inferno support)
# Pinned commit on branch inferno-dev of teodly/statime (fork of
# pendulum-project/statime). Required by inferno even for capture-only.
# Built like camilladsp: cargo with NEON RUSTFLAGS, network build
# (usrvclock is a git dependency, vendoring disabled).
#
# 0001-export-usrvclock-overlay-while-master.patch: upstream only exports
# the usrvclock overlay from servo actions (i.e. while slaved); a
# grandmaster never exports and local inferno instances starve. The patch
# re-sends the last overlay at 1 Hz while any port is Master so a lone
# (or leading) node is a valid clock source too.
#
# 0003-ptpv1-master.patch: PTPv1 master TX (the fork ships v1 slave only).
# Adds v1 Sync/Follow_Up/Delay_Resp constructors next to the existing
# parsers (incl. a fix: the v1 Follow_Up serializer wrote its fields at
# the wrong offsets and never round-tripped), fills the master.rs stubs
# (two-step Sync + Follow_Up on TX timestamp, Delay_Resp answering
# Delay_Req, announce timer re-arm only — v1 has no Announce), and wires
# the v1 Delay_Req receive path. Identity fields mirror from_v1_header so
# statime slaves lock onto us (unit-tested with an in-process
# master<->slave exchange). Stratum 3 / "DFLT" / preferred=priority1<128
# are unverified Dante dialect facts pending a hardware capture.
# Regenerate via: git -C deps/statime diff > this file (fuzz 0 applies
# clean on the pin); drop when the fork merges the upstream PR.

STATIME_VERSION = 244f20a56c173b1881f2e5e83652bb8b8209b2ab
STATIME_SITE = https://github.com/teodly/statime
STATIME_SITE_METHOD = git
STATIME_GIT_SUBMODULES = YES
STATIME_LICENSE = Apache-2.0 or MIT
STATIME_LICENSE_FILES = LICENSE-APACHE LICENSE-MIT

# only the linux daemon from the workspace (stm32 member must not build)
STATIME_CARGO_BUILD_OPTS = --package statime-linux --bin statime

# Cargo.lock pins usrvclock @24da792 which does not compile on 32-bit
# (tv_nsec i32 vs i64); upstream fixed it in 53116cb. Re-pin before build.
define STATIME_UPDATE_USRVCLOCK
	cd $(@D) && \
	$(TARGET_MAKE_ENV) \
	$(PKG_CARGO_ENV) \
	cargo update -p usrvclock --precise 53116cb61f4f09d5a6da4c893bf11ea4eb5c958a
endef
STATIME_PRE_BUILD_HOOKS += STATIME_UPDATE_USRVCLOCK

STATIME_CARGO_ENV = \
	CARGO_TARGET_$(call UPPERCASE,$(RUSTC_TARGET_NAME))_RUSTFLAGS="--remap-path-prefix=$(HOST_DIR)=/usr -Clink-arg=-Wl,--allow-multiple-definition -C target-cpu=cortex-a7 -C target-feature=+neon -C target-feature=-crt-static" \
	RUSTFLAGS="-C target-cpu=cortex-a7 -C target-feature=+neon -C target-feature=-crt-static"

define STATIME_BUILD_CMDS
	cd $(@D) && \
	$(TARGET_MAKE_ENV) \
	$(TARGET_CONFIGURE_OPTS) \
	$(PKG_CARGO_ENV) \
	$(STATIME_CARGO_ENV) \
	cargo build --release $(STATIME_CARGO_BUILD_OPTS)
endef

define STATIME_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/target/$(RUSTC_TARGET_NAME)/release/statime \
		$(TARGET_DIR)/usr/bin/statime
endef

$(eval $(cargo-package))

# Disable Buildroot's cargo vendoring (--locked): the fork pulls the
# usrvclock git dependency at build time.
STATIME_DOWNLOAD_POST_PROCESS =
