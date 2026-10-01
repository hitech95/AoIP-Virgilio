# Event-driven lifecycle for inferno/camilladsp (PTP + network hotplug)

Status: **implemented + validated** (slirp/combined, split-topology
socket rig, and the real-mode bridge rig incl. GM loss/return — see
`docs/lifecycle.md` §Validation). Remaining hands-on rows: physical
cable-pull timing, zcip→DHCP address ladder on hardware.
Supersedes the 60 s drift-restart inside the ptp hotplug (commit
2cda580) and formalizes the iface hotplug that was attempted and
shelved during that work. Blocks the Zero 2 W port (WiFi link loss
exercises this lifecycle constantly).

## Problem

camilladsp (hosting inferno in-process) is started/stopped by a patchwork
of triggers, and the failure modes show it:

1. **Link loss on the sink** (cable pull, WiFi roam): statime panics on
   the missing send timestamp (mainline bug, main.rs:715/1048), procd
   restarts it, the ptp hotplug bounces camilladsp through lost→locked,
   and before inferno 0005 the teardown race panicked and left the ring
   looping. Even with 0005 the bounce is a full DSP restart for a 2 s
   link flap.
2. **Address changes** are detected by polling: the ptp hotplug compares
   the cached preferred IPv4 on every ~60 s `locked` re-emit — up to a
   minute of stale advertisement after "zcip claimed, DHCP lease arrives
   later".
3. **Boot order without an address**: when PTP locks before zcip/DHCP
   provides any IPv4, the ptp hotplug starts camilladsp and inferno
   `expect()`s (crash loop until an address exists; mainline bug).
4. **Network recovery** is only self-healing by luck of retry loops; the
   system has no intentional "network down → service down, network up →
   service (re)starts with the fresh address" rule.

## Requirements

1. Every transition of the Dante service is **event-driven**: netifd
   iface hotplug (ifup/ifdown) + ptp hotplug (locked/lost). No polling.
2. **Link down** on the inferno netdev: camilladsp (and ideally statime)
   stop cleanly and immediately — before statime's send-timestamp panic,
   before any inferno stall/timeout handling has to run.
3. **Address appears/changes** (zcip claim after DHCP failed; DHCP lease
   after zcip; manual reconfig): camilladsp (re)starts with the fresh
   address — the global-first preference of inferno 0004 resolves at
   start, so a restart IS the re-resolution.
4. **Renewals that keep the address** are silent (no restart).
5. **PTP lost** stops camilladsp (no clock = no valid media); **PTP
   locked** starts it only when nothing is running (boot case) AND the
   netdev already has at least one address (kills the crash loop of
   problem 3).
6. Works for combined topology (lan+aoip on one netdev) and split; the
   watched object is the **resolved inferno netdev** (uci
   `inferno.main.interface` → logical netifd name → `network.<x>.device`),
   same resolution semantics as genconf/statime init.
7. All triggers idempotent and race-tolerant (events can arrive in any
   order, in bursts: ifup aoip + ifup lan back-to-back, lost+locked
   flapping).

## Design

Two procd hotplug handlers own disjoint concerns:

| event | source | action |
|---|---|---|
| `ifdown` on the inferno netdev | iface hotplug | stop camilladsp; stop statime (see below) |
| `ifup` on any iface on the inferno netdev | iface hotplug | start/restart camilladsp **iff** PTP locked and the preferred address drifted from the cache (start case: not running); refresh the cache |
| `ptp lost` | ptp hotplug | stop camilladsp |
| `ptp locked` | ptp hotplug | start camilladsp iff not running, PTP locked, netdev has ≥1 IPv4; seed the address cache |

Key decisions:

- **The address cache** (`/tmp/camilladsp.resolved-addr`) stays the
  drift detector: written on every (re)start, compared on every ifup.
  Renewal-ifup with an unchanged address = no-op. Burst dedup falls out
  for free (second event compares equal).
- **statime stop on ifdown**: stopping statime when the netdev goes down
  avoids its link-loss panic entirely (procd would restart it into a
  no-network state anyway). ifup starts it back; its BMCA re-runs, the
  ptp `locked` event then drives camilladsp. This makes the mainline
  statime panic cosmetic (still to be fixed upstream, but nothing in the
  appliance depends on it).
- **The 60 s drift-restart inside the ptp hotplug is removed** — the
  `locked` re-emit keeps only the idempotent start-if-not-running
  self-heal and the crash-loop recovery.
