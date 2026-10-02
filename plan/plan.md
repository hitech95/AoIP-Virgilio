# Plan — RK3506 test firmware (ARM Cortex-A7 + NEON) on QEMU

> **Status 2026-10-01**: active (master plan) — M0–M4 done, webui (D18) complete,
> lifecycle (D19) landed; open items in §11 "Next up" and in the
> feature-plan headers (each `plan/*.md` carries a
> `**Status <last-update-date>**: <status>` header).

## 1. Goal

Create a minimal Linux firmware, bootable with QEMU, compiled for an architecture
equivalent to the **Rockchip RK3506** (3× ARM **Cortex-A7** with **NEON/VFPv4**,
32-bit, hard-float), primarily running two audio applications:

| Application | Role | Language | Key target dependencies |
|---|---|---|---|
| [camilladsp](https://github.com/HEnquist/camilladsp) (v4.x) | IIR/FIR DSP engine (crossovers, room correction) | Rust (rustc ≥ 1.85) | `alsa-lib`, `libopenssl` (websocket feature) |
| [inferno](https://github.com/teodly/inferno) (`dev` branch) | Unofficial implementation of the Dante protocol (AoIP): `inferno_aoip`, `inferno2pipe`, `alsa_pcm_inferno` (ALSA plugin) | Rust (workspace + submodules) | `alsa-lib` (plugin), multicast networking, PTP daemon |
| [statime](https://github.com/teodly/statime) (fork, `inferno-dev` branch) | PTP daemon required by inferno | Rust | — |

Purpose: a **reproducible test case** (build + run + test) without physical hardware.

## 2. Constraints and architectural decisions

### 2.1 Emulation: QEMU `virt` with `cortex-a7`
- QEMU does not emulate the RK3506 (Rockchip peripherals are not supported); the
  test happens at the **ISA/core level**: Cortex-A7 + NEON, 32-bit, 3 cores
  (like the RK3506).
- Machine: `-M virt -cpu cortex-a7 -smp 3`. The `virt` machine supports
  `cortex-a7` and uses `virtio` peripherals (network, disk, console). The DTB is
  generated automatically by QEMU.
- Rootfs on `virtio-blk`, console on `ttyAMA0`, network via `virtio-net`.

### 2.2 Toolchain
- ARMv7-A, `cortex-a7`, FPU `neon-vfpv4`, **hard-float** ABI (EABIhf), **musl** libc:
  more compact than glibc (ideal for firmware) and the native libc of
  procd/uci/netifd/ubox (developed for musl/OpenWrt) → zero incompatibility risks.
  `camilladsp` builds fine against musl (pure-Rust + `alsa-lib` via pkg-config;
  Alpine's community package is musl-based). No glibc required — fallback would
  be one line (`BR2_TOOLCHAIN_BUILDROOT_GLIBC=y`).
- Platform: **Buildroot 2026.05.2** (rustc **1.90**, kernel **6.12.x LTS**,
  musl 1.2.5). Rust packages are compiled by the rustc cross-compiler built by
  Buildroot (`host-rust-bin` + `rust-std` for `armv7-unknown-linux-musleabihf`)
  against the internal musl toolchain: the libc choice is transparent to cargo
  packages (dynamic linking handled by the infrastructure).
- Rust: **the `armv7-unknown-linux-musleabihf` target does NOT enable NEON by
  default**: build with `RUSTFLAGS="-C target-cpu=cortex-a7 -C target-feature=+neon"`.
- camilladsp: use the `32bit` feature (float32 processing, recommended on 32-bit CPUs);
  **v4.1.3** (edition 2024, rust-version 1.90) is the target — no downgrade needed
  with Buildroot 2026.05.2.

### 2.3 Audio in the guest
1. **`virtio-snd`** (QEMU ≥ 8.x, `CONFIG_SND_VIRTIO`): emulated sound card —
   **primary option** for a pipeline that is as complete as possible. Host backends:
   - `driver=none`: presence/timing without real audio (headless/CI testing);
   - `driver=wav,path=out.wav`: captures to a wav file on the host what the guest
     plays → verifies the full audio chain;
   - `driver=pa`/`pipewire`: real listening on the host (interactive debugging, optional).
2. **`snd-aloop`** (kernel module `CONFIG_SND_ALOOP`): ALSA loopback entirely
   inside the guest, to chain sources (e.g. inferno PCM → aloop → camilladsp).
3. **No sound card**: `RawFile/WavFile → File` pipeline — fallback for basic DSP
   testing, no dependency on audio emulation.

### 2.4 Network
- Initial phase: user networking (`-netdev user`), with port forwarding
  (camilladsp websocket, TCP tests).
- Dante phase: **mDNS (224.0.0.251) + PTP (224.0.1.129) multicast** is unreliable
  over slirp → switch to **tap + bridge** on the host (`scripts/qemu-bridge.sh`).
- Inferno uses software timestamping (no hardware timestamping in virtio-net): OK.

### 2.5 Build system: **Buildroot 2026.05.2** (the simplest)
| Option | Verdict | Reason |
|---|---|---|
| **Buildroot 2026.05.2** | **chosen** | LTS-adjacent stable (2026.05.2, rust 1.90), simple and fast cross-build, minimal rootfs, `cargo` infrastructure for Rust packages, `multi_v7` defconfig + fragment |
| Yocto | rejected | Much steeper learning curve and longer build times for the same result |
| Minimal Debian | rejected | `debootstrap`/`multistrap` are not meant for cross-compiling firmware; large images; manual Rust packaging |

## 3. Repository layout

```
.
├── plan/                       # this plan + feature plans (each carries a
│                               #  **Status <date>**: header = status + last update)
├── buildroot/                  # git submodule: Buildroot 2026.05.2 (rust 1.90, kernel 6.12.x)
├── br-external/                # Buildroot external tree
│   ├── external.desc / external.mk
│   ├── configs/rk3506qemu_defconfig
│   ├── package/camilladsp/     # Config.in + camilladsp.mk (cargo, v4.1.3, musl)
│   ├── package/statime/        # fork teodly/statime, branch inferno-dev, pinned commit
│   ├── package/inferno/        # workspace teodly/inferno, recursive submodules
│   ├── package/ubox/           # OpenWrt ubox: kmodloader + validate_data + logd
│   ├── package/jsonfilter/     # OpenWrt jsonpath → jsonfilter
│   ├── package/ucode/          # OpenWrt ucode VM (required by netifd/procd/logd at current stable)
│   ├── package/udebug/         # OpenWrt udebug (required by procd/logd/netifd)
│   ├── package/procd/          # PID 1 + hotplug
│   ├── package/netifd/         # network: static IP + DHCP only (udhcpc, ucode proto)
│   └── board/rk3506qemu/       # kernel/busybox fragments, rootfs overlay, post-build
    │                           #  (modules flat, /var→tmp tmpfs layout, S95mpd purge)
    │   ├── linux.fragment      # SND_ALOOP, SND_VIRTIO, PTP_1588_CLOCK, PREEMPT, ...
    │   ├── busybox.fragment    # NTPD + FEATURE_AWK_LIBM
    │   ├── rootfs-overlay/     # /etc/inittab, OpenWrt init scripts, /etc/config/*
    │   └── genimage.cfg / post-image.sh   (optional, ext4 rootfs image)
├── configs/                    # source copies of configs (camilladsp yaml variants, see crossover doc)
├── deps/                       # pinned application sources (git submodules)
│   ├── camilladsp/             # tag v4.1.3 (musl)
│   ├── inferno/                # branch dev (recursive submodules)
│   └── statime/                # fork, branch inferno-dev
├── docs/                       # living docs (see README table): components,
│                               #  rig runbooks, patches.md inventory
│   ├── camilladsp.md           # DSP engine: package, runtime, UCI (chain nodes), tuning
│   ├── inferno.md              # Dante stack: statime+inferno, clock chain, UCI (statime+inferno)
│   ├── alsa.md                 # ALSA: device resolution, inferno plugin settings precedence
│   ├── crossover-to-camilladsp.md  # SB12 passive crossover → IIR filter analysis
│   ├── radio-over-dante.md     # full recipe: MPD web radio (guest internet on
│   │                           #  eth0) -> camilladsp -> Dante TX -> receiver
│   ├── bridge-rig.md           # preferred rig: native host statime grand
│   │                           #  master + taps + NAT (glitch-free, D15)
│   └── img/                    # plots/configs (crossover)
├── results/                    # dated milestone test reports (test-*.md)
│   └── test-two-guests-ptp.md  # M4 rootless two-guest PTPv2 test explained
├── scripts/
│   ├── build.sh                # make O=... BR2_EXTERNAL=... (+ host-shim for uutils install)
│   ├── run-qemu.sh             # --mem, --net user|tap|socket-listen|socket-connect|
│   │                           #  socket-mcast (rootless shared L2 segment over UDP
│   │                           #  mcast — host l2-node can join), --peer, --mac
│   │                           #  (statime rejects locally-administered MACs), --audio, --smp,
│   │                           #  --fwd HOST:GUEST (slirp hostfwd, loopback-only; exposes a
│   │                           #  guest port on the host, e.g. camilladsp ws on 5000)
│   ├── test-two-guests.sh      # M4 harness: PTPv2 master/slave + inferno capture
│   ├── test-audio-flow.sh      # M4 real-flow test: B TX -> Dante flow -> A RX
│   ├── dante-l2node.py         # host rootless L2 node on the mcast tunnel; speaks
│   │                           #  inferno's ARC protocol (subscriptions, UDP 4440);
│   │                           #  --direct SRC_IP = plain-UDP mode for the bridge rig
│   ├── qemu-bridge.sh          # bridge rig (D15): br-dante + tap0/tap1 + NAT for
│   │                           #  single-NIC guests; up|down (root, idempotent)
│   │                           #  (supersedes the qemu-tap.sh stub, D1)
│   ├── statime-gm.toml         # host grand master config (+ build recipe header)
│   ├── verify-fir.py           # M3 file→file pipeline verifier (numpy reference)
│   ├── camilladsp_xo_coeffs.py # crossover coefficient generator (see docs/crossover-*)
└── README.md                   # quickstart
```

## 4. Application packages (Buildroot)

### 4.1 `camilladsp`
- Buildroot **cargo** infrastructure; source **v4.1.3** (musl, edition 2024).
- Build: `cargo build --release` with NEON RUSTFLAGS (see 2.2) on
  `armv7-unknown-linux-musleabihf`.
- Features: default (`websocket`) + `32bit`; ALSA backend always included on Linux.
  No `libopenssl` needed (`secure-websocket` is off); host: `pkg-config`.
- Install: `/usr/bin/camilladsp`; config is **generated at runtime from uci into
  `/tmp`** (`/tmp/camilladsp.yml` + `/tmp/camilladsp.env` sidecar); no default
  file is shipped. Schema evolved from "simple devices" to **generic chain
  nodes** (`filter`/`mixer`/`mixroute`/`step`) — see docs/camilladsp.md.
- Default pipeline: `capture='Inferno'` → null playback (Dante-armed idle);
  reload via `service camilladsp reload` (regen + SIGHUP, no restart);
  `list env` passes extra env (INFERNO_*) to the daemon.
- No downgrade needed with Buildroot 2026.05.2 (rustc 1.90 ≥ 1.90 required).

### 4.2 `inferno`
- Repo with **recursive submodules** (`alsa-sys-all`, `searchfire`, `usrvclock-rs`):
  fetch with `--recursive` in the package download step.
- Binaries: `inferno2pipe` → `/usr/bin`.
- ALSA plugin: `alsa_pcm_inferno` → `.so` in `/usr/lib/alsa-lib/` +
  `/etc/asound.conf` defining the `inferno` virtual PCM.
- ~~Configuration via environment variables ... in the init script~~ →
  **superseded**: there is *no inferno init service and no daemon* — see
  the deviations log (§10, D3) and `docs/inferno.md`.

### 4.3 `statime` (PTP daemon, fork)
- Source: `teodly/statime` branch `inferno-dev`, **pinned commit** (not upstream).
- Binary: `/usr/bin/statime`; config fully uci-driven —
  `/etc/config/statime` (priority1, protocol, interface, virtual clock,
  usrvclock) rendered into `/tmp/statime.toml` at every start;
  **PTPv2 by default** (deviation D2).
  Started **before** any inferno consumer (required even for capture alone).

### 4.4 Kernel
- Linux LTS (the one of the chosen Buildroot release, e.g. 6.12.x) + `linux.fragment`:
  `CONFIG_SND_ALOOP`, `CONFIG_SND_VIRTIO` (optional), `CONFIG_PTP_1588_CLOCK`,
  `CONFIG_PREEMPT` (optional `PREEMPT_RT` in a later phase), multicast (default).
- Optional: `rt-tests` (cyclictest) to measure latency in the guest.

### 4.5 Init and system daemons (OpenWrt stack)
- **Pins — stable OpenWrt 25.12.5** (2025 stable branch, build-reproducibility;
  see `br-external/package/*/`.mk). `udebug` is kept: `procd` 25.12 hard-requires
  it (`#include <udebug.h>` + `HAS_UDEBUG` unconditionally), stripping would need
  invasive source patches. `ucode` is required by `netifd` (`proto-ucode`).

| Package | Commit (25.12.5) | Date | Rationale |
|---|---|---|---|
| libubox | `7dd1278` | 2026-06-19 | jshn.sh, libblobmsg_json, libjson_script |
| ubus | `24864e7` | 2026-06-28 | ubusd + libubus + CLI |
| uci | `66127cd` | 2025-12-02 | libuci + CLI + sh/uci.sh |
| ubox | `6f78fa4` | 2025-10-30 | kmodloader + validate_data + logd (logd now without udebug) |
| jsonfilter (jsonpath) | `b903421` | 2026-03-16 | `jsonfilter` binary (rc.common / network.sh) |
| ucode | `8592205` | 2026-01-16 | VM for netifd ucode protos |
| udebug | `875e1a7` | 2026-01-16 | procd tracing + netifd (kept, see note) |
| procd | `58eb263` | 2026-03-13 | PID 1; requires udebug (see note) |
| netifd | `cbb83a1` | 2026-02-26 | requires ucode (+ udebug) |

- **procd** as PID 1: kernel `/sbin/init` → procd initd (early mounts,
  kmodloader attempt [absent, non-fatal], `/etc/preinit`) → `/sbin/procd`
  (spawns `/sbin/ubusd` itself, reads `/etc/inittab`).
- procd executes `/etc/init.d/rcS S boot` internally: runs `/etc/rc.d/S*`
  sequentially with param `boot`, `/etc/rc.d/K*` with `shutdown` → init
  scripts use OpenWrt `rc.common` (START=/STOP=, USE_PROCD, `procd_open_instance`
  / `procd_set_param respawn`).
- **ubus/ubusd** IPC bus, **uci** config (`/etc/config/*`).
- **netifd**: scope limited to **static IP + DHCP client** (busybox `udhcpc`);
  proto handlers `dhcp.sh`/`dhcp.script` from netifd packaging, `static` is
  built-in. `ifup/ifdown/ifstatus/ifreload` wrappers included.
- **sysv-compat bridge**: Buildroot's own `/etc/init.d/S??*` scripts expect
  busybox init (`start`/`stop`); our `S00sysv-compat`/`K99sysv-compat` runs
  them under procd and loads `/etc/modules`.
- Hotplug/coldplug handled by procd (no mdev/udev).
- Application services (statime, camilladsp, inferno-demo) as procd init
  scripts with respawn → automatic supervision.

## 5. Work phases (milestones + acceptance criteria)

### M0 — Host environment (0.5 d) — **DONE**
- Ubuntu 26.04 needs a GNU `install` shim (`scripts/host-shim/`) because
  Buildroot 2025.02 rejects uutils install.

### M1 — Booting baseline (0.5–1 d) — **DONE**
- Kernel 6.12.27 `multi_v7` (no arm32 `virt_defconfig` exists) + fragment;
  musl hard-float, cortex-a7/NEON/VFPv4 verified in the guest.
- Boot to shell, CPU features `neon vfpv4`, clean poweroff.

### M2 — OpenWrt system stack: procd/ubus/uci/netifd — **DONE**
- The heart of the firmware; application milestones depend on it.
- CMake packages (external tree), pinned commits (see 4.5):
  `json-c` (Buildroot) → `libubox` → `ubus` → `uci` → `procd` → `netifd` → `libnl`.
- procd as PID 1; rootfs overlay with OpenWrt glue (rc.common, functions.sh,
  procd.sh, uci.sh, netifd-proto.sh, dhcp.sh/dhcp.script, network init script)
  copied from openwrt.git/base-files + procd/netifd packaging (GPL-2.0),
  plus our minimal `/etc/inittab`, `/etc/preinit`, `/etc/rc.d` symlinks and a
  `sysv-compat` bridge running Buildroot's S-scripts under procd.
- Network via netifd: `/etc/config/network` (loopback + eth0 DHCP via udhcpc;
  static variant for tap/bridge). NIC layout since D11: eth0 = management
  (slirp, DHCP + internet, present on every boot), eth1 = Dante/PTP segment
  (rig mode only, static IP per rig, `network.aoip` proto none by default).
- **Verified (DoD)**: procd is PID 1; `ubus list` shows service/system/network.*;
  `uci show network`; eth0 = 10.0.2.15 via DHCP + default route + resolv.conf
  (netifd-written); `kill -9 netifd` → procd respawn + interface re-established.
- **Lessons** (encoded in the overlay): kernel mounts root ro → `rw` cmdline;
  procd needs `/etc/hotplug.json` (else open() loop); askconsole for the active
  console; Buildroot wipes /run,/tmp at image build → preinit recreates
  /run/lock + /tmp/resolv.conf.d; glue scripts must be era-matched
  (openwrt-23.05 base-files/procd.sh/uci.sh + netifd's own scripts);
  `uci_validate_section` stubbed (no /sbin/validate_data); QEMU runs with
  `-snapshot` so test boots never mutate the golden image; netifd package
  installs scripts/{netifd-proto.sh,utils.sh} + files/{dhcp.sh,dhcp.script}.
- **Round 2 fixes**: `jsonfilter` (jsonpath @ `b903421`, 25.12.5) packaged;
  uci CLI moved to /usr/sbin (wrappers hardcode /sbin/uci; uci.sh is the 23.05
  one defining uci_get); **ubox** packaged (@ `6f78fa4`, 25.12.5) with the real
  kmodloader + validate_data; kernel modules flattened OpenWrt-style in
  post-build.sh + modules.dep regenerated; /etc/hotplug.d and
  /etc/config/system shipped; `service`/`reload_config`/`ifstatus`/`devstatus`
  added. `udebug` was investigated for stripping — `procd` 25.12 hard-requires
  it (`procd.h:#include <udebug.h>` + `HAS_UDEBUG`), so the tiny lib
  (`875e1a7`) is kept; `ucode` (`8592205`, needed by netifd) is added.
  Running a second netifd manually fails with "Failed to publish object:
  Invalid argument" — ubusd rejects duplicate object names (use
  /etc/init.d/network restart).
- **Round 3 (pure procd init)**: dropped the sysv-compat bridge entirely —
  post-build removes Buildroot's S-scripts; the firmware now uses the real
  OpenWrt init scripts as procd services: `boot` (adapted: no
  config_generate/mount_root), `sysctl`, `sysfixtime`, `system` (hostname/TZ),
  `log` (ubox logd/logread re-enabled via UBOX_BUILD_LOGGING), `sysntpd`
  (busybox ntpd, enabled via busybox.fragment), `done` (rc.local, adapted),
  `umount`; enabled via /etc/rc.d symlinks (S<START>/K<STOP> naming).
  Console: `::askconsole:/usr/libexec/login.sh` + /etc/profile with
  `root@host` PS1 + /etc/motd. procd built with full
  EARLY_PATH=/usr/sbin:/usr/bin:/sbin:/bin (services/protos must find
  /usr/bin helpers). busybox fragment enables NTPD, IPCALC and
  FEATURE_AWK_LIBM (ipcalc.sh is an awk script using and()/rshift());
  ipcalc.sh (base-files) installed by the netifd package (dhcp.script needs
  it). Overlay must NOT duplicate package files (rsync overlays override
  package installs).
- **Round 4 (polish)**: busybox `ipcalc` applet dropped (OpenWrt's awk-based
  `ipcalc.sh` from base-files is the one used by dhcp.script, installed by the
  netifd package); `/etc/uci-defaults/` run-once mechanism active (dir created
  empty in post-build — a placeholder file would be executed and deleted by
  boot's uci_apply_defaults; verified with a marker script).
- **Round 5 (udebug cleanup, final patch state)**: udebug stays a hard
  dependency (Config.in `select BR2_PACKAGE_UDEBUG`); the half-baked
  "optional-udebug" patches (procd 0001/0002, netifd 0001/0002) were deleted —
  netifd's never defined `HAS_UDEBUG`, breaking the build. Final: **procd =
  vanilla 25.12.5, no patches**; netifd has one patch
  `0001-no-libnl-udebug.patch` guarding `nl_udebug_cb` + the
  `nl_socket_set_{tx,rx}_debug_cb` calls (OpenWrt-only libnl hooks absent from
  upstream libnl) under `HAS_LIBNL_UDEBUG` (never defined). ubox's
  `0001-cmake-build-options.patch` regenerated against the pinned source (logd
  links `udebug` in 25.12.5; one `IF(UBOX_BUILD_LOGGING)` covers logd+logread).
  Lesson: Buildroot applies patches with fuzz 0 — patches must be regenerated
  mechanically from the pristine tarball, never hand-written. M2 DoD re-run
  after cleanup: all green (respawn PID 281→461, lan `up=1`).

### M3 — camilladsp package (1–2 d) — **DONE**
- Cargo package + config overlay + init script.
- Package: `br-external/package/camilladsp` (v4.1.3 pin `05e9cfc`, cargo infra with
  custom build: NEON RUSTFLAGS `target-cpu=cortex-a7 -C target-feature=+neon
  -C target-feature=-crt-static`, `--features 32bit`, no Cargo.lock in tag →
  network build, vendoring disabled).
- **v4 API changes vs docs found the hard way**: config file is a **positional**
  arg (`-c` is now `--check`!); playback WavFile/RawFile merged into `File`
  (with `format` + `wav_header`); **no Null device** — use
  `RawFile:/dev/zero` → `File:/dev/null` as idle pipeline; format enums are
  `S16_LE`/`F32_LE` (not S16LE/FLOAT32); websocket port is CLI-only
  (`-p PORT -a ADDR`).
- uci integration: `/etc/config/camilladsp` + `/usr/bin/camilladsp-genconf`
  (uci → /tmp/camilladsp.yml; device specs `TYPE:VALUE`, optional gain dB +
  FIR text coeffs per channel); procd init `/etc/init.d/camilladsp`
  (START=75, respawn, stdout/stderr → logd).
- Test assets: `/usr/share/camilladsp/{test.wav,fir.txt}` (3 s stereo S16LE
  deterministic sines; 9-tap FIR), verifier `scripts/verify-fir.py`
  (float32 reference; own RIFF parser — python-wave can't read IEEE-float wavs).
- **Verified (DoD)**: `--help` shows "Built with features: websocket, 32bit";
  `--check` exit 0; file→file Gain(-3 dB)+FIR: 132300/132300 samples,
  maxdiff 8.9e-08 (PASS, numpy f32 reference); websocket 101 handshake via
  hostfwd :5000; service supervised by procd (`service camilladsp restart`
  regenerates config); busybox `nc` enabled for guest→host exfil (slirp
  10.0.2.2, minimal NC applet takes only `IP PORT` — no `-w`).
- aloop→aloop soak: **PASS** — ≥10 min, 0 XRUN/underrun/overrun in logread,
  PID stable (no respawn), VmRSS 5544 kB (first datapoint for M5.5).
- **Generic UCI chain (post-M3, for the final product)**: no special modes —
  the audio path is multi-node uci: `config filter` (gain/conv/hp/lp/lrhp/
  lrlp/hs/ls/peak/notch/ap), `config mixer`+`config mixroute` (routing
  matrix, linear gains; L/R/Mix recipes), `config step` (pipeline ordered by
  index, Filter/Mixer). `output_channels` on main when the chain changes the
  channel count. Web-UI EQ will be inserted live via websocket as extra
  Filter steps between mixer and crossover (future). Verified end-to-end in
  QEMU (2-way Mix + LR4 crossover: config valid, run OK). Host-side uci stub
  (/tmp/opencode/uci-stub.sh) enables fast genconf testing without QEMU.
  Docs: `docs/camilladsp.md`.
- Note: exfil listeners in stacked `nc -l` sessions hold the port — use a
  fresh port per attempt.

### M4 — statime + inferno packages (2–3 d) — **DONE (incl. real audio flows)**
- Packages built (cargo, NEON RUSTFLAGS, network builds, vendoring off):
  - `statime` @ `244f20a` (inferno-dev fork, `GIT_SUBMODULES=YES` for
    clock-steering/timestamped-socket forks; **usrvclock re-pinned to
    `53116cb`** via `cargo update` pre-build hook — the locked `24da792`
    does not compile on 32-bit).
  - `inferno` @ `75d9198` (dev branch, submodules alsa-sys-all/searchfire/
    usrvclock-rs): installs `/usr/bin/inferno2pipe` +
    `/usr/lib/alsa-lib/libasound_module_pcm_inferno.so`.
- Overlay: fully uci-driven statime config (`/etc/config/statime`,
  init renders `/tmp/statime.toml`, S60) + `/etc/asound.conf`
  (`pcm.inferno` parameterless for `-L` listing + `pcm.inferno2` with
  @args; `CLOCK_PATH /tmp/ptp-usrvclock`).
- **Architecture decision — no inferno daemon (deviation D3)**: every
  application that opens the `inferno` PCM hosts its own inferno instance
  in-process. Shared instance settings live in `/etc/config/inferno`
  (name ← system hostname, interface, clock_path, rx/tx channel counts
  with 0-fallback when the respective side isn't `Inferno`); genconf
  derives them into `/tmp/camilladsp.env` and the camilladsp init script
  exports them to the daemon. `/usr/bin/inferno2pipe` remains installed
  as a manual sniffer only — no init script, no autostart.
- **camilladsp default = Dante-armed**: `capture='Inferno'`,
  `playback='File:/dev/null'` — records network silence until flows are
  subscribed; statime (S60) always precedes camilladsp (S75), and the
  plugin waits for the clock anyway.
  `/etc/asound.conf` (`pcm.inferno` parameterless for `-L` listing +
  `pcm.inferno2` with @args; `CLOCK_PATH /tmp/ptp-usrvclock`).
- **QEMU MAC lesson**: statime's `get_clock_id` rejects locally-administered
  MACs (QEMU default `52:54:00:...`) → run-qemu.sh pins
  `mac=00:11:22:33:44:55`.
- **Verified (slirp)**: statime runs (port Listening→Master, kalman stepping
  the virtual clock, `/tmp/ptp-usrvclock` exported); `arecord -L` lists the
  inferno PCM; `arecord -D inferno` loads the plugin, negotiates HW params
  and reaches **clock ready**; inferno2pipe runs supervised via uci+procd.
- **Blocked on slirp (by design, plan 2.4)**: no PTPv1 SYNC on the wire —
  statime "master in PTPv1 not implemented", so the plugin never gets a
  start time → no samples (arecord exits 1, no file). **Solved rootless**:
  switched to **PTPv2** (statime fully implements master+slave; uci
  `/etc/config/statime` renders `priority1`/`protocol` into
  /tmp/statime.toml) and linked two QEMU instances with
  `-netdev socket` (listen/connect on 127.0.0.1 — L2 pipe, multicast
  included, no root needed): guest B (static 198.18.100.2, priority1=128)
  = PTPv2 GrandMaster, guest A (.1, default 251) = Slave (kalman-locked).
  Harness: `scripts/test-two-guests.sh` (docs: `results/test-two-guests-ptp.md`,
  implementation notes: `docs/inferno.md`).
  **Gotcha**: on the isolated link (no default route) the inferno
  `local_ip_address` autodetect panics (`LocalIpAddressNotFound`) → pass
  `INFERNO_BIND_IP=<ip|iface>`.
  **Verified**: `arecord -D inferno -d 8` → RC=0, 8.000 s of PTP-clock-timed
  silence captured (plugin logs: clock_receiver updated / media_clock
  overlay updated / clock appeared). **Real flows DONE** (rootless, no
  `netaudio`/pip needed): `scripts/test-audio-flow.sh` — B
  (master + `RawFile→Inferno` TX) streams 48 s of the M3 test signal to A
  (slave + `Inferno→File` RX); the subscription is created from the host by
  `scripts/dante-l2node.py`, a rootless virtual L2 node on the QEMU mcast
  tunnel (`run-qemu.sh --net socket-mcast`) speaking inferno's ARC protocol
  (opcode 0x3010, UDP 4440) directly; received per-second fingerprints
  match the source exactly on both channels (docs: `results/test-audio-flow.md`).
  `dockerized_trx` still deferred (needs bridging/root).
- Rootfs grew past the default ext2 size → `BR2_TARGET_ROOTFS_EXT2_SIZE=256M`.

### M4.5 — Audio in the guest (0.5 d) — late, after the applications
- Kernel fragment + `alsa-lib`/`alsa-utils` in the rootfs; `snd-aloop` and `virtio-snd`.
- Run script with audio backends `driver=none` and `driver=wav` (host capture).
- **DoD**: `aplay -l` lists the cards (aloop and virtio-snd); playing a wav to the
  virtio-snd device with the `wav` backend produces an audio file on the host;
  ping from the host via user-net; websocket port forwarding (e.g. 5000) verified
  with `nc`.

### M5 — Integration and documentation (1 d)
- Both applications active at the same time (e.g. camilladsp capturing from the
  inferno PCM via aloop); automated test script (`scripts/test.sh`) running the
  M1–M4 DoD checks; README with quickstart; license notes (GPLv3/AGPLv3 inferno —
  incl. Audinate patent notice; GPLv3/MPL2 camilladsp).
- **DoD**: from scratch: `./scripts/build.sh && ./scripts/run-qemu.sh && ./scripts/test.sh` green.

### M5.5 — Memory matrix and full pipeline (1 d)
- Run the M3/M5 tests on the **128/256/512 MB** RAM profiles (`run-qemu.sh --mem`).
- Full pipeline with virtio-snd (see 6.3) + wav capture on the host.
- Measurements per profile: `MemAvailable`/`MemFree` at idle, RSS of processes
  (`statime`, `camilladsp`, `inferno`, procd stack), OOM events (`dmesg`),
  audio XRUN/underflow → report `results/memory-matrix.md`.
- **DoD**: boot and services active at 128 MB (or documented failure with cause
  and actual threshold); virtio-snd→camilladsp→wav pipeline verified on at least
  one profile; complete memory table with a minimum RAM recommendation for the
  final hardware.

### M6 — Optional extensions
- PREEMPT_RT + cyclictest (latency), NEON benchmarks (camilladsp FFT with/without
  `+neon`), zram as a swap variant, read-only rootfs, CI (GitLab/GitHub Actions)
  with build+boot tests.

## 6. QEMU virtual hardware

### 6.1 Virtual machine topology

| Component | QEMU option | Notes |
|---|---|---|
| CPU | `-cpu cortex-a7 -smp 3` | 3 cores like the RK3506, NEON/VFPv4 |
| RAM | `-m 128M` / `256M` / `512M` | test profiles, see 6.2 |
| Disk | `-device virtio-blk-device` | ext4 rootfs |
| Network | `-device virtio-net-device` | `-netdev user` or tap/bridge |
| Audio | `-device virtio-sound,audiodev=snd0` | backend `none`/`wav`/`pa` (see 2.3) |
| Console | `-nographic` on `ttyAMA0` (PL011) | |

### 6.2 Memory matrix (128 / 256 / 512 MB)
Purpose: understand how the libraries and services behave as the available RAM
changes, to estimate the minimum firmware RAM on the final hardware.
- **Parameters observed per profile**:
  - complete boot with all services active;
  - `MemAvailable`/`MemFree` at idle (`/proc/meminfo`);
  - RSS of processes: statime, camilladsp, inferno, procd/netifd stack;
  - OOM killer events (`dmesg | grep -i oom`) and killed services;
  - XRUN/underflow during the audio pipeline (they worsen under memory pressure
    due to page faults / reclaim);
  - effect of `mlockall` (realtime path: locks pages in RAM and reduces the
    memory available to the rest).
- **ARM32 notes**: up to 512 MB all RAM fits in lowmem (no highmem);
  no swap in the base configuration — consider zram as a variant (M6);
  also include loading large FIR coefficient sets in the test (page cache).
- **Tuning knobs** under pressure: camilladsp `chunksize` and FIR length,
  `32bit` feature (halves in-memory buffers), inferno RX/TX channel count and
  `RX/TX_LATENCY_NS` (ring buffer size).
- Output: `results/memory-matrix.md` table with the recommended minimum
  configuration for the final hardware.

### 6.3 Full pipelines with virtio-snd
- Chain closest to real hardware: `virtio-snd (capture) → camilladsp (DSP)
  → virtio-snd (playback)`, with host capture via the `wav` backend for verification.
- Dante variant: `inferno (Dante RX) → aloop → camilladsp → virtio-snd`.

### 6.4 Kernel configuration
- **Strategy**: start from the kernel config that Buildroot's `qemu_arm_virt`
  reference uses (all virtio drivers already enabled) and apply our fragment:
  `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="board/rk3506qemu/linux.fragment"`
  (in the repo: SND_ALOOP, SND_VIRTIO, PTP_1588_CLOCK, PREEMPT).
- **Stabilization**: once M1–M2 pass, run `make linux-update-defconfig`, store the
  full defconfig as `board/rk3506qemu/linux_linux.defconfig` and switch to
  `BR2_LINUX_KERNEL_USE_CUSTOM_CONFIG` → fully reproducible, no merge surprises.
- **Verification (DoD M2)**: `zcat /proc/config.gz | grep -E 'SND_VIRTIO|SND_ALOOP|PTP_1588'`.
- Optional tunings (evaluate in M6): `HZ_1000`/`PREEMPT_RT`, `DEVTMPFS`,
  `HIGHMEM` not needed (≤512 MB), `CC_OPTIMIZE_FOR_SIZE`.

### 6.5 Device tree
- **QEMU `virt` auto-generates the DTB** at every boot from `-cpu`, `-m` and the
  `-device` options, and passes it to the kernel with `-kernel` direct boot.
  → **No custom DTS is needed or wanted**: the DTB always matches the emulated
  hardware (RAM size, virtio-snd presence, CPU features incl. NEON).
- **Do NOT pin a static DTB**: it would break when switching memory profiles
  (128/256/512 MB matrix) or adding/removing virtio devices.
- Debugging: `qemu-system-arm -M virt,dumpdtb=virt.dtb ...` + `dtc -I dtb -O dts virt.dtb`
  to inspect what the guest actually sees.
- **RK3506 final hardware**: uses the vendor BSP/mainline `rk3506*.dts` (real
  I2S audio codec, GMAC Ethernet, SPI NAND/eMMC, watchdog). That layer is out of
  QEMU scope; what we validate on QEMU is everything above the DT (rootfs,
  services, applications).

### 6.6 Flash / image layout
Two build modes:

**Mode A — direct boot (default, dev + CI)**
- QEMU loads the kernel directly (`-kernel zImage`), rootfs as a raw ext4 on
  `virtio-blk`. No bootloader, no partition table. Artifacts: `zImage` + `rootfs.ext4`.
- Fastest, keeps `run-qemu.sh --mem` trivially profile-independent.

**Mode B — partitioned disk image (closer to final hardware, optional)**
- Single `sdcard.img` built with genimage (`board/rk3506qemu/genimage.cfg` +
  `post-image.sh`, skeletons in the repo), GPT layout mirroring Rockchip eMMC:

| Region | Offset | Content | Notes |
|---|---|---|---|
| IDBlock | sector 64 (32 KiB) | `idbloader.bin` (TPL+SPL) | read by the Rockchip Boot ROM — placeholder on QEMU |
| U-Boot | sector 16384 (8 MiB) | `u-boot.itb` | placeholder on QEMU |
| p1 `boot` | 16 MiB | ext4: `zImage`, `rk3506.dtb`, `extlinux.conf` | |
| p2 `rootfs` | — | ext4 rootfs (squashfs variant for read-only, M6) | |

- On QEMU the Boot ROM path cannot be exercised; Mode B validates the image
  build pipeline and gives deployable artifacts. Exact offsets for the RK3506
  differ between SPI NOR / SPI NAND / eMMC → confirm against the BSP when
  moving to real hardware.
- Optional (M6): actually boot the chain on QEMU `virt` via U-Boot
  (`qemu_arm` defconfig exists in U-Boot; CFI flash via `-pflash` or `-bios`).

## 7. Reference commands

```sh
# Build
./scripts/build.sh            # make O=output BR2_EXTERNAL=$PWD/br-external rk3506qemu_defconfig && make

# Run (base, 512M profile)
qemu-system-arm -M virt,highmem=off -cpu cortex-a7 -smp 3 -m 512M -nographic \
  -kernel buildroot/output/images/zImage \
  -append "console=ttyAMA0,115200 rootwait root=/dev/vda" \
  -netdev user,id=eth0,hostfwd=tcp::5000-:5000 \
  -device virtio-net-pci,netdev=eth0 \
  -drive file=rootfs.ext4,if=none,format=raw,id=hd0 \
  -device virtio-blk-device,drive=hd0

# Run (128M profile + virtio-snd audio captured to a host wav)
qemu-system-arm -M virt,highmem=off -cpu cortex-a7 -smp 3 -m 128M -nographic \
  -kernel buildroot/output/images/zImage \
  -append "console=ttyAMA0,115200 rootwait root=/dev/vda" \
  -netdev user,id=eth0,hostfwd=tcp::5000-:5000 \
  -device virtio-net-pci,netdev=eth0 \
  -drive file=rootfs.ext4,if=none,format=raw,id=hd0 \
  -device virtio-blk-device,drive=hd0 \
  -audiodev wav,id=snd0,path=/tmp/guest-out.wav \
  -device virtio-sound,audiodev=snd0
# (headless audio without a file: -audiodev none,id=snd0)
# (equivalent: ./scripts/run-qemu.sh --mem 128 --audio virtio-snd-wav)
```

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| rustc < 1.85 in the chosen Buildroot release | camilladsp build fails | pick a recent LTS / pin an older camilladsp / external host rust; alternatively the official prebuilt `camilladsp-linux-armv7` binary (NEON) for smoke tests only |
| NEON not enabled in the Rust binaries | test not representative | explicit RUSTFLAGS + runtime verification (`/proc/cpuinfo`, `--version` features, benchmarks) |
| Multicast (mDNS/PTP) over slirp | Dante discovery does not work | dedicated tap + bridge (`scripts/qemu-bridge.sh`, D15) |
| Non-upstream statime fork | build drift | pinned commit in the package |
| `virtio-snd` missing/slow in the host QEMU version | emulated audio test impossible | `none`/`wav` backends need no host audio; otherwise `snd-aloop` or file→file pipelines |
| OOM at 128 MB (Rust apps + mlockall + large FIRs) | killed services / XRUNs | M5.5 memory matrix: tune chunksize/FIR/channels, `32bit` feature, zram as a variant |
| Forgotten inferno submodules | build fails | `--recursive` fetch in the package + CI check |
| Build time/size (Rust + musl) | ~30–60 min, ~15 GB disk | build in a separate `output/`, Buildroot download cache; musl shrinks the rootfs |
| Porting procd/ubus/uci/netifd (not upstream in Buildroot) | extra time | daemons designed for musl (our libc); netifd scope limited to static+DHCP; patches expected only for paths/install |

## 9. Summary estimates
- Total effort: ~7–11 days (M0–M5.5, incl. M4.5), M6 excluded.
- Host resources: ≥ 4 GB RAM for the build, ~15 GB disk; guest 128–512 MB
  depending on the memory matrix.
- Output: `zImage` + `rootfs.ext4` + reproducible run/test scripts.

## 10. Deviations and decision log

Chronological log of deliberate departures from the original plan, with
the reasoning — so future readers know *why* the firmware looks the way
it does.

| # | Original plan | What we did | Why |
|---|---|---|---|
| D1 | tap + bridge (`qemu-tap.sh`) for multicast/PTP testing | **rootless QEMU socket link** (`-netdev socket,listen/connect`) between two instances; `qemu-tap.sh` stays a stub | dev host has no root; the socket link carries full L2 incl. multicast and satisfies every Dante test so far. tap remains the path for real-network/`dockerized_trx` tests |
| D2 | statime PTPv1 config (Dante heritage) | **PTPv2 default** (`/etc/config/statime` `protocol`), PTPv1 selectable | the statime fork cannot *act as master* in PTPv1; with only our instances on the wire nothing would ever sync. PTPv2 implements full BMCA master/slave. Real Dante networks (hardware devices master PTPv1) → switch `protocol` back |
| D3 | inferno config via `INFERNO_*` env in an init script (inferno2pipe as the service) | **no inferno service at all**: instances live *inside the opening application* (camilladsp hosts one when it opens the `inferno` PCM). Shared settings in `/etc/config/inferno`, derived by `camilladsp-genconf` into `/tmp/camilladsp.env`; `inferno2pipe` kept only as a manual sniffer | the ALSA plugin *is* the inferno instance — a separate daemon would just duplicate one (and Dante identities must be unique per instance). The init-script daemon made no sense outside debugging |
| D4 | camilladsp config "generated at runtime from uci" (simple key→YAML mapping) | full **chain-node schema**: `config filter` / `mixer` + `mixroute` / ordered `config step` | a multi-way speaker needs routing matrices and per-way filter chains; a flat key list cannot express them. Node structure mirrors camilladsp's own model 1:1 |
| D5 | camilladsp idle default `RawFile:/dev/zero → File:/dev/null` | default `capture='Inferno'` (armed Dante), null playback | the product *is* a Dante receiver: armed by default, silent until flows are subscribed; harmless without a network |
| D6 | inferno2pipe `RX_CHANNELS`, `NAME` etc. as free-form env in scripts | **shared schema** `/etc/config/inferno` + new `Inferno` device type in camilladsp; consistency rules (rx = capture `channels`, tx = playback `output_channels` or 0, Fs = `samplerate`, name = system hostname) | schema is defined in one place; camilladsp and inferno can never drift apart on channel counts or Fs |
| D7 | udebug stripping | udebug kept as hard dependency | procd 25.12 hard-requires it (see M2 round 2) |
| D8 | (docs) plan §3 layout had no docs/ | documentation set lives in `docs/`: camilladsp.md, inferno.md, alsa.md, test-two-guests-ptp.md, crossover-to-camilladsp.md | implementation references next to the plan |
| D9 | infinite procd respawn (or manual restart) for camilladsp on clock-less boots | **ptp-monitor** ucode daemon (S80): speaks the usrvclock datagram protocol, publishes ubus object `ptp` + events, and triggers procd's hotplug dispatcher (`ubus call hotplug.ptp call`) with `ACTION=locked/lost`; camilladsp policy lives in `/etc/hotplug.d/ptp/10-camilladsp` | no-master boots made camilladsp crash-loop out under procd and never recover; the usrvclock socket only carries updates while statime's servo tracks a master, so it is a precise lock signal. Emitter/handler split keeps the monitor service-agnostic (any consumer can subscribe via hotplug or ubus); procd 25.12 has no `/sbin/hotplug-call` binary — the inotify ubus dispatcher is the native mechanism |
| D10 | stock statime fork behaviour (grandmaster never exports usrvclock) | **0001-export-usrvclock-overlay-while-master.patch**: 1 Hz task re-sends the last overlay while any port is Master (identity overlay initially; holdover parameters after slave→master) | upstream exports only from servo actions, so a leading or lone node cannot host inferno instances (plugin: `no clock available`, ETIMEDOUT). With the patch a lone PTPv2 node self-clocks — camilladsp boots standalone — and ptp-monitor's "updates" semantics become "valid clock source (leading or following)". Upstream conversation with the fork author pending (internal draft kept outside the repo). |
| D11 | original script: single NIC, PTP/Dante on eth0; internet via optional `--net2 user` (eth1) | **reversed layout**: eth0 = slirp management on EVERY boot (DHCP + internet; slirp auto-attached in rig mode, no hostfwd there to avoid port collisions between background guests), eth1 = the `--net` PTP/Dante backend (statime+inferno bind it; `network.aoip` proto none; static IP per rig via uci in scripts/test-*.sh). `--net2` removed | three bugs made the old layout unworkable with two NICs: (1) virtio-mmio slots are allocated top-down → names reversed vs. cmdline; (2) QEMU ≥ 9 places the PCIe ECAM above 4 GB, unreachable for our non-LPAE 32-bit kernel (`pci-host-generic` probe fails -EOVERFLOW) → fixed with `-M virt,highmem=off` + `virtio-net-pci` (deterministic cmdline-order naming); (3) a multicast MAC (bit0 of first octet, e.g. `55:...`) leaves the virtio carrier DOWN → script validates both MACs. Management-on-eth0 also gives every rig guest internet for free (MPD radio, package fetches) |
| D12 | — | **https web-radio in MPD**: `BR2_PACKAGE_LIBCURL_OPENSSL` + `BR2_PACKAGE_CA_CERTIFICATES` (NOT mbedtls); `mpd-ctl play <url>` = add+play; `libcurl-dirclean` required after flipping the TLS choice | libcurl defaults to TLS_NONE (every https "Unsupported URI scheme"); Buildroot's liburl.mk wires `--with-ca-bundle` only for the openssl/wolfssl branches — with mbedtls libcurl has NO trust store and verify always fails ("certificate is not correctly signed by the trusted CA"; `CURL_CA_BUNDLE` env does NOT help, it is a curl-CLI feature, not libcurl); and Buildroot does not re-run configure on Config.in flips — `make libcurl-dirclean` before rebuilding. Validated: https Icecast MP3 → decode → ALSA `loopplay` → snd-aloop → camilladsp `Alsa:loopcap` → WAV with real audio. NB under TCG emulation MPD logs "Decoder is too slow" and the CDN eventually drops the TLS stream (~30 s) → MPD stops (no stream retry); re-issue `mpd-ctl play` — on real silicon decode outpaces the stream |
| D13 | — | **rate-agnostic source, rate-locked chain**: MPD output format-locked `48000:16:2` (resamples any source; native-48k passthrough) + `BR2_PACKAGE_MPD_LIBSNDFILE` for wav files | `auto_resample "no"` in the old mpd.conf silently BYPASSED the `format` lock (source rate went straight into the aloop → pitch shift on mismatch) — removed; and since MPD 0.24 wav parsing exists ONLY in the libsndfile plugin (the pcm decoder is MIME-only, no suffixes — retro-explains the M4-era "update indexes 0 songs" for .wav). Verified: 44.1 kHz wav local file → `audio: 44100:16:2` but aloop hw_params `rate: 48000`. wav over plain HTTP still fails ("Seek failed: Not seekable" — libsndfile needs Range support, python http.server has none); local files or radio streams are the supported paths |
| D14 | — | **PTP jitter diagnosis (rig)**: statime nice -10 via procd in init.d/statime; chunksize 2048 in the radio recipe; lean-guest discriminator method documented | glitchy sink audio traced by elimination on the live rig: (1) lean statime-only third guest saw the same ±1 ms noise → sink exonerated; (2) MPD paused → noise unchanged → radio decode exonerated; (3) camilladsp stopped ON THE SOURCE → spikes gone (offsets ±1.3 ms→ +250..585 µs slow-varying, delays 1.9 ms→0.5 ms, freq swings ±80 ppm→±1) → the master's camilladsp/inferno-TX load delays its own Sync TX timestamps. Residual ~300-500 µs slow-varying = QEMU mcast tunnel/host baseline = emulation ceiling (gentle servo corrections, not glitches). Low average CPU% does NOT imply good timestamp punctuality |
| D15 | — | **bridge rig with native host grand master**: `scripts/qemu-bridge.sh` (br-dante 198.18.100.254/24 + tap0/tap1 + NAT → single-NIC guests with internet via `--no-mgmt`), `scripts/statime-gm.toml` (build recipe in its header: fork statime on x86, `~/.local/bin/statime-gm` + setcap cap_net_bind_service,cap_net_admin; fork quirks: eager `unwrap_or` needs a local unwrap_or_else patch, /dev/ptp avoided via virtual-system-clock, explicit identity because bridge MACs are locally-administered), `run-qemu.sh --net tap:ifname`, `dante-l2node.py --direct SRC_IP` (plain-UDP subscribe on the bridge) | eliminates the last two rig noise sources (TCG master + UDP mcast tunnel) to isolate slave-side RX timestamping. Verdict: idle guest on bridge = +90..400 µs stable; loaded guest (camilladsp running) = ±1 ms + kalman resets AGAIN — i.e. the remaining noise is the guest's own software RX timestamps delayed by TCG translation of the DSP/PCM busy-poll. Every isolated noise component traces to "software timestamps inside a translated guest" — nothing indicts the stack or the RK3506 plan: on silicon, kernel RX timestamps are µs-class under load and a PTP-capable MAC (RK3506 dwmac) makes them load-independent. NB setcap is ignored on /tmp (nosuid); single-NIC guests enumerate their only NIC as eth0 → set network.aoip.device/statime.main.interface/inferno.main.interface to eth0 (auto-fix pending) |
| D16 | — | **sink capture busy-poll RESOLVED architecturally**: overlay `aoip-bridge` (S96: `inferno2pipe --output /tmp/aoip.fifo`) + sink uci `capture='RawFile:/tmp/aoip.fifo'` `format='S32_LE'` — Dante flows land in a kernel FIFO and camilladsp blocks on real reads (leanest of three tested variants: inferno-PCM 845, aloop-bridge 39, FIFO 38 ticks/8 s). The inferno package patch (`0001-capture-poll-period-level.patch`, PERIOD_POLL flag incl. `pcm.inferno_legacy` A/B) stays for upstream: flows_rx notification throttle (wall-clock, per period), eventfd self-drain in plugin_pointer, period-level revents with SIGNED hw-appl gate | diagnosis trail: the spin is camilladsp's own capture loop — it polls RAW descriptors (no snd_pcm_poll_descriptors_revents, alsa_backend/utils.rs:420) so the plugin's eventfd stays counter-mode-readable forever once written; readi then returns 5-19-frame dribbles of the media-clock advance (~6000 reads/s, one pegged core). THREE plugin-side fixes (notification throttle, self-drain, signed-diff revents gate) changed nothing — the raw-poll bypass defeats them all. The aloop bridge sidesteps the userspace PCM entirely: AlsaCapture 845 → 39 ticks/8 s (~10x), audio identical. Upstream conversation: camilladsp should call poll_descriptors_revents, and/or the plugin should implement per-period wake semantics that survive raw pollers |

## 11. Next up

- **DONE (D19 — camilladsp/inferno lifecycle)**: event-driven start/stop
  over the netifd iface hotplug + ptp hotplug (`docs/lifecycle.md` is
  the authoritative write-up; `docs/architecture.md` starts the
  coherent doc set). Slirp-guest matrix green: boot, flap, drift
  restart, renewal silence, clock lost/recovery, 0 panics. Pending
  (need the bridge rig / hw): real carrier-loss timing, zcip→DHCP
  ladder, GM loss against a real master.
- **DONE (D18/M5 — webui COMPLETE)**: hardening — TLS via uci
  (nginx server blocks assembled by the webui init, config-test guard,
  http→https redirect, Secure cookie), first-boot set-password flow
  (own login app, precondition-guarded unauth RPC), CSP/nosniff/referrer
  headers, exponential login backoff verified (1.2→8.2 s), WS gating
  over wss. User guide `docs/webui.md`, test report
  `results/test-webui-m5.md`. All five milestones green; browser-only
  rendering (curves, drag UX) still needs a human pass.
- **DONE (D18/M4)**: filters + uploads — genconf extended with uci-native
  user steps on editable slots (allow/max validation, placeholder anchor),
  webuid filters/mix/files modules (transactional genconf dry-run,
  multipart upload to /opt/user_data/filters), webui-app-filters (slot
  editors + live cascade curves, vendored camillaEQ biquad math) +
  webui-app-files. Verified on rig incl. raw-WS attacks on locked chains
  rejected by the manifest (`results/test-webui-m4.md`). Next: M5 (TLS,
  first-boot password, hardening docs).
- **DONE (D18/M3)**: config pages — webuid uci bridge (write-ACL
  allowlist), webui.set_password (session invalidation), vendored system
  app (hostname/TZ/password/reboot) + network app (dhcp/static,
  lockout warning); apply chain via procd reload triggers verified
  (`results/test-webui-m3.md`). Next: M4 filters page + uploads (manifest
  schema, genconf validation, /opt/user_data).
- **DONE (D18/M2)**: webui frontend — vendored OUI shell (deps/oui @
  386f49e; the OUI patch stack later grew to 0001–0004, see
  `docs/patches.md`) + webui-app-status, built by host-node npm+vite
  (460 KB gzipped dist), gzip_static serving, menus/status/logs contract
  verified end-to-end (`results/test-webui-m2.md`). Next: M3 config pages
  (generic uci bridge + system/network apps), M4 filters.
- **DONE (D18/M1)**: webui skeleton — nginx + webuid (ucode SCGI daemon,
  shadow login, sessions, /_auth, WS gating) verified end-to-end on QEMU
  (`results/test-webui-m1.md`). Next: M2 status page (vendored OUI frontend
  + `status.all` wiring), M3 config pages (uci bridge), M4 filters.
- **DONE (D17)**: camilladsp revents patch landed and verified — decision
  rule met (clean win): sink default is direct `capture='Inferno'` again.
- Upstream outreach: send both patch series (camilladsp
  `0001-capture-use-poll-descriptors-revents`, inferno
  `0001-capture-poll-period-level`) with the D16/D17 evidence.
- Optional: re-check sink PTP offsets with the spin gone (D15 thesis
  predicts the ±1 ms noise disappears with the pegged core; needs statime
  loglevel info for ~30 s — restart-free only if a runtime knob exists).
- Rig teardown nightly: kill guests, `pkill -f statime-gm`,
  `sudo scripts/qemu-bridge.sh down` (needs interactive sudo).

| D17 | — | **camilladsp revents patch — the spin fixed at the root**: package patch `0001-capture-use-poll-descriptors-revents.patch` (utils.rs `FileDescriptors<'a>` now carries `&alsa::PCM` and `wait()` calls `snd_pcm_poll_descriptors_revents` after `poll()`; both capture constructors plumb `pcmdevice`) | playback was NEVER affected — it uses `alsa::PCM::wait` = `snd_pcm_wait`, which translates revents correctly inside alsa-lib; only the capture `FileDescriptors::wait` raw-polled. With translation, the plugin's PERIOD_POLL machinery finally engages: AlsaCapture 845 R-state → 52 S-state ticks/8 s (FIFO fallback 38), audio identical, subscription CODE_OK. Sink default is again `capture='Inferno'` + S16_LE; `aoip-bridge` service kept in overlay but disabled by default (enable + `RawFile:/tmp/aoip.fifo` if the patch is dropped). Upstream: both patches ready (camilladsp revents call; inferno PERIOD_POLL/throttle/drain series) |
| D18 | — | **webui = nginx front + ucode gateway + vendored OUI frontend** (full plan: `plan/webui.md`; M1 implemented): options evaluated — LuCI (uhttpd can't proxy WS), OUI stock (MD5 uci users, lighttpd can't session-gate a proxied WS, ~9 lua-eco recipes not in Buildroot), OUI+nginx+auth-patch (Lua fork), Rust gateway (fallback) — chosen: reimplement OUI's tiny closed-world JSON contract (~16 funcs) in a ucode daemon (`webuid`, ptp-monitor pattern: uloop + nonblocking SCGI on `/run/webui.sock`), nginx as the ONLY exposed process (static, scgi, `auth_request /_auth`, WS upgrade proxy to camilladsp loopback), login via `/etc/shadow` + busybox cryptpw, OUI Vue frontend vendored later (M2+). New in image: nginx only (+`UCI_SUPPORT=ON` in ucode, +`CRYPTPW` applet) | the auth-gated WS was the deciding requirement — neither uhttpd nor lighttpd can enforce a session on a proxied websocket, so every framework variant converged on needing a custom gateway anyway; enforcement of the protected pipeline stays in camilladsp (patch 0003) so the proxy can be a dumb auth'd pipe. ucode gotchas (no function hoisting; no argv-form popen in the pinned rev; `json()` parses only, serialize via `sprintf("%J")`) live in `scripts/webui/README.md`. M1 verified on QEMU: real `$6$` login, 401/403 gating, `101 Switching Protocols` through the proxy (`results/test-webui-m1.md`); host dev-loop harness in `scripts/webui/` |
| D19 | 60 s drift-restart poll inside the ptp hotplug (commit 2cda580); "this build's netifd does not dispatch iface hotplugs" | **event-driven lifecycle over both hotplug buses** (full plan: `plan/camilladsp-inferno-lifecycle.md`, write-up: `docs/lifecycle.md`), with a **single rendering/decision point**: the camilladsp init's `start_service` seeds the advertised-address baseline at every start and its custom `check` command (rc.common EXTRA_COMMANDS) decides starts (PTP locked + ≥1 IPv4 + not running) and drift restarts; the hotplug handlers are thin gates — iface hotplug `/etc/hotplug.d/iface/60-inferno-net` (netdev-gated: ifdown stops camilladsp, +statime only when the link is really gone and the box is not grandmaster-configured; ifup starts statime then delegates) and ptp hotplug (`locked` → `check`, `lost` → stop) | netifd's dispatch was never broken — verified statically in the pinned source (interface-event.c execs /sbin/hotplug-call iface; interface-ip.c sets IFUPDATE_ADDRESSES only on real address diffs) and live with a probe: the earlier attempt failed on its own script bugs. The iface bus kills the address-drift poll (up to 60 s stale advertisement), stops camilladsp on link loss *before* statime's send-timestamp panic, and closes the lock-first boot crash loop; concentrating rendering+decisions in the init script keeps the service self-managed (one code path for boot, hotplugs and operators: `service camilladsp check`). Validation also caught the protected-config boot being broken by the camilladsp 0003/0005 patch stack (see `docs/lifecycle.md` §"Found along the way") — reported and fixed by the stack owners in `de31c22` |
General logic that emerged from these:

- **config flows one way**: uci → genconf/render → process (env or file);
  nothing reads uci at runtime except the init scripts;
- **instances over daemons**: audio/Dante components are instantiated by
  their host application (camilladsp hosts inferno; alsa hosts the
  plugin); only long-lived infrastructure gets a procd service
  (statime's clock export);
- **tests must not need root**: every QEMU-level test (M2 DoD, M3 DoD,
  M4 PTPv2/capture) runs through piped-stdin console sessions and the
  socket link;
- **patches are generated, never hand-written** (fuzz-0 application),
  and pinned-source drift is fixed with pre-build hooks (usrvclock).
