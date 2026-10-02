# test-audio-flow — real Dante source → sync → sink

> **Status 2026-08-30**: historical snapshot — milestone test report of its
> execution date; rig era of its timestamp, not re-verified since.

`scripts/test-audio-flow.sh` is the (formerly optional) M4 flow test: real
audio, real flows, real clock sync, no root.

```
guest B (PTP master, rk3506b, 198.18.100.2) --\
                                                 +- QEMU mcast L2 tunnel
guest A (PTP slave,  rk3506a, 198.18.100.1) --/  (230.0.0.1:12346)
host "l2 node" 198.18.100.9  (scripts/dante-l2node.py)
```

## What it proves

- B's statime **masters** and self-clocks (deviation D10 patch — `shift_ns
  0` identity overlay), and can host an inferno TX instance while leading;
- A's statime **slaves** (real servo values), and ptp-monitor/hotplug
  auto-starts its camilladsp — which is then left completely untouched;
- a **Dante flow subscription** is created by the host l2 node speaking
  inferno's ARC control protocol; inferno accepts it (CODE_OK) and both
  channels (`01@rk3506b`, `02@rk3506b`) connect;
- audio fidelity: B plays 16× the M3 test signal
  (`/usr/share/camilladsp/test.wav` body, RawFile capture, 48 s) through
  `WavFile→Inferno`; A records `Inferno→File:/tmp/rx.wav`; the received
  per-second fingerprints match the source exactly (Lrms 13706, Rrms
  12423, Lzcr 3280, Rzcr ≈2900 — the signal repeats each second, so no
  offset alignment is needed).

## How the host reaches the guests (rootless)

`run-qemu.sh --net socket-mcast --peer GROUP:PORT` attaches guests to a
shared L2 segment tunneled over UDP multicast. `scripts/dante-l2node.py`
joins the same group and becomes a virtual host: it answers ARP for its
node IP and crafts IPv4/UDP in pure Python (no raw sockets, no
privileges), so it can talk to anything IP on the segment — here
inferno's ARC server.

## inferno ARC subscription protocol (reverse-engineered from the source)

`inferno_aoip/src/device_server/arc_server.rs` + `protocol/req_resp.rs` +
`proto_arc.rs`: UDP unicast to `<device-ip>:4440`, all big-endian:

```
u16 start_code = 0x27ff   u16 total_length   u16 seqnum
u16 opcode1    = 0x3010 (set_channels_subscriptions)   u16 opcode2 = 0
content: u8 space_items, u8 item_count,
         items (6 B each): u16 local_channel_id,
                           u16 tx_channel_name_offset, u16 tx_hostname_offset
         strings: NUL-terminated; offsets are PACKET-relative
```

Nonzero offsets = subscribe local rx channel to `"name"@hostname`
(inferno factory TX names are `"01"`, `"02"`, …); zero offsets =
unsubscribe (opcode `0x3014` is netaudio's variant of remove). Reply is
the same header with `opcode2 = 1` (CODE_OK). This is what
`network-audio-controller` (netaudio) drives remotely; we implement just
this one command because the guests' own mDNS handles device resolution.

## Test-ordering constraints (learned the hard way)

- subscribe **before** starting B's transmitter, or the wav source is
  drained with no listener and procd's crash-loop threshold kills the
  service permanently;
- never restart A's receiver after subscribing — the flow lives in the
  running instance;
- B's source must outlive the measurement window (48 s) for the same
  reason;
- busybox `od` silently truncates large `-j`/`-N` dumps — extract
  windows with `tail -c +N | head -c M` and chunk the `od` calls (see the
  rig);
- the first boot of B's camilladsp (S75, default config) crash-loops
  until the clock locks; the rig stops it once `enabled=0` is committed.

The receiver-side warnings to expect in `logread`:
`channel subscribed to NN@host is orphaned now` / `flow index=0 timeout`
when B's source ends — that is the flow teardown, not a failure.
