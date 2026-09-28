# Configurable inferno bit depth, rendered from the camillaDSP config

Status: **implemented (host-side)** — inferno patch 0003, genconf mapping +
genconf-test depth cases, shipped-uci flips (srcqemu S24_3_LE = wire 24,
rpi2b S32_LE boundary-only) and docs done; rig validation (§Validation
2–4) and the on-device manifest flip check (§Work items 3) still pending.

## Problem

`inferno_aoip/src/device_server/settings.rs:133` hardcodes the wire/advertised
sample depth:

```rust
bits_per_sample: 24, // TODO make it configurable
```

The depth is otherwise fully dynamic downstream (advertisement → flow request
→ `write_s16/s24/s32_samples` / `S16/S24/S32ReaderIterator` per flow), so this
is the single constant to plumb. In our product the natural source of truth is
the camillaDSP configuration: `option format` in `uci camilladsp.main` already
expresses the processing depth, and `camilladsp-genconf` already renders
`INFERNO_*` instance settings into `/tmp/camilladsp.env` (init merges them;
uci `list env` overrides).

Goal: `option format 'S24_LE'` ⇒ inferno instances advertise and negotiate
24-bit on the wire; `S16_LE` ⇒ 16; `S32_LE` ⇒ 32. No new user-facing knob.

**Directionality**: the configured depth is a **TX-path property** — what
this device advertises and packs as a transmitter (`DeviceInfo.bits_per_sample`
feeds only the TX advertisement/ARC self-description and the TX-side packing).
The RX path stays source-driven by construction: a receiver resolves the
sender's advertisement and requests/unpacks whatever that sender offers
(`flows_rx.rs` selects S16/S24/S32 readers per flow; no local depth involved).
The setting is therefore named for TX and only emitted for TX (playback
`Inferno`) instances.

## Design

| uci `format` | wire `bits_per_sample` |
|---|---|
| `S16_LE` | 16 |
| `S24_LE`, `S24_3LE` | 24 |
| `S32_LE` | 32 |
| anything else / unset | 24 (upstream default) |

Layering stays as-is (see docs/bridge-rig-hw-sink.md "32 vs 24"):

- `uci format` remains the camilladsp↔plugin ALSA boundary (plugin exposes
  S32 only; alsa-lib ioplug converts). Mapping it to the wire depth makes the
  chain shift-only, but any mismatch still *works* (padding/truncation at the
  boundary), it is never a failure.
- Capture and playback `Inferno` specs on one box resolve to the same shared
  instance (name = hostname) ⇒ one depth per box, derived from the single
  `format` option. No per-direction knob.

## Work items

### 1. inferno patch (`br-external/package/inferno/0003-bits-per-sample-configurable.patch`)

Generated from the stacked tree (upstream pinned rev + 0001 + 0002; same
fresh-extract recipe as camilladsp 0004 — regenerate and diff until
byte-identical before editing).

- `device_server/settings.rs`
  - after the `RX_LATENCY_NS` block:
    `tx_bits_per_sample: settings.get("TX_BITS_PER_SAMPLE")` → parse u8 →
    must be one of 16/24/32, else `expect` with a clear message (same error
    style as `ALT_PORT` / `RX_LATENCY_NS`); default 24 when unset.
  - replace the hardcoded `bits_per_sample: 24` with the parsed value; add a
    comment marking the field as **TX-advertised depth** (RX is source-driven
    and never consults it).
  - env plumbing is free: settings already absorb `INFERNO_*` env vars
    (settings.rs:174), so `INFERNO_TX_BITS_PER_SAMPLE=24` reaches the map
    without code.
