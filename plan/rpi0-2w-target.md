# RPi Zero 2 W target — CLOSED (shipped as virgilio_rpi02w)

> **Status 2026-10-02: done.** The board shipped 2026-09-29 as
> `virgilio_rpi02w` (32-bit armv7, rpi2b base + srcqemu source role) and
> was hardware-validated 2026-10-02: RTL8153 dongle enumerates `eth0`
> (no rename, no udev), DHCP on `lan` + zcip on `aoip`, board acts as
> PTP grand master standalone (priority1 128) and slave on the host rig,
> streams the full chain Zero 2 W → LAN → RPi2 sink (first all-hardware
> Dante chain). See git history: board commit, RTL815x firmware commit,
> and the full-rebuild verification.

## How it shipped (vs. the original sketch below)

The original sketch targeted an aarch64 `virgilio_rpi0_2w_64` variant on
upstream's zero2w_64 defconfig. What actually shipped is the 32-bit
armv7 rpi2b base — one toolchain and boot flow with the proven sink
board — carrying the srcqemu source role. The USB-Ethernet, zcip/GM and
console decisions below are the ones that shipped.

## Resolution of the open items

- **USB-Ethernet adapter/driver**: RTL8153 dongle (0bda:8153), `r8152`
  built-in (`=y`, no module-load dependency), `rtl_nic` firmware via
  `BR2_PACKAGE_LINUX_FIRMWARE` + `_RTL_815X` (note: the master switch
  gates the sub-option or kconfig silently drops it). Validated on hw.
- **PTP hw timestamping**: this dongle/kernel combo registers **no PHC**
  (`/sys/class/ptp/` empty) → software timestamps only. Validated
  working: the board held GM with the sink slaved and the audio chain
  streaming. `NETWORK_PHY_TIMESTAMPING=y` stays enabled for a future
  hw-ts dongle; re-check with `ls /sys/class/ptp` (ethtool is not in the
  image).
- **Audio HAT**: not applicable — the shipped role is the audio SOURCE
  (MPD → snd-aloop → camilladsp bypass → inferno TX); no local audio
  output. A sink variant on this hardware would reopen this item.
- **Read-only root**: shipped from day one via the shared prod layout
  (squashfs root + overlay + data partition, `virgilio-data=`).
- **Toolchain question (glibc vs musl)**: resolved by the 32-bit choice
  — the shared internal musl toolchain.

## Follow-ups that live elsewhere now

- Event-driven service lifecycle (link loss, address ladder):
  `plan/camilladsp-inferno-lifecycle.md`.
- Mainline inferno bugs found during hardware bring-up: stale-handle
  resume loop on `FlowNotFound`, `AddrInUse` listener panic
  (`util/net.rs:38`, upstream TODO), race-free teardown (already
  patched in-tree as `0005-race-free-flow-teardown.patch`).
- Operationally: subscriptions must use the board's live hostname
  (`pi2w-src` after the on-device rename; the shipped default is
  `virgilio-src`).

## Original preparation notes (historical)

Basis: upstream `buildroot/configs/raspberrypizero2w_64_defconfig`
(aarch64, Cortex-A53 ×4, DTS `broadcom/bcm2710-rpi-zero-2-w`,
`BR2_LINUX_KERNEL_DEFCONFIG="bcm2711"`, rpi-firmware + genimage sdcard).

Already prepared (target-independent, all landed):

- [x] Per-board Rust tuning (`BR2_EXTERNAL_VIRGILIO_RUST_CPU/_FEATURES`
      + `br-external/rustflags.mk`)
- [x] Per-variant output dirs (`scripts/build.sh`, `output/<variant>`)
- [x] Generic busybox fragment (`board/common/busybox.fragment`)
- [x] Board layering (see `docs/dependency-map.md`)

Candidate dongle table from the original research: RTL8152/8153 (r8152,
hw-ts capable chip-side), LAN7800 (lan78xx, hw-ts), SMSC LAN951x /
ASIX (sw-ts only).
