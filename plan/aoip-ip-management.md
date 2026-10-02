# AoIP IP management: multi-netdev, DHCP/static, link-local fallback

> **Status 2026-10-02**: implemented (host-side) — zcip proto handler + busybox applet,
> logical interface resolution (genconf + statime init, split-clock/media
> invariant), inferno patch 0004-global-address-preference, rpi2b overlay
> zcip + logical-name defaults, docs done. Buildroot builds of busybox/
> netifd/statime/camilladsp/inferno verified; genconf-test 37/37; cargo
> test 98/98. Rig/hardware validation (§Validation matrix) pending. Patch
>  numbering: the address-preference patch shipped as 0004 (0003 is
>  bits-per-sample).

## Problem

Real Dante devices never end up addressless: static (if set) → DHCP →
link-local (Auto-IP, RFC 3927) is their addressing ladder, because a Dante
rig must come up on a bare switch. Our product image does none of that:
`lan` is DHCP-only on eth0 with no fallback, `aoip` is `proto none`, and
inferno/statime derive their IPv4 from whatever the interface happens to
carry. No DHCP ⇒ no address ⇒ no Dante.

## Requirements

1. **Multi-netdev**: up to two ports; AoIP+MGMT may share one port, or AoIP
   moves to the second port (`eth0`/`eth1`), selected in uci.
2. **DHCP and static** must both work (management and/or AoIP).
3. **Link-local fallback**: the AoIP interface always has an address, even
   standalone on a bare switch.

## Addressing model (accepted design)

Per-interface roles, using netifd's multi-protocol-on-device support:

| interface | device | proto | role |
|---|---|---|---|
| `aoip` | `network.aoip.device` (`eth0`/`eth1`) | `zcip` (new) — **always link-local** | Dante/PTP presence, never absent |
| `lan` | `network.lan.device` | `dhcp` or `static` | management + preferred Dante address |
| (rig) | as above | `static` 198.18.100.x | rig overlays keep today's static AoIP |

Rules that make it behave like real Dante:

- **`aoip` always starts link-local** — presence is guaranteed before any
  infrastructure exists. RFC 3927 semantics (random address in
  169.254/16, ARP-probed for conflicts, re-probe on conflict).
- **Address preference is global-first**: inferno uses a global (DHCP/static)
  IPv4 when the AoIP device has one, and the link-local only when it doesn't.
  This keeps us reachable by Dante Controller on DHCP laptops when a network
  exists, and standalone-capable when it doesn't. (Divergence from real
  Dante: we keep *both* addresses instead of dropping link-local on lease —
  harmless; the global one wins for all inferno sockets.)
- Static AoIP (rig) is honored as-is: `proto static` on `aoip` skips zcip
  (the proto handler is opt-in per address mode).

Topology is then free: **combined** (aoip+lan both on eth0 — the single-port
default) or **split** (aoip on eth1, lan on eth0) purely by uci device
assignments; inferno/statime follow `network.aoip.device`.

## Work items

### 1. netifd proto handler `/lib/netifd/proto/zcip.sh`

- New proto `zcip`: `proto_config_init 'zcip'`, runs
  `zcip -i <ifname> -s <script>` (busybox) in procd context; the zcip event
  script assigns the address (ip addr add + label) and signals
  `proto_init_update`/`proto_send_update` AVAILABLE.
- Busybox applet `zcip` must be enabled (currently **not** in the image —
  add to the busybox config fragment / `BR2_PACKAGE_BUSYBOX_CONFIG`;
  verify the applet is in our busybox version).
- `teardown`: remove address, kill zcip.
- Deferral guard: zcip probes take seconds; netifd brings `aoip` up
  asynchronously — inferno/statime must tolerate an interface that is up but
  addressless for a few seconds (see 4).

### 2. Board network overlays

- rpi2b (`br-external/board/rpi2b/rootfs-overlay/etc/config/network`):
  - `aoip`: device eth0, `proto zcip` (replaces `proto none`).
  - `lan`: unchanged (dhcp, eth0). Combined mode default.
