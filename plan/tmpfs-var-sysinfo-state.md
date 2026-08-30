# Plan — tmpfs `/var`, board info and runtime state (OpenWrt parity)

Goal: stop writing volatile state to the rootfs (today ext4; on the final RK3506
hardware = SPI NAND → wear from log/pid/socket/uci-state writes), and provide
the OpenWrt runtime interfaces `/tmp/sysinfo/{board_name,model}` and
`/tmp/state/*` (real-world reference: ZTE MF286D on OpenWrt).

## 1. How OpenWrt handles it (verified against our pinned sources)

| Concern | OpenWrt mechanism | Status in dante today |
|---|---|---|
| Logs wear NAND | `logd` (ubox) keeps logs **in RAM** (udebug shm ring; `logread` reads them back). Nothing under `/var/log` is written by default. | Already OK — logd/logread run (M2 round 3); `/var/log → ../tmp` in Buildroot skeleton |
| Volatile files | **`/var` is a symlink to `/tmp`** in the rootfs (base-files). `/tmp` is a tmpfs mounted by procd itself. | **Missing** — `/var` is a real dir; `/var/run → ../run` and `/var/lock → ../run/lock` point at the rootfs `/run`; `/var/state` is a real dir on flash |
| `/tmp` tmpfs | procd `initd/early.c`: `mount("tmpfs","/tmp",…,"mode=01777")` + `mkdir /tmp/{shm,run,lock,state}` | Already OK — verified in procd @ 58eb263 (`early.c:75-80`), `CONFIG_TMPFS=y` |
| `/tmp/sysinfo/*` | base-files `/lib/preinit/02_sysinfo` preinit hook: `board_name = strings /proc/device-tree/compatible \| head -1`, `model = cat /proc/device-tree/model` (DT-based; targets may override) | **Missing** — our minimal preinit has no hook infra, nothing writes it (`board_name()` in functions.sh:422 already consumes it, falls back to "generic") |
| `/tmp/state/network` | chain: netifd `interface-event.c` execs **`/sbin/hotplug-call iface`** (env `ACTION=ifup INTERFACE=lan DEVICE=br-lan`) → `/etc/hotplug.d/iface/00-netstate` (shipped in netifd's *openwrt.git packaging*, not in netifd sources) calls `uci_toggle_state network "$INTERFACE" up 1` / `ifname` → `uci -P /var/state set …` writes a uci **delta file**. `/var → /tmp` makes it appear as `/tmp/state/network`. | **Missing** — `/sbin/hotplug-call` doesn't exist (ubox 25.12 no longer builds it; it is a base-files shell script), `00-netstate` not shipped |

Result on the MF286D:
```
/tmp/sysinfo/board_name → zte,mf286d
/tmp/sysinfo/model      → ZTE MF286D
/tmp/state/network      → network.lan.up='1' … (uci delta format, per ifup)
```

Key facts checked in-tree:
- `hotplug-call` is a ~15-line shell script (openwrt.git `package/base-files/files/sbin/hotplug-call`, GPL-2.0); it sources `/lib/functions.sh` then `/etc/hotplug.d/$1/*`.
- `functions.sh:436` already sources `/lib/config/uci.sh` (= `/usr/lib/config/uci.sh`, installed by our uci package) which defines `uci_toggle_state` → `/sbin/uci -P /var/state`; the uci CLI supports `-P` (delta dir).
- netifd `DEFAULT_HOTPLUG_PATH` = `/sbin/hotplug-call` (merged-usr → `/usr/sbin/hotplug-call` works).
- ubusd socket is `/var/run/ubus/ubus.sock` → today lands on the rootfs `/run` (flash); with `/var → /tmp` it lands in RAM (ubusd `mkdir_sockdir()` creates the dir).
- `logd` ring buffer: udebug shm → `/dev/shm` → procd symlinks `/dev/shm → /tmp/shm` → RAM. Logs never touch flash.

## 2. Changes

### 2.1 `/var` (and `/run`) → tmpfs (post-build)
- `post-build.sh`: after the existing steps, convert the volatile skeleton dirs:
  ```
  rm -rf $TARGET_DIR/var $TARGET_DIR/run
  ln -s tmp $TARGET_DIR/var
  ln -s var/run $TARGET_DIR/run
  ```
  (`/var/lib/{alsa,misc}` become volatile — acceptable: QEMU has no mixer state;
  on real hardware decide whether to persist ALSA state via `/etc` or accept
  re-init per boot, like OpenWrt does.)
- Consequences (all good): `/var/log`, `/var/run`, `/var/state`, `/var/lock`,
  `/var/tmp` live in tmpfs via the symlink; procd's early `mkdir /tmp/{run,lock,state}`
  pre-creates them; ubusd socket + logread pid files land in RAM.
- `etc/init.d/boot`: keep the `mkdir -p /var/lock /var/log /var/run /var/state
  /var/tmp` block (now it just re-creates tmpfs dirs — harmless, matches
  OpenWrt's own boot script); `wtmp`/`lastlog` touches go to tmpfs.
- `etc/preinit`: the `/run/lock` mkdir is no longer needed (procd creates
  `/tmp/lock` before any rc script) — remove it (rc.common's procd_lock uses
  `/var/lock` = `/tmp/lock`).
- Steady-state flash writes after this: only `uci commit` (config changes) and
  `/etc` edits. Full ro-root + overlay stays an M6 option (no longer urgent).

### 2.2 Board info → `/tmp/sysinfo`
- `etc/preinit`: add the `02_sysinfo` logic inline (no boot_hook infra needed):
  ```sh
  if [ -d /proc/device-tree ]; then
      mkdir -p /tmp/sysinfo
      [ -e /tmp/sysinfo/board_name ] || \
          echo "$(strings /proc/device-tree/compatible | head -1)" > /tmp/sysinfo/board_name
      [ ! -e /tmp/sysinfo/model ] && [ -e /proc/device-tree/model ] && \
          echo "$(cat /proc/device-tree/model)" > /tmp/sysinfo/model
  fi
  ```
- busybox `strings` applet: already enabled (`CONFIG_STRINGS=y`); fallback if it
  ever disappears: `tr '\0' '\n' < /proc/device-tree/compatible | head -n1`.
- QEMU `virt` → `board_name`/`model` = `linux,dummy-virt`; on real RK3506
  hardware the vendor DTS provides `rockchip,rk3506…` + vendor model string —
  same code path, zero per-board work.
- `board_name()` already exists in `functions.sh:422` — scripts can use it.

### 2.3 Runtime state → `/tmp/state` (hotplug-call + 00-netstate)
- New overlay file `usr/sbin/hotplug-call` (adapted from base-files, GPL-2.0,
  with our PATH; merged-usr covers `/sbin/hotplug-call`):
  runs `/etc/hotplug.d/$1/*` after sourcing `functions.sh`.
- netifd package: install `files/etc/hotplug.d/iface/00-netstate` (copied from
  openwrt.git netifd packaging) to `/etc/hotplug.d/iface/00-netstate` in
  `NETIFD_INSTALL_PROTO_HELPERS`:
  ```sh
  [ ifup = "$ACTION" ] && {
      uci_toggle_state network "$INTERFACE" up 1
      [ -n "$DEVICE" ] && {
          uci_toggle_state network "$INTERFACE" ifname "$DEVICE"
      }
  }
  ```
- Nothing else needed: netifd fires the exec on ifup/ifdown/ifupdate;
  `uci -P /var/state` writes the delta into tmpfs; procd pre-creates `/tmp/state`.
- Bonus: `hotplug-call` + `/etc/hotplug.d/` is the generic OpenWrt extension
  point for future iface/net/tty scripts.

## 3. Files touched

| File | Change |
|---|---|
| `br-external/board/rk3506qemu/post-build.sh` | `/var → tmp`, `/run → var/run` symlinks |
| `br-external/…/rootfs-overlay/etc/preinit` | + sysinfo generation; drop `/run/lock` mkdir |
| `br-external/…/rootfs-overlay/etc/init.d/boot` | no functional change required (mkdirs now hit tmpfs) |
| `br-external/…/rootfs-overlay/usr/sbin/hotplug-call` | new (from base-files) |
| `br-external/package/netifd/netifd.mk` | + install `hotplug.d/iface/00-netstate` |
| `br-external/package/netifd/files/etc/hotplug.d/iface/00-netstate` | new (from netifd packaging) |

No defconfig changes (`CONFIG_TMPFS=y` already; overlay/post-build already wired).

## 4. DoD (QEMU)

1. `mount | grep tmpfs` → `/tmp` tmpfs; `ls -l /var /run` → symlinks into tmpfs.
2. `ls /var/run/ubus/ubus.sock` (socket in RAM) and `ubus call system board` OK.
3. `cat /tmp/sysinfo/board_name` → `linux,dummy-virt`; `cat /tmp/sysinfo/model` → `linux,dummy-virt`.
4. After boot: `cat /tmp/state/network` shows `network.loopback.up='1'`,
   `network.loopback.ifname='lo'`, `network.lan.up='1'`, `network.lan.ifname='eth0'`
   (same shape as the MF286 example; `ifup lan && cat /tmp/state/network` refreshes).
5. `logread` works; logs are RAM-only (`findmnt -T /var/log` → tmpfs).
6. Flash-write proof: after full boot, `mount -o remount,ro /` succeeds (nothing
   holds a dirty writable file); reboot → system comes up identically.
7. Regression: M2 DoD quick pass (procd PID 1, `ubus list`, `uci show network`,
   eth0 DHCP + resolv.conf, netifd respawn) + M3/M4 spot checks
   (`/tmp/camilladsp.yml` regen, `/tmp/statime.toml`, two-guest PTP lock).

## 5. Risks / open questions

- `/var/lib` volatility (ALSA state on real hardware): accept or persist via
  `/etc` on the RK3506 port — decide when real audio hw exists.
- ext4 on SD/NAND still mounted `rw`: remaining writes are config commits only;
  M6 read-only-rootfs (+overlay) would eliminate them and is now optional polish.
- `logread -f` pid file path (`/var/run/logread.*.pid`) → tmpfs, fine.
- Remote/persistent logging (log_ip in `/etc/config/system`) can be added later
  without layout changes — it is a logd feature, not a filesystem one.
