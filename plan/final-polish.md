# Final polish round — task tracker

> **Status 2026-08-30**: completed — all tracked tasks done (per-task rows below);
> the squashfs task spawned `plan/squashfs-overlay-userdata.md`, itself
> implemented.

Rig discipline: no builds while audio is being tested; behavior tests first,
rebuild once at the very end.

## T1 — inferno subscription persistence

**Status: done (refined after review)**

- Where: `StateStorage` (deps/inferno/inferno_aoip/src/state_storage.rs) →
  `<state_dir>/inferno_aoip/<factory-device-id-hex>/rx_subscriptions.toml`
  (tomm, atomic tmp+rename, saved on every subscribe/unsubscribe).
- `state_dir` comes from `platform-dirs` `AppDirs::new(Some("inferno_aoip"), false)`
  → honors `XDG_STATE_HOME`, else `~/.local/state`.
- **Bug found (live)**: under procd there is no HOME → fallback wrote to
  `/.local/state/...` at the rootfs root. Worked, but wrong place.
- **Fix**: `init.d/camilladsp` and `init.d/aoip-bridge` now prepend
  `XDG_STATE_HOME=/root/.local/state` to the procd env (uci `list env`
  entries can still override). Subscriptions persist across reboots on
  ext4 — intended Dante receiver behaviour.
- Live-verified pre-fix: state file existed at `/.local/...`, camilladsp
  restarts reloaded it (no "first run" warning after first save).
- REFINEMENT (end state): new uci `inferno.main.state_dir` (default
  **/opt/user_data**) — the future RW user-data volume that also hosts
  camilladsp user configs/FIRs; `/etc` keeps only basic uci settings.
  On QEMU today it is a plain dir on ext4; with the squashfs/overlay/
  user_data layout (plan/squashfs-overlay-userdata.md) it becomes a
  mounted ubifs volume → subscriptions survive even factory reset.
- ROUND 2 (upstream-able mechanism, patch
  `br-external/package/inferno/0002-state-storage-env-path.patch`):
  new first-class env var **`INFERNO_STATE_PATH`** — flows through the
  existing `INFERNO_*` settings collector (settings.rs `STATE_PATH` →
  `Settings.state_path` → `StateStorage::new(base)`), final layout
  `<path>/inferno_aoip/<device-id>/`; default unchanged (XDG /
  `~/.local/state`). Init scripts (camilladsp + aoip-bridge) now export
  `INFERNO_STATE_PATH=$state_dir` instead of squatting on
  `XDG_STATE_HOME` (procd has no HOME → the fallback would be `/.local`).
  Verified live (fb6): state dir created at boot, rx_subscriptions.toml
  written on subscribe, full flow 48213 fps, no XDG env involved.
- FOOTGUN discovered while verifying: on a fresh image the ptp hotplug
  can start camilladsp ~60 s in, BEFORE network.aoip has any address
  (proto none until configured) → `create_self_info` panics
  (settings.rs:36) → procd respawns → self-heals once IPs exist.
  Candidate fix: hotplug handler (or inferno) should wait for the
  interface address instead of panicking.

## T2 — mpd disabled at boot

**Status: done**

- Removed overlay `etc/rc.d/S96mpd` symlink (kept `K30mpd` stop ordering).
- mpd is a source-guest special case; enable with `service mpd enable`.

## T3 — real MPD CLI

**Status: done (pending rebuild verification)**

- `BR2_PACKAGE_MPD_MPC=y` added to defconfig (Buildroot's `mpd-mpc`,
  selects libmpdclient).
- Gotcha recorded: `BR2_PACKAGE_MPC` is the GNU **math** library, not the
  music player client.

## T4 — stray `/etc/init.d/S95mpd`

**Status: done (pending rebuild verification)**

- Origin: Buildroot's stock `package/mpd` ships a sysv script `S95mpd`;
  it polluted the `service` listing with a usage line.
- Removed in `post-build.sh`.

## T5 — network init errors

**Status: done (refined after review — real parity port)**

- `/sbin/wifi: not found` → dropped `/sbin/wifi reload_legacy` /
  `/sbin/wifi down` calls (no wifi here).
- `Interface -a not found` → root cause: our `usr/sbin/ifup` was a
  homegrown STATUS-ONLY stub, not the netifd wrapper.