- **Boot convergence**, both orders:
  - address-first (fast DHCP): zcip/DHCP ifup arrives, PTP not yet
    locked → no start; `locked` arrives → start with address ✓
  - lock-first (isolated segment, ll-only): `locked` arrives, no address
    yet → no start (guard 5); zcip claims → ifup → start ✓
- **inferno netdev resolution + preferred-address computation** reuse
  `usr/lib/camilladsp/inferno-net.sh` (already shipped in the camilladsp
  package).

Open item to verify first: **netifd iface-hotplug dispatch in this
build**. The earlier attempt failed for script bugs (`$( )` subshell
dropping `config_load` state; `ubus -S` misuse), not demonstrably for
missing dispatch — netifd ships `00-netstate` in the same dir. Step 1 of
the work items is a dispatch probe before anything else.

## Work items

1. **Dispatch probe** (rig): `/etc/hotplug.d/iface/99-debug` logging
   ACTION/INTERFACE/DEVICE; real `ifup`/`ifdown` + link toggle; confirm
   the event stream and its env (DEVICE vs option lookup).
2. **iface hotplugs** (camilladsp package): `etc/hotplug.d/iface/40-statime-net`
   (statime side: stop on real link loss with the grandmaster carve-out,
   start-if-idle on ifup) and `etc/hotplug.d/iface/60-camilladsp`
   (camilladsp side: netdev-gated ifdown stop; ifup/ifupdate delegate to
   the init script's `check`).
3. **ptp hotplug slim**: `10-camilladsp` back to start-if-not-running
   (plus the ≥1-IPv4 guard + cache seed) and stop-on-lost; drop the
   drift branch.
4. **statime init**: no change expected (procd already owns restart);
   only the hotplug-driven stop/start pair.
5. Docs: `docs/inferno.md` lifecycle section; dependency-map note.
6. **Documentation pass — begin the project documentation set.** So far
   docs are per-feature notes (camilladsp.md, inferno.md, bridge-rig*.md)
   plus a dependency map; nothing explains the system as a whole. This
   work item starts the coherent set and becomes the convention going
   forward (each feature lands with its doc):
   - `docs/architecture.md` — how the system works end-to-end: boot
     chain (squashfs+overlay, preinit pivot), the OpenWrt-style service
     model (procd rc.d, hotplug dispatch, uci), the stack roles
     (inferno pcm inside camilladsp, statime usrvclock, netifd +
     addressing ladder, webui/policy model), the Dante/AES67 flow path
     (MPD -> aloop -> camilladsp -> inferno RTP), and pointers into the
     per-feature docs.
   - `docs/lifecycle.md` — the authoritative write-up of THIS plan's
     implemented behavior: every trigger, the state table, the guards,
     and the failure timeline (what happens second-by-second on link
     loss). The rig validation log doubles as its worked example.
   - dependency-map.md + README updated to link both.
7. Mainline follow-ups (separate, not blockers): statime link-loss panic,
   inferno `expect()` on addressless BIND_IP at PCM open, inferno 0005
   upstream.

## Validation matrix (QEMU rig, real-mode bridge)

| scenario | expectation |
|---|---|
| boot, address-first / lock-first | one camilladsp start, correct address, no crash loop |
| sink link down 10 s → up | camilladsp stopped at ifdown (before any statime panic log), statime stopped; on ifup statime → locked → camilladsp start; audio back; zero panics |
| zcip then DHCP (address ladder) | ll-address start on aoip ifup if lock already held; restart on lan ifup with the global; sink discovers the global |
| DHCP renewal, same address | silent (no restart lines) |
| source camilladsp stop/start | unchanged behavior (0005 self-heal), no lifecycle churn |
| PTP GM loss > timeout | camilladsp stops on `lost`; restarts when GM returns |
| rapid flap (down/up ×3) | converges to running+locked+subscribed; no crash loops |

## Risks / notes

- If iface dispatch proves broken in this netifd build, fallback = keep
  the ptp-hotplug drift poll but add the ifdown stop via the ptp `lost`
  path only (slower, acceptable), and fix netifd dispatch as its own
  item.
- Stopping statime on ifdown resets the PTP dataset (BMCA re-run): fine
  for slaves; on a GM-capable box (zero2w as master) this must NOT stop
  statime — gate on `statime.main.slave_only`/priority (zero2w: master,
  keep statime running through link flaps where possible).
- The `keep` semantics of procd hotplug bursts: handlers must be fast
  (no blocking waits) — all actions are `service X stop/start` calls.
