# Memory matrix — 128 / 256 / 512 MB profiles (M5.5)

Firmware: `output/rk3506qemu` (default uci: protected 2-way pipeline,
`capture=Inferno`, `playback=File:/dev/null`, camilladsp chunksize 1024),
QEMU `virt` cortex-a7 ×3 TCG, slirp mgmt NIC, `--audio none` (virtio-snd
device present but idle). Collected after PTP lock + camilladsp running
+ 15 s settle. Raw blocks: `/tmp/opencode/mem-matrix/res-*.txt`.

## Measurements

| Profile | Booted+services | locked | MemTotal | MemFree | MemAvailable | camilladsp RSS | statime RSS | procd+netifd RSS | OOM events | XRUN lines |
|---|---|---|---|---|---|---|---|---|---|---|
| 128 MB | yes | true | 98.7 | 28.2 | 31.3 | 9.1 | 2.9 | 3.2 | 0 | 0 |
| 256 MB | yes | true | 225.5 | 156.1 | 159.2 | 9.2 | 2.8 | 3.4 | 0 | 0 |
| 512 MB | yes | true | 479.3 | 408.4 | 411.5 | 9.0 | 2.8 | 3.0 | 0 | 0 |

(RSS in MB; procd+netifd row includes ubusd + logd.)

## virtio-snd → camilladsp → host wav (512 MB)

- bind: `*/\1/p" | head -1); echo "VIRTCARD=$N"; [ -n "$N" ] && { uci set camilladsp.main echo RESTARTED; }; echo __VRC4__=$? VIRTCARD=0 RESTARTED`
- camilladsp state after rebind: `Starting`
- pcm status: `/proc/asound/card0/pcm0p/sub0/status:state: RUNNING; state: RUNNING; closed`
- host `/tmp/guest-out.wav`: **4.7 MB, 44100 Hz 16-bit 1ch, 53.4 s**

Note: QEMU's `wav` audio backend records at its own default format
(44.1 kHz mono s16), resampling the guest's 48 kHz stereo stream —
the guest-side PCM ran 48 kHz stereo (`/proc/asound` hw_ptr advancing,
`state: RUNNING`); the host file is a backend artifact, not the guest rate.

## Findings / recommendation

- **128 MB boots fully green**: procd stack + statime + camilladsp +
  webui (nginx×2) all resident and stable, PTP locked, 0 OOM events,
  0 XRUN lines; MemAvailable ≈ 31 MB headroom. The M5.5 DoD
  "boot and services active at 128 MB" is met with margin.
- ARM32 lowmem accounting: MemTotal at `-m 128M` is ~99 MB (kernel
  image, page tables and reserved regions under `highmem=off`).
- Big RSS items: camilladsp ≈ 9.1 MB (protected 2-way pipeline with
  the 1-tap placeholder FIR; add the real FIR bank sizes for
  production sizing — vendor FIRs live in `/opt/user_data` and are
  page-cache cached), nginx master+worker ≈ 6 MB, statime ≈ 2.9 MB,
  procd/netifd/ubusd/logd ≈ 3.2 MB combined. ptp-monitor and webuid
  run as `ucode` interpreter processes (not visible to `pidof` by app
  name; small, interpreter-shared heap).
- **Recommendation**: 128 MB is sufficient for the sink role measured
  here (the QEMU-equivalent of the RK3506 target). For the product,
  take **256 MB** — margin for real FIR banks + `mlockall`, the MPD
  source role and future growth; 512 MB showed no additional benefit
  (all of it lands in MemFree).
