# dante — RK3506 Dante audio firmware on QEMU

A minimal Linux firmware for a Rockchip RK3506-class target (3× ARM
Cortex-A7 + NEON, 32-bit hard-float, musl), developed and validated in QEMU.
The system stack is OpenWrt's — procd as PID 1, ubus, uci, netifd, ubox —
built with Buildroot. On top of it runs the audio chain:

```
web radio (MPD) → snd-aloop → camilladsp → inferno (Dante/AES67 AoIP)
                                              ⇄ PTP clock (statime, fork)
                                              ⇄ ARC subscriptions
host audio ← virtio-snd ← camilladsp ← inferno RX (receiver guest)
```

Status: **end-to-end validated on the bridge rig** — a source guest streams
MPD web radio as Dante flows to a sink guest that plays it on host audio,
both slaved to a native host-side PTP grand master. See `plan/plan.md`
(§10 decision log) for the full trail, including the fixed camilladsp
capture busy-poll (D16/D17).

## Quickstart

```sh
git clone --recursive <this-repo>
./scripts/build.sh                          # Buildroot build (~30-60 min)

# bridge rig (docs/bridge-rig.md has the full walkthrough)
sudo scripts/qemu-bridge.sh up              # br-dante 198.18.100.254/24 + taps
~/.local/bin/statime-gm --config scripts/statime-gm.toml &   # see doc for build

./scripts/run-qemu.sh --net tap:tap0 --mac 00:11:22:33:44:55 --no-mgmt \
    --console telnet:5556 &                 # source guest
./scripts/run-qemu.sh --net tap:tap1 --mac 00:11:22:33:44:66 \
    --audio virtio-snd-pa --no-mgmt --console telnet:5557 &  # sink guest

# per docs/bridge-rig.md §4: configure uci on both, wait for PTP lock, then
mpd-ctl load radio && mpd-ctl play && mpd-ctl repeat 1          # on source
scripts/dante-l2node.py --direct 198.18.100.254 subscribe \
    --to 198.18.100.2 --rx-host rk3506-source --map 1=01 --map 2=02
```

Login on the consoles: `root`, no password. QEMU runs with `-snapshot`;
test boots never modify the built image.

## Layout

- `plan/` — the plan: `plan.md` (milestones, §10 decision log, §11 next up),
  focused plans (`tmpfs-var-sysinfo-state.md`, …)
- `buildroot/` — Buildroot (git submodule, 2025.02.x LTS)
- `deps/` — pinned application sources (git submodules: camilladsp, inferno,
  statime fork, …); local modifications live as patches in `br-external/`
- `br-external/` — Buildroot external tree:
  - `package/` — OpenWrt stack + apps (uci, procd, netifd, ubox, statime,
    inferno, camilladsp, mpd, …) with our patches
  - `board/rk3506qemu/` — kernel/busybox fragments, rootfs overlay (procd
    init scripts, uci defaults, asound.conf, mpd.conf, motd/profile),
    post-build (module flattening, OpenWrt-style `/var → tmp` tmpfs layout)
- `scripts/` — build/run/bridge helpers, `dante-l2node.py` (ARC/Dante
  subscription tool), `statime-gm.toml` (host grand master)
- `configs/` — reference camilladsp configs (crossover experiments)
- `results/` — test reports (populated by milestone measurements)
- `docs/` — runbooks and component docs:

| doc | content |
|---|---|
| `docs/bridge-rig.md` | **the** rig: host GM + tap bridge, full walkthrough |
| `docs/radio-over-dante.md` | mcast-tunnel rig variant, radio e2e recipe |
| `docs/camilladsp.md` / `docs/inferno.md` / `docs/alsa.md` | component docs + uci schemas |
| `docs/ptp-monitor.md` | usrvclock monitor, ubus object, hotplug policy |
| `docs/test-*.md` | scripted milestone tests (socket-rig era, still valid) |
| `docs/crossover-to-camilladsp.md` | speaker DSP crossover background |

## Key facts

- Audio: 48 kHz lock end-to-end (MPD output resampler), S16_LE Dante flows,
  camilladsp chunksize 2048.
- PTP: statime (fork) with usrvclock export; host `statime-gm` grand master
  on the bridge; guests slave via `ptp-monitor` → ubus + hotplug policy.
- Dante subscriptions persist: `XDG_STATE_HOME=/root/.local/state` →
  `inferno_aoip/<device-id>/rx_subscriptions.toml` survives reboots.
- Volatile state is RAM-only (OpenWrt-style `/var → /tmp`), logs via logd.
