# M4 test — two-guest PTPv2 + inferno capture (`scripts/test-two-guests.sh`)

## Purpose

Dante (and therefore inferno) cannot exchange media over QEMU's default
user-mode networking (slirp): PTP and mDNS multicast do not traverse it
reliably, and there is no Dante peer on the host network. This test proves
the full M4 chain — **PTP clock synchronization between two guests and
clock-timed audio capture through the inferno ALSA plugin** — using only
rootless QEMU features.

## Topology

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ guest B ("ptp master")       │        │ guest A ("device under test")│
│                              │        │                              │
│  statime, priority1 = 128    │        │  statime, priority1 = 251    │
│  → PTPv2 GrandMaster         │        │  → PTPv2 Slave (kalman-locked│
│                              │        │    virtual clock)            │
│  eth1 198.18.100.2          │        │  usrvclock socket            │
│  MAC 00:11:22:33:44:56       │        │    /tmp/ptp-usrvclock        │
│                              │        │  arecord -D inferno          │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
               │  -netdev socket,listen=:12345         │
               └──────────── L2 pipe (TCP) ────────────┘
                        -netdev socket,connect=:12345
```

The link is QEMU's `socket` network backend: guest B listens on
`127.0.0.1:12345`, guest A connects — QEMU tunnels **raw Ethernet frames**
(including multicast) between the two. No tap, no bridge, no root.

Multicast used on the link:

| Group | Purpose |
|---|---|
| `224.0.1.129` (IPv4 PTP) | Announce/Sync/FollowUp/DelayReq-Resp (PTPv2 event+general) |
| `224.0.0.251` (mDNS) | Dante device discovery (not exercised by this test) |

## What the script does

`scripts/test-two-guests.sh` boots **two** instances of the same firmware
image (both `-snapshot`, so the golden image is never touched):

1. **guest B** (`--net socket-listen --peer 127.0.0.1:12345 --mac …:56`)
   - static IP `198.18.100.2/24` (no DHCP server exists on the link)
   - `uci set statime.main.priority1='128'` → lower BMCA priority
   - `service statime restart` → expect log `new state: Listening -> Master`

2. **guest A** (`--net socket-connect --peer 127.0.0.1:12345`)
   - static IP `198.18.100.1/24`
   - statime keeps the default `priority1=251` → loses BMCA against B →
     expect `Listening -> Master` followed by `Master -> Slave`, then
     continuous `Stepped clock by …` kalman messages (active sync)
   - `ping 198.18.100.2` proves basic L2/IP connectivity

3. **capture on A**:

   ```sh
   INFERNO_BIND_IP=198.18.100.1 arecord -D inferno -f S32_LE \
       -r 48000 -c 2 -d 8 /tmp/rx.wav
   ```

   Success criteria (all verified when this test was written):

   - exit code 0
   - `/tmp/rx.wav` = **3,072,044 bytes** = 44 B WAV header + 8 s × 48,000 ×
     2 ch × 4 B — exactly 8.000 s of media captured on the PTP clock
   - plugin log sequence: `started receiver` → `plugin_start` →
     `clock_receiver updated` → `media_clock overlay updated` →
     `clock appeared` → (after -d 8) `plugin_stop`
   - the audio is **silence**: no Dante subscription exists, so the plugin
     delivers zero samples timed by the synced media clock — this is
     exactly the "records silence" milestone; content flows are the
     optional next step (TX + `netaudio` subscription)

## Known gotchas (encoded in the script)

| Gotcha | Mitigation |
|---|---|
| statime rejects locally-administered MACs (QEMU default `52:54:00:…`) | `--mac 00:11:22:33:44:5X`, different per guest |
| No default route on the isolated link → inferno's `local_ip_address` autodetect panics (`LocalIpAddressNotFound`) | `INFERNO_BIND_IP=<ip or iface>` |
| No DHCP on the socket link | static `network.lan` via uci in both guests |
| Both guests boot the same image | distinct IPs/MACs give distinct inferno `DEVICE_ID`s (derived from the IP) |

## Running / extending

```sh
./scripts/test-two-guests.sh          # ~2.5 min, prints both guest logs
```

To extend towards real audio flows:

- on B: `INFERNO_BIND_IP=… aplay -D inferno <file.wav>` (the plugin also
  implements TX) with `TX_CHANNELS` configured;
- create subscriptions with [`netaudio`](https://pypi.org/project/netaudio/)
  (`pip install netaudio`; `netaudio subscription add --rx-device-name A
  --tx-device-name B …`) — it must run on a node attached to the L2 link
  (e.g. inside one of the guests, or re-add slirp as a second NIC and
  host-forward the control ports);
- the inferno repo ships `test/dockerized_trx` for container-based
  end-to-end comparisons — usable as a reference transmitter once bridged
  networking is available (needs root, currently out of scope).
