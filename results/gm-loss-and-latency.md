# Rig tests — GM failover & end-to-end latency (2026-08-30, fb6 image)

Rig: bridge (br-dante), host `statime-gm` (priority1 10), source .1
(tap0), sink .2 (tap1), radio e2e playing throughout.

## 1. Grand-master loss on the sink

| phase | observation |
|---|---|
| GM killed (host) | nothing audible; sink hw_ptr never left 48 k |
| ~35 s later | **source BMCA-elected as master** (`mode: master`, D10 self-sustaining export active, usrvclock updates flowing); sink re-synced to it (`slave`, locked, updates ticking) |
| GM restarted (priority1 10 < 251) | both guests back to `slave` under host GM; audio continuous through the handover (sink hw 48384 fps = servo pulling the accumulated epoch offset, no xrun/break) |

Verdict: **seamless failover both ways.** No hotplug kills (the
`lost_timeout=30` grace rode through the re-election window; statime
slaves keep exporting usrvclock during BMCA). Clock quality during the
guest-master epoch is TCG-noise grade (freq ≈ −19 ppm vs ≈ 0 with the
host GM) but bounded; on silicon with PTP-capable dwmac this collapses
further.

## 2. End-to-end latency budget

Method: click file (2 bursts exactly 2.000 s apart, urandom S16 stereo)
`aplay`-ed into `loopplay` on the source; host recorded the sink's
PipeWire monitor (pw-record manually pw-linked to the sink monitor port
— NB `--target <name>.monitor` silently falls back to the MICROPHONE).

Results (3 runs):
- burst spacing measured in the recording: **2.0000 s, sample-exact**
  (no compression/drift through: aloop → camilladsp → inferno TX →
  bridge → inferno RX ring → camilladsp → virtio-snd → PipeWire);
- absolute onset timing could NOT be nailed in-situ: no common clock
  between guest trigger and host recording (guest system clock is not
  PTP-disciplined), and every proxy anchor (console send time, recorder
  start, in-band host click) carried ±1 s uncertainty.

Analytic budget (dominant terms):

| stage | contribution |
|---|---|
| aloop hw buffer (source) | ~43 ms (2048 @ 48 k) |
| camilladsp source chunk | 43 ms |
| inferno TX latency (`TX_LATENCY_NS` default) | 10 ms |
| network (bridge) | < 1 ms |
| inferno RX ring | ~10 ms (RX latency default) |
| camilladsp sink chunk | 43 ms |
| virtio-snd + PipeWire | ~10–30 ms |
| **total (estimate)** | **≈ 160–200 ms** |

Follow-up for a rigorous number: PTP-timestamped tap (flow timestamps
vs sink-side capture) or a dual-input audio interface loopback on real
hardware. For the POC: the budget is chunksize-dominated and shrinks
1:1 with smaller chunks (1024 → ~−45 ms) at the cost of more wakeups
under TCG.


## 3. RX-latency ladder (sink, runtime uci `list env`, fb6 image)

Effective RX latency = max(TX-advertised latency_ns, RX's own
TX_LATENCY floor) — both sides lowered together each iteration;
identical subscription dance per iteration; 10 ms control re-run
between failures (clean, 48332 fps) validates the procedure.

| RX/TX latency | sink hw rate | verdict |
|---|---|---|
| 10 ms (default) | 48332 fps | ✓ clean |
| 7 ms | 0 fps (underrun cycling) | ✗ |
| 5 ms | 1228 fps | ✗ |
| 2 ms | 2252 fps | ✗ |

Failure signature at ≤7 ms: full wire rate (1514 pps) but playout
starves — packets arrive after their tightened playout deadline.
**TCG emulation floor is between 7 and 10 ms** (emulation jitter alone
exceeds 5 ms; on hardware with real NIC + HW timestamps the
Dante-standard 1 ms class should be reachable — re-test on silicon).

Caveat: the restore phase after the ladder hit the QEMU↔PipeWire
consumption wedge (frozen hw_ptr, full delay, full pps) — a HOST-side
rig issue, distinct from the latency results above; needs `systemctl
--user restart pipewire pipewire-pulse wireplumber` on the dev machine
and a re-validation boot.

## 4. Typical DSP-speaker latencies (context)

- Dante transport: 150 µs – 1 ms (default 1 ms @ 1 Gbit).
- Dante DSP amps/monitors, electrical in→out: ~2–5 ms (network 1 ms +
  DSP block + converters).
- Consumer wireless DSP speakers: 20–150 ms (for contrast).
- Our product estimate on HW: RX 1–2 ms + chunksize 256–512 (5–11 ms) +
  processing ≈ **10–25 ms** — competitive; chunksize is the dominant
  term, not Dante.