- FIX (parity): ported the real openwrt.git
  `package/network/config/netifd/files/sbin/ifup` verbatim (ifdown/
  ifreload symlinks kept; `-a` support, per-interface `network reload`
  first). `ifstatus`/`devstatus` were already correct ports.
  network init stop_service/shutdown back to `ifdown -a` (parity);
  `hotplug-call` re-aligned with the upstream base-files version
  (subshell per handler, LOGNAME/USER/DEVICENAME exports).
- `wifi` calls stay dropped (wifi-less system; the real wrapper only
  touches wifi via `-w`, which we don't use).

## T6 — LIVE: source abruptly offline (rig, pre-rebuild image)

**Status: done**

- Source hard-killed (QEMU SIGKILL = power cut):
  - sink inferno RX: `flow timeout (not receiving media packets)`,
    `channel subscribed to 01@rk3506-source is orphaned now` (and 02)
    within seconds;
  - playback keeps RUNNING at 48k with **clean silence** — not stuck on
    last samples, no crash, no capture spin-up (S-state, ~56 ticks/8 s);
  - PTP unaffected (host GM still master).
- Source rebooted + reconfigured + radio restarted:
  - sink does **not** auto-resume orphaned subscriptions (passive wait,
    no re-announce to the new TX instance);
  - one re-issued `dante-l2node.py --direct … subscribe` (CODE_OK)
    restores audio.
- **Runbook rule**: after a source reboot, re-subscribe.
- OFFICIAL Dante behaviour (question): receivers **mute to silence**
  on flow loss (never stuck tones), subscriptions persist, and audio
  **resumes automatically** when the transmitter returns (Dante
  Controller shows subscription health meanwhile). Our inferno matches
  silence + persistence, but NOT auto-resume (orphaned channels wait
  passively) and the sink-reboot re-subscribe races (X1) — both are
  gaps vs official behaviour and upstream candidates.

## T7 — tmpfs `/var`, board info, runtime state

**Status: done (pending rebuild verification)** — implemented per
`plan/tmpfs-var-sysinfo-state.md` §2:

- `post-build.sh`: `/var → tmp`, `/run → var/run` symlinks.
- `etc/preinit`: `/tmp/sysinfo/{board_name,model}` from device-tree;
  obsolete `/run/lock` mkdir dropped.
- overlay `usr/sbin/hotplug-call` (OpenWrt base-files parity, GPL-2.0).
- `netifd.mk`: installs `etc/hotplug.d/iface/00-netstate` →
  `/tmp/state/network` uci deltas.
- Verification = the plan's §4 DoD checklist (T10).

## T8 — dynamic MOTD

**Status: done (pending rebuild verification)**

- `/etc/motd` reduced to the ASCII banner only.
- New `etc/profile.d/10-status.sh`: prints board name/model (from
  /tmp/sysinfo), host/kernel, uptime, interface IPs, PTP lock + freq ppm,
  and statime/camilladsp/aoip-bridge/mpd run states at each login shell.

## T9 — repo cleanup + docs + README

**Status: done (extended after review)**

- Removed: `scripts/__pycache__/`, empty `br-external/patches/`;
  `.gitignore` += `__pycache__/`.
- Kept: `configs/` (referenced by docs/crossover-to-camilladsp.md),
  `results/` (plan §6.2 output dir).
- `README.md` regenerated: current stack summary, bridge-rig quickstart,
  layout tree, docs index table, key facts (48k lock, PTP, persistence,
  tmpfs).
- `plan/plan.md` §3 tree updated (post-build description).
- EXTENSION: removed shipped test assets from the image (they are user
  data, not image content): `/usr/share/camilladsp/{fir.txt,test.wav}`,
  `/usr/share/mpd/radio.m3u`; init.d/mpd no longer seeds the playlist;
  mpd.conf + docs examples retargeted (`/opt/user_data/...`,
  `mpd-ctl play <url>`); post-build purges the stale target copies.

## T10 — final rebuild + verification boot

**Status: done** (three build rounds — see gotchas below)

- [x] full rebuild green (T1–T9 baked in)
- [x] tmpfs DoD: `/var → tmp`, `/run → var/run`; tmpfs on /tmp; ubus sock
      in RAM; /tmp/sysinfo populated (linux,dummy-virt);
      **/tmp/state/network deltas written at BOOT** (loopback/lan/aoip
      up + ifname), regenerated by `service network restart`
- [x] mpd off by default (source: `service mpd enable && start`);
      `mpc` present and working (`mpc status` shows track + play state)
- [x] `service` listing clean (no S95mpd); `service network restart`
      error-free (silent — no wifi, no "Interface -a")
- [x] dynamic login banner: board/host/kernel/uptime/PTP lock + freq/
      service states, all live
- [x] radio e2e: source→sink→host audio (subscription CODE_OK,
      card0 RUNNING)

Gotchas hit during the build rounds (now guarded):
1. removing `rc.d/S96mpd` from the overlay does NOT remove it from the
   accumulating `output/target` → mpd still booted; post-build now purges
   stale overlay removals explicitly.
2. changing `netifd.mk` install hooks silently does nothing without
   `netifd-dirclean` (Buildroot stamp caching) — same class as the old
   libcurl lesson.
3. overlay scripts need the exec bit (`hotplug-call` shipped 0644 →
   "Permission denied").

## X1 — subscription across cold reboot

**Status: done**

- Persisted state reloads (new `/root/.local/state/inferno_aoip/<id>/
  rx_subscriptions.toml`, no "first run" warning) and the respawned
  receiver **re-attempts the subscription automatically** toward the
  still-live source.
- **BUT** the auto-resume path races: `unable to receive start time,
  ring_buffer addressing will be wrong!` → first camilladsp instance
  dies (`snd_pcm_hw_params` ETIMEDOUT), the procd respawn limps with a
  broken stream (hw_ptr cycling, ~21 kfps / negative deltas).
- REFINED after fb5 testing (post-round): the auto-restore race lands
  the receiver in a **trickle state** (~1500 fps dribble, underrun-
  cycling hw_ptr) that a plain `--remove`+`subscribe` cycle does NOT
  reliably clear — and it decoyed us into blaming QEMU/PipeWire (full
  rate on pure silence disproved that: 48230 fps unsubscribed).
- RELIABLE recovery: `--remove` → stop camilladsp → wipe
  `/opt/user_data/inferno_aoip/*/rx_subscriptions.toml` → start →
  ONE manual subscribe → 48230 fps / 1514 rx pps every time.
- **Runbook rules**: after source reboot → re-subscribe; on trickle/
  frozen hw_ptr after any receiver restart → the wipe-and-resubscribe
  sequence above. Upstream candidates: start-time race on re-subscribe
  AND the unrecoverable trickle state.

## X2 — D16/D17 fixes still effective post-rebuild

**Status: done**

- Fresh image, direct `capture='Inferno'`, live radio: AlsaCapture
  **S d=62**/8 s, AlsaPlayback S d=56 — no pegged core, patches intact.

## X3 — clean boot logs

**Status: done**

- Sink: 4 errors, all timestamped to the deliberate reboot race (dead
  camilladsp 451); none in steady state.
- Source: only transient `flows_tx send returned error` WARNs during
  the sink's broken window; none in steady state.

## T11 — production rootfs plan (squashfs + overlay + /opt/user_data)

**Status: plan created** — `plan/squashfs-overlay-userdata.md`

- Phase A (QEMU, no NAND): squashfs root + overlayfs (kernel needs
  CONFIG_OVERLAY_FS=y — currently not set — and SQUASHFS) + data disk
  stand-ins; preinit shell pivot (OpenWrt mount_root semantics, /rom
  view, factory reset = wipe upperdir only, user_data survives).
- Phase B (RK3506 SPI NAND): UBI volumes fit/rootfs/rootfs_data/
  user_data via ubinize.cfg; mkfs.ubifs -F; preinit device-type case
  swaps /dev/vdb* for ubi0:*.
- End state covers T1: inferno subscriptions + camilladsp user configs
  live in the user_data volume; /etc stays uci-driven via the overlay.

## T12 — GM failover & latency tests, protected-pipeline plan

**Status: done**

- GM loss/return (results/gm-loss-and-latency.md): seamless both ways —
  source BMCA-elected master (D10 patch), sink resynced, audio never
  dropped; host GM return re-slaved both without a break.
- Latency: relative timing sample-exact (2.0000 s spacing through the
  whole chain); absolute deferred — no common clock in-situ; analytic
  budget ≈ 160-200 ms, chunksize-dominated (2048→1024 saves ~45 ms).
- Protected xover/FIR design: plan/protected-xover-pipeline.md (manifest
  + camilladsp config gates, abort-on-persistent-tamper semantics,
  WS loopback lockdown, preset daemon, uci roles, tamper-matrix DoD).
