# Plan — statime PHC-only mode (#517) + timestamp-source decoupling (#380)

> **Status 2026-09-18**: planned (not started) — statime patch number 0002 is
> reserved for this work (`docs/patches.md`).

Goal: let statime discipline **only the PTP Hardware Clock** and leave the
Linux system clock to NTP, with precision-time apps reading `/dev/ptp`
directly (or the usrvclock export backed by the PHC). Upstream issues:
pendulum-project/statime#517 (PHC-only mode) and #380 (software
timestamping with a PHC bound). Testable fully in QEMU emulation via
netdevsim + the kernel mock PHC — no physical PHC hardware needed.

## 1. Current behavior (fork @ 244f20a, statime-linux)

- `hardware_clock = auto|required|<N>|none` selects the **port clock**
  (the clock the servo steers) and, together with it, the timestamp mode:
  PHC ⇒ `HardwarePTPv2All`, none ⇒ `SoftwareAll` (`main.rs:529-560`).
- `clock_task` (built-in phc2sys) always runs, switching modes on BMCA
  state (`main.rs:697-706`):
  - port steering (slave): `ToSystem` — PHC → system clock
  - port not steering (master): `FromSystem` — PHC ← system clock
- With `virtual-system-clock = true` the "system clock" of that bridge is
  the overlay clock (usrvclock export), not the real Linux clock —
  decoupling from NTP is already achievable, at the cost of the overlay
  hop.