- rig overlays (rk3506qemu single-nic fixup): unchanged static AoIP.

### 3. genconf rendering — resolve, don't override

- `inferno.main.interface` and `statime.main.interface` keep existing in
  uci, but their value becomes a **logical netifd interface name**
  (default `aoip`), resolved by genconf against `/etc/config/network`:
  1. if the value names a `network.<section>` with `option device` → use
     that netdev (e.g. `aoip` → eth0/eth1, whatever the device option says);
  2. else, if it names an existing raw netdev (`/sys/class/net`) → use it
     as-is (back-compat with today's `eth0`-style values);
  3. else fall back to the `aoip` resolution with a logged warning.
- Moving AoIP to the other port is then a **single uci change**
  (`network.aoip.device`); inferno/statime keep saying `aoip` and follow
  automatically. Board overlays switch to `option interface 'aoip'`.
- Invariant: PTP and media must share the L2. With both options at their
  default `aoip` this holds by construction; if a user resolves them to
  *different* netdevs, genconf fails loudly (config error) rather than
  rendering a split clock/media setup.

### 4. inferno patch (`br-external/package/inferno/0004-global-address-preference.patch`)

- `device_info.rs` / settings interface scan: when the bound interface has
  multiple IPv4 addresses, prefer **global over link-local** (169.254/16).
  Today it takes the first found — ambiguous exactly in combined mode where
  zcip and DHCP coexist on one device.
- One-line semantic, a few lines of code; same patch-series discipline as
  `0003-bits-per-sample-configurable` (stacked tree,
  regenerate-until-identical, fresh-extract replay). Final numbering:
  address-preference = 0004, bits-per-sample = 0003 (`docs/patches.md`).
- statime needs no code: it binds the device; kernel source selection for
  the PTP multicast socket is acceptable (worst case announcements leave
  with the global source — same L2 either way). Revisit only if a real
  Dante device joins the L2.

### 5. Apply/restart flow (unchanged mechanics)

- Device/mode changes: `uci commit network && /etc/init.d/network restart`,
  then camilladsp restart (inferno settings re-render) — same path the
  webui-inferno settings page already uses (documented debt in
  plan/webui-app-inferno-decoupling.md; not worsened by this change).

## Validation matrix

| scenario | expectation |
|---|---|
| standalone RPi2 + dumb switch (no DHCP) | aoip zcip-addresses 169.254/16; inferno advertises via mDNS; second inferno box (also ll) discovers and streams |
| home LAN (DHCP present), combined eth0 | inferno uses the DHCP global address; ll also present; webui + Dante-C-style tools reach the global |
| split ports: aoip=eth1 (ll), lan=eth0 (dhcp) | Dante on eth1 ll; management on eth0; no cross-talk |
| rig (static 198.18.100.x) | unchanged behavior, no zcip |
| DHCP server disappears mid-lease | global kept until expiry, ll already up — Dante never drops |
| PTP | both modes lock to the GM (multicast is interface-scoped, address-agnostic) |

Also verify: `logread` shows zcip probes/conflicts cleanly; rapid
eth0↔eth1 moves re-render inferno settings correctly; boot order
(network before camilladsp) still yields a subscribed sink via the PTP
hotplug.

## Risks / notes

- **Dante Controller vs link-local**: DC on a DHCP laptop has no
  169.254/16 route — it reaches us via the global address only. This is why
  the preference rule (global-first) matters; ll-only is the standalone
  regime where DC runs on a machine that is itself link-local.
- **zcip conflict storms** are the classic Auto-IP failure mode; busybox
  zcip implements the RFC 3927 probing/defense — keep the default timings.
- **Two addresses, one mDNS advertisement**: inferno advertises one
  address (the preferred one) — fine. If a Dante device on the ll regime
  and another on the global regime must interoperate, they can't route to
  each other — same limitation as real Dante (all devices converge on the
  same regime once a DHCP server is present/absent).
- QEMU rig `--no-mgmt` single-NIC fixup (S05) sets `aoip` static — keep
  that behavior; zcip is the *product* default only.