- `device_server/flows_control_server.rs` (hardening, while we're there)
  - the request handler validates `sample_rate` but trusts the requested
    `bits_per_sample`; the TX write path `match bytes_per_sample {2,3,4}`
    comes straight from the network. Reject requests whose bits are not
    16/24/32 (`FlowControlError` code) instead of relying on integer-division
    luck. Keep it permissive vs our own advertisement otherwise (Dante
    semantics: Rx asks, Tx honors if it can).
- No plugin changes (`alsa_pcm_inferno` stays S32-only at the ALSA boundary).
- Changelog/README note per upstream conventions (it's our local patch; a
  comment at the patch top explaining the product reason suffices).

### 2. genconf (`br-external/package/camilladsp/files/usr/bin/camilladsp-genconf`)

Direct edit (package file, not a patch):

- Map `main.format` → depth with the table above.
- Emit `INFERNO_TX_BITS_PER_SAMPLE=<depth>` into the `/tmp/camilladsp.env`
  sidecar **only when the TX side is an Inferno spec**
  (`option playback 'Inferno...'`). An RX-only box (capture `Inferno`,
  playback something else) gets no depth setting: its wire behavior is
  dictated by the remote TX advertisement.
- Explicit uci `list env 'INFERNO_TX_BITS_PER_SAMPLE=...'` entries keep
  precedence over the sidecar (existing init merge rule).
- Update `scripts/genconf-test` with a case per format value.

### 3. Manifest interaction (check, likely none)

The manifest hashes the rendered config; `format` lives in the devices
section which genconf + `--make-manifest` regenerate together on every
`service camilladsp restart`, so a depth change is consistent by
construction. Verify once on the device that a format flip under
protection passes `--make-manifest` (devices are outside the locked
pipeline policy).

### 4. Config/docs

- Optionally flip the rpi2b default to `option format 'S32_LE'` (zero
  conversions end-to-end; the wire stays 24 unless the uci says otherwise —
  separate decisions, document both).
- `docs/camilladsp.md` inferno section + `docs/bridge-rig-hw-sink.md` "32 vs
  24" paragraph: note the mapping and the boundary-vs-wire distinction.

## Validation

1. **Unit/host**: `cargo test` on the stacked inferno tree; settings parse
   tests for 16/24/32 + garbage.
2. **Wire proof on the rig** (source guest ↔ RPi2):
   - `tcpdump -n udp and host 192.168.1.234` — packet length moves with the
     depth: at 2ch/48k expect payload ≈ `9 + fpp*2*bytes` per packet
     (201 B observed at 24-bit today ⇒ ~134 B at 16, ~268 B at 32 with the
     same fpp).
   - Subscription re-establishes after each `service camilladsp restart`
     (or re-fire the ARC subscribe; sink RULE: restart sink only before
     subscribing).
3. **Matrix** on the RPi2 (all with `state: Running`, `capture_rate ≈ 48000`,
   `logread | grep -ci xrun` == 0). Depth knob = source guest uci `format`
   (TX side); sink uci `format` is boundary-only:
   - source `S24_LE` (wire 24) / sink `S16_LE` (current default) — boundary
     truncation only
   - source `S24_LE` (wire 24) / sink `S32_LE` — shift-only chain
   - source `S16_LE` (wire 16) / sink `S16_LE`
   - RX-side sanity: while the source depth changes, the RPi2's subscription
     re-negotiates to the new advertisement with no sink-side setting touched
     (source-driven RX proof).
4. **Interop (optional)**: Dante Virtual Soundcard on a PC against the
   inferno sink — DVS requests 32-bit flows; confirm `write_s32_samples`
   path (and the new request validation doesn't reject it).

## Risks / notes

- Real Dante Rxs honor the Tx's offered depth, so flipping an inferno
  source's depth does not strand Dante listeners — they shift to fit.
- inferno state persistence saves subscriptions, not flow depths; a depth
  change across restarts is re-negotiated from the advertisement. A stale
  flow from a previous depth times out and re-resolves (seen in practice).
- `pcm_type: 0xe` in DeviceInfo is untouched (device-class hint, not depth).
- Patch base: upstream pinned rev + 0001 + 0002; verify with the
  regenerate-until-identical recipe before adding our hunks.