Gaps:
1. no way to disable the system-clock sync entirely (the literal #517 ask);
2. PHC binding forces hardware timestamping — no `Specific(N)` + software
   timestamps combination (#380 ask; also blocks netdevsim testing);
3. cold-boot PHC time is implausible when it becomes the sole source.

## 2. Design

### 2.1 New configuration (statime-linux, backward compatible)

```toml
[[port]]
interface = "eth0"
hardware_clock = "0"        # existing: Specific(0) — steering target
timestamping = "auto"       # NEW: auto | hardware | software  (#380)
                            #   auto = current behavior (follows hardware_clock)
clock_mode = "system-sync"  # NEW: system-sync | phc-only       (#517)
                            #   system-sync = current clock_task behavior
                            #   phc-only     = no clock_task; servo steers the
                            #                  PHC only; system clock untouched
```

Rules:
- `clock_mode = "phc-only"` requires `hardware_clock` to resolve to a PHC
  (auto/required/N) — refuse to start otherwise.
- `timestamping = "software"` keeps SW timestamps (system-clock domain)
  while steering the PHC. Cross-domain measurement error is accepted
  explicitly — this is a testing/fallback knob, documented as such; the
  servo sees system-domain timestamps and steers the PHC. For netdevsim
  emulation this is mandatory (no ndo_hwtstamp).
- `phc-only` + master role: seed the PHC **once** at startup from the
  system clock if the PHC time is implausible (seconds < 1970 or >
  2100), then never sync between the two domains again. The device then
  free-runs on the PHC as an arbitrary-timescale master (Dante model).

### 2.2 usrvclock interaction (two options, pick B)

A. Consumers open `/dev/ptpN` themselves (`INFERNO_CLOCK_PATH=/dev/ptp0`).
   Zero statime changes; one less hop; apps need PHC-awareness.

**B (recommended): overlay backed by the PHC.** With
`clock_mode = "phc-only"` + `virtual-system-clock = true`, build the
overlay's underlying clock from the **PHC** instead of a system clockid.
usrvclock then exports PHC time through the existing datagram protocol —
inferno/ptp-monitor keep working unmodified, and `/dev/ptp` remains
available for anyone who wants it. The existing DualLayer overlay
machinery (`main.rs:163-178`) shows the pattern.

### 2.3 Behavior matrix

| state | system-sync (today) | phc-only (new) |
|---|---|---|
| slave, HW timestamps | servo→PHC; PHC→system | servo→PHC; system untouched |
| slave, SW timestamps (#380) | not reachable | servo→PHC; SW domain accepted |
| master | PHC←system (continuous) | one-shot PHC seed, then free-run |

## 3. Emulation test bed (no PHC hardware)

Kernel (defconfig, both `=m`):
- `CONFIG_NETDEVSIM` — virtual netdev whose ethtool ts_info reports a PHC
  (`netdevsim/ethtool.c:155`)
- `CONFIG_PTP_1588_CLOCK_MOCK` — the PHC behind it: full
  gettime/settime/adjtime/adjfreq ioctls over monotonic time

Guest bring-up:
```
modprobe ptp_mock; modprobe netdevsim
echo "1 1" > /sys/kernel/debug/netdevsim/new_device   # sim0 + /dev/ptp0
ip link add br-aoip type bridge; ip link set eth0 master br-aoip
ip link set sim0 master br-aoip   # sim0 has no wire — bridge it to the
                                  # tap-facing eth0 so PTP mcast reaches
                                  # the host GM; disable multicast snooping
```

statime on `sim0`, `hardware_clock = "0"`, `timestamping = "software"`,
`clock_mode = "phc-only"`.

Assertions (scripted, rig style):
1. `/dev/ptp0` exists; statime locks to the host GM (slave).
2. **System clock untouched**: pre-set `CLOCK_REALTIME` −20 s; after ≥30 min
   of locked slaving it is still exactly −20 s ± NTP-free drift (sysntpd
   disabled for the test), while PHC time tracks the GM timescale
   (read via a minimal `phc_gettime` helper — kernel `testptp` copied into
   the overlay, or a 20-line clock_gettime(CLOCK_GETTIME=fd) tool).
3. usrvclock (option B) reports the PHC-based time; `ptp-monitor` locks.
4. Full radio chain: inferno clocked from `/dev/ptp0` (and via usrvclock)
   — source→sink audio at 48 k, thread ticks unchanged vs today.
5. GM loss/return: failover still elects a guest master; in phc-only the
   new master seeds its PHC once and keeps serving.
6. Regression: default config (`clock_mode` unset) behaves exactly as
   today (usrvclock rig unchanged).

## 4. Hardware validation (RK3506, when the board lands)

- Same assertions with real dwmac PHC + hardware timestamps
  (`timestamping = auto`), RX-latency ladder re-run — expect the <10 ms
  emulation floor to disappear.
- Clock source for standalone-master quality (RTC-seeded system clock is
  poor; see §5).

## 5. Master clock sources (context from the #517/#380 discussion)

A standalone statime master advertises system-clock time: RTC seed at
boot, then free-running (or NTP if online). For arbitrary-timescale AV
networks the **date is irrelevant, jitter is everything** — the oscillator
behind the clock defines master quality, and BMCA ranks clocks via
clockClass/clockAccuracy (a GNSS GM advertises class 6 and wins).

**Scope note**: virgilio's BOM has no GNSS/PPS/atomic reference — this
section is context only, not planned hardware. The product design is:
PHC always slaves to the best clock on the wire (any real GM beats our
free-run and BMCA handles it automatically); a virgilio device masters
only in standalone networks of our own devices, RTC-seeded free-run.
External references (GNSS PPS into a PPS-capable NIC, or PPS on
GPIO/serial + chrony/ts2phc) are documented upgrade paths for whoever
needs them later — statime itself has no PPS consumer today.

## 6. Deliverables & upstream strategy

- `br-external/package/statime/0002-phc-only-mode.patch` (+ #380 knob) —
  single patch, two logically separable commits when upstreaming:
  1. `timestamping` config (decouple timestamp source from steering
     target) → closes #380
  2. `clock_mode = phc-only` (+ PHC-backed overlay) → closes #517
- Emulation harness notes → docs/ (netdevsim recipe) and this plan's §3
- `phc_gettime` test helper in the overlay (test-only, or behind a
  `tools` guard)

## 7. Risks / open questions

- Cross-domain steering with `timestamping = software` (#380 mode) is
  formally incoherent (measure in system domain, steer PHC); acceptable
  for emulation/tests, documented against production use.
- Mock PHC timecounter is monotonic-based: steering behavior is real,
  jitter numbers are meaningless — precision claims wait for silicon.
- `phc-only` + slave + HW timestamps: when the GM disappears, holdover
  quality = PHC free-run (better than today's system-clock holdover on
  real HW; untestable magnitude in emulation).
- D10 export-while-master patch interplay: with option B the overlay
  follows the PHC, so the 1 Hz re-send keeps working; verify in test 5.
- Multi-PHC and PTP-aware bridging are explicitly out of scope (#517's
  own constraint list).
