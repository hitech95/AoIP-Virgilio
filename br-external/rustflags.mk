# Shared Rust target tuning for the Virgilio cargo packages
# (camilladsp, statime, inferno). Included from external.mk.
#
# The board defines the CPU and extra target features in its defconfig
# (BR2_EXTERNAL_VIRGILIO_RUST_CPU / _RUST_FEATURES, see Config.in); this
# file only composes them into VIRGILIO_RUST_CPU_FLAGS. The packages add
# the generic bits (remap-path-prefix, the multiple-definition link
# workaround from pkg-cargo.mk).
#
# -crt-static is always appended: it undoes musl's static-by-default crt
# so the binaries link dynamically against alsa-lib etc. (no-op on glibc
# toolchains).

VIRGILIO_RUST_CPU := $(call qstrip,$(BR2_EXTERNAL_VIRGILIO_RUST_CPU))
VIRGILIO_RUST_FEATURES := $(call qstrip,$(BR2_EXTERNAL_VIRGILIO_RUST_FEATURES))

# single -C target-feature flag: board features first, then the
# crt-static override (rustc takes a comma-separated list). NB: commas
# are separators inside $(if ...), so build the join with ifeq instead.
ifeq ($(VIRGILIO_RUST_FEATURES),)
VIRGILIO_RUST_FEATURES_FULL := -crt-static
else
VIRGILIO_RUST_FEATURES_FULL := $(VIRGILIO_RUST_FEATURES),-crt-static
endif

VIRGILIO_RUST_CPU_FLAGS := $(if $(VIRGILIO_RUST_CPU),-C target-cpu=$(VIRGILIO_RUST_CPU)) -C target-feature=$(VIRGILIO_RUST_FEATURES_FULL)
