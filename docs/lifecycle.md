# Service lifecycle — the event-driven Dante service model

Authoritative write-up of how **camilladsp** (hosting the inferno Dante
stack in-process) and **statime** (the PTP clock it depends on) are
started and stopped. Everything is **event-driven**: netifd iface
hotplugs plus the ptp hotplug — no polling loops, no periodic
drift-restarts. Component background: [docs/inferno.md](inferno.md)
(stack roles), [docs/ptp-monitor.md](ptp-monitor.md) (lock detection),
[docs/camilladsp.md](camilladsp.md) (the service itself). System-level
overview: [docs/architecture.md](architecture.md).

## The two dispatchers

| dispatcher | mechanism | events | handlers |
|---|---|---|---|
| **netifd iface hotplug** | netifd forks `/sbin/hotplug-call iface` per interface event (serialized FIFO, one at a time) | `ACTION=ifup\|ifdown\|ifupdate`, `INTERFACE=<logical>`, `DEVICE=<netdev>` (ifup/ifupdate only), `IFUPDATE_ADDRESSES=1` iff the address set really changed | `/etc/hotplug.d/iface/*` (`00-netstate`, `40-statime-net`, `60-camilladsp`) |
| **procd ptp hotplug** | ptp-monitor calls the `hotplug.ptp` ubus object (procd's inotify hotplug dispatcher); `locked` re-emitted every ~60 s while locked (self-heal heartbeat) | `ACTION=locked\|lost`, `PTP_CLOCK_PATH`, `PTP_SHIFT_NS`, `PTP_FREQ_PPM` | `/etc/hotplug.d/ptp/*` (`10-camilladsp`) |

Dispatch verification (the "does this build even deliver iface events"
question that once blocked the design): netifd `interface-event.c` (pin
`cbb83a1`) queues `IFEV_{DOWN,UP,UP_FAILED,UPDATE}` per interface and
execs `/sbin/hotplug-call iface` with the env above; `interface-ip.c`
sets `IUF_ADDRESS` — and netifd exports `IFUPDATE_ADDRESSES=1` — only
when an address node was added or removed, so **a DHCP renewal that keeps
the address carries no address flag and stays silent**. netifd also
coalesces: a pending not-yet-run event for the same interface is
overwritten by a newer one, which deduplicates flap bursts before they
reach the handlers.

## The watched object

Both hotplug handlers gate on the **resolved inferno netdev**:

```
uci inferno.main.interface  ->  logical netifd name  ->  network.<x>.device
                                                             (raw netdev names pass through)
```

Resolution lives in `usr/lib/camilladsp/inferno-net.sh`
(`cdsp_inferno_dev`), kept in sync with camilladsp-genconf and the
statime init. This makes the lifecycle topology-agnostic:

- **split** (`rk3506qemu` rig): `lan` on eth0, `aoip` on eth1 — only
  `aoip` events pass the gate;
- **combined** (`srcqemu`, `rpi2b`, the Zero 2 W port): `lan` + `aoip`
  share eth0 — **both** interfaces' events pass, which is exactly right:
  a DHCP lease arriving on `lan` is the "preferred address appeared"
  event for the shared netdev.

## State table

**Single rendering point**: `/etc/init.d/camilladsp start_service` is the
only place that resolves and records the advertised-address baseline —
every start (boot S75, manual, drift restart) writes the IPv4 the fresh
inferno instance will resolve to `/tmp/camilladsp.resolved-addr`
(first global, else first any — mirroring inferno patch 0004; an
addressless start leaves it absent). **Single decision point**: the
init script's custom `check` command (`service camilladsp check` /
`/etc/init.d/camilladsp check`) — start iff PTP locked + netdev link up
+ ≥1 IPv4 + not running, restart iff the preferred IPv4 drifted from
the baseline, silent otherwise. The hotplug handlers only gate events:
`40-statime-net` owns the statime side, `60-camilladsp` delegates the
camilladsp side to `check`.

| event | guard | action |
|---|---|---|
| iface `ifdown`, netdev = inferno's | camilladsp running | **stop camilladsp** — before any inferno stall handling has to run (60-camilladsp) |
| same | statime running **and** netdev link actually down (`state UP` fails) **and** not grandmaster-configured (`slave_only=0` and `priority1 < 249`) | **stop statime** (its next send on the dead link would panic; procd would restart it into the dead link anyway) (40-statime-net) |
| iface `ifup`, netdev = inferno's | statime not running | **start statime** — BMCA re-runs, ptp-monitor settles, the resulting `locked` event completes the chain (40-statime-net) |
| iface `ifup` / `ifupdate` w/ `IFUPDATE_ADDRESSES=1`, netdev = inferno's | — | **`camilladsp check`** (60-camilladsp) |
| ptp `locked` (also every ~60 s) | — | **`camilladsp check`** (boot convergence + crash-loop self-heal) |
| ptp `lost` | camilladsp running | **stop camilladsp** (no clock = no valid media) |

Inside `check`:

| state | precondition | action |
|---|---|---|
| not running | `camilladsp.main.enabled=1`, PTP locked (`ubus call ptp status`), netdev link `state UP`, netdev has ≥1 IPv4 | **start** (start_service renders + seeds the baseline) |
| running | preferred IPv4 ≠ baseline | **restart** (inferno resolves its advertised address once at start — a restart IS the re-resolution) |
| anything else | — | silent |

Guards worth calling out:

- **PTP-locked guard on starts**: a start without a clock is pointless —
  the inferno plugin would stall in `snd_pcm_hw_params` (ETIMEDOUT
  after ~5 s) and crash-loop.
- **Link-up guard on starts**: a grandmaster-configured box keeps
  statime self-clocking through link outages (usrvclock is a *local*
  socket), so `locked` stays true and the 60 s locked heartbeat keeps
  firing — without the link guard the heartbeat would restart the DSP
  onto a dead link. See the ordering scenarios below.
- **≥1-IPv4 guard on starts**: a start without an address crash-loops
  worse — inferno `expect()`s the BIND_IP resolution at PCM open
  (mainline bug). Together the guards close the boot ordering hole:
  whichever of *address*, *link* or *lock* arrives first, the service
  only comes up when all exist.
- **Grandmaster gate on the statime stop**: a box configured to WIN BMCA
  (`slave_only=0`, `priority1` below Dante hardware's 249 — e.g. the
  Zero 2 W master) keeps statime running through link flaps: it *is* the
  segment clock, and a quick carrier return resumes it without a BMCA
  re-run. Everyone else (slaves, default `priority1 251` "slave unless
  nobody better") stops statime on link loss — the deterministic
  alternative to the send-timestamp panic. Caveat (measured on the
  slirp rig): the mainline panic hits masters too — a master *sends*
  syncs — so on a real outage the kept statime still dies and procd
  stops respawning it; harmless (ifup restarts it and the chain
  recovers, see the ordering scenarios), and the mainline fix remains
  the real cure.
- **statime stop only when the link is really gone**: administratively
  downing *one* of several logical interfaces on a still-up netdev
  (e.g. `ifdown lan` with `aoip` holding the device) stops camilladsp
  but leaves statime (and the clock) alone.

## Ordering scenarios (grandmaster master-mode)

The interesting cases, with statime configured as grandmaster
(`slave_only=0`, `priority1 < 249` — e.g. the Zero 2 W source):

- **PTP stays up while the netdev is down.** A GM box keeps statime
  running through the outage (grandmaster gate) and the usrvclock
  socket is *local*, so statime keeps self-clocking: `ptp status` stays
  `locked:true`, the `lost` event never fires, and the 60 s `locked`
  heartbeat keeps calling `check`. camilladsp still stays down: the
  **link-up guard** (and the address guard behind it) fails while the
  netdev is down. When the link returns, `ifup` → `check` → both guards
  pass → start. Expectation "PTP up + link down ⇒ DSP stays shutdown"
  is encoded by the guards, not by an event.
- **Link comes back after a `ptp lost`** (slave case: the GM
  disappeared, `lost` stopped camilladsp; the link loss also stopped
  statime). On `ifup`, 40-statime-net restarts statime, BMCA re-runs,
  ptp-monitor re-locks and the `locked` event runs `check` → camilladsp
  starts with the fresh address. Either ordering of "link returns" and
  "clock returns" converges: each event re-runs `check`, and `check`
  starts only when everything holds.
- **`ifup` racing a statime restart (stale lock).** ptp-monitor's lock
  lags a statime restart by up to `lost_timeout` (package default 5 s,
  boards may raise it), so the `check` on the same ifup burst may see
  `locked:true` while the new statime is still electing/re-locking. The
  early start can lose the race (inferno waits only ~5 s for the clock)
  and exit once; procd respawn and the following `locked` event (or the
  60 s heartbeat) converge within ≤60 s. On segments with a live GM the
  relock after link return is sub-second and the race is normally won;
  it mainly shows on self-electing (lone-node) segments. Tuning knob:
  `ptp-monitor.main.lost_timeout`.

## Operator contract

- `service camilladsp stop` is **temporary** while
  `camilladsp.main.enabled=1` and lock+link+address hold: the 60 s
  locked heartbeat re-runs `check` and starts it again. To keep the
  service down, set `uci camilladsp.main.enabled='0'` (validated: stays
  down through heartbeat and ifup; re-enabling + `check` starts it).
- Crash loops self-heal the same way: after procd's respawn threshold
  gives up, the heartbeat re-arms the service (validated: 7× `kill -9`
  → procd gives up → heartbeat restart within 60 s).

## Boot convergence

Boot also starts the trio classically (`S60` statime, `S75` camilladsp,
`S80` ptp-monitor); the hotplug layer is the self-healing backstop that
converges the system whenever boot order or link reality disagrees with
that. Both problem orders converge:

- **address-first** (fast DHCP): zcip/DHCP `ifup` arrives while PTP is
  still settling → the locked guard says "not yet"; `locked` arrives →
  start with the address. ✓
- **lock-first** (isolated segment, ll-only): `locked` arrives with no
  IPv4 yet → the address guard says "not yet"; zcip claims → `ifup` →
  start with the link-local address; a later global (DHCP after the
  zcip claim, manual reconfig) arrives as `ifup`/`ifupdate` → drift
  restart to the preferred global. ✓

Burst tolerance: netifd coalesces same-interface events before dispatch;
the second handler of a burst compares equal against the cache and is a
no-op. Events from the two dispatchers may interleave in any order —
every action is a `pidof`-guarded procd service call, and the address
cache write is idempotent.

## Failure timeline: sink link loss (the case that shaped all of this)

A cable pull / WiFi roam on the inferno netdev, second by second:

| t | what happens |
|---|---|
| 0 s | carrier lost; netifd marks the device down, both logical interfaces (`aoip`, combined: `lan` too) queue `ifdown` |
| ~0 s | `40-statime-net` + `60-camilladsp` run: camilladsp stops (inferno flows close **before** any stall/timeout handling), statime stops (slave box) — *before statime's next send on the dead link, i.e. before the send-timestamp panic* |
| ~lost_timeout | ptp-monitor's `lost_timeout` expires (5 s package default; boards may raise it) → `lost` → `10-camilladsp` stop-if-running: no-op, already stopped |
| link returns | netifd brings the device up: `ifup aoip` (and `ifup lan` when DHCP re-lands) |
| +0 s | `60-inferno-net`: statime starts, BMCA re-runs; camilladsp branch exits on the locked guard |
| +3–5 s | statime locks (settle), ptp-monitor emits `locked` |
| +3–5 s | `10-camilladsp`: camilladsp starts with the freshly resolved address (cache seeded); subscriptions restore from persistent state (`INFERNO_STATE_PATH`), audio returns |

Zero panics, zero crash loops, one clean bounce — versus the old world
of a statime panic, a procd restart into a dead link and a full
DSP-restart cascade per 2 s flap.

## Files

| file | role |
|---|---|
| `br-external/package/camilladsp/files/etc/init.d/camilladsp` | the service: `start_service` renders + seeds the advertised-address baseline (single rendering point); custom `check` command = the single start/drift decision point (guards: enabled + PTP locked + link up + ≥1 IPv4) |
| `br-external/package/camilladsp/files/etc/hotplug.d/iface/40-statime-net` | the statime side: stop on real link loss (grandmaster-carved), start-if-idle on ifup |
| `br-external/package/camilladsp/files/etc/hotplug.d/iface/60-camilladsp` | the camilladsp-side gate: stop on ifdown, delegate ifup/ifupdate to `check` |
| `br-external/package/camilladsp/files/etc/hotplug.d/ptp/10-camilladsp` | the ptp-side gate: `locked` → `check`, `lost` → stop |
| `br-external/package/camilladsp/files/usr/lib/camilladsp/inferno-net.sh` | shared netdev/address/link resolution |
| `/tmp/camilladsp.resolved-addr` | runtime drift baseline (rendered by the init script at every start) |

Operator shortcut: `service camilladsp check` reconciles the service to
the current reality (lock + link + address) by hand.

## Rig validation

Validated on the QEMU rig (`scripts/run-qemu.sh --net user`, combined
topology after `single-nic-fixup`; see the validation log at the bottom):

```sh
# the dispatch probe (drop in the running guest):
cat > /etc/hotplug.d/iface/99-debug <<'EOF'
logger -t probe "ACTION=$ACTION INTERFACE=$INTERFACE DEVICE=$DEVICE IFADDR=$IFUPDATE_ADDRESSES"
EOF
# then exercise the matrix and watch the event stream + actions:
logread -f | grep -E "probe|hotplug"
```

Matrix (expectations as implemented):

| scenario | expectation |
|---|---|
| boot, address-first / lock-first | one camilladsp start, correct address, no persistent crash loop |
| sink link down 10 s → up | camilladsp stopped at ifdown (before any statime panic log), statime stopped; on ifup statime → locked → camilladsp start; audio back; zero panics |
| zcip then DHCP (address ladder) | ll-address start on aoip ifup if lock already held; restart on lan ifup with the global |
| DHCP renewal, same address | silent (no restart lines; no `IFUPDATE_ADDRESSES`) |
| source camilladsp stop/start | unchanged behavior (procd respawn + 60 s locked self-heal), no lifecycle churn |
| PTP GM loss > timeout | camilladsp stops on `lost`; restarts when GM returns — **NB**: with the default config the box self-elects GM and keeps running on its own clock (D10 semantics); the stop happens on `slave_only` sinks or when statime itself is gone (validated on the bridge rig) |
| rapid flap (down/up ×3) | converges to running+locked+subscribed; no crash loops |

### Validation log (slirp guest, combined topology)

Recorded run — `rk3506qemu` image, `./scripts/run-qemu.sh --net user`
(single eth0; `lan` DHCP + `aoip` retargeted by `single-nic-fixup`),
default uci (statime prio 251 → self-clocks on slirp, protected 2-way
camilladsp config, ptp-monitor `lost_timeout` 30):

- **boot (address-first)**: DHCP lands at S20, statime S60 starts and
  self-clocks, camilladsp starts at S75 *with a valid manifest*, seeds
  the address baseline itself (single rendering point — the cache holds
  the address right after boot, no hotplug involved) and runs stable;
  the hotplug layer stays silent while nothing changes.
- **idle `check` on a healthy system**: silent (manual
  `/etc/init.d/camilladsp check`, no log line, no restart).
- **administrative flap** (`ifdown aoip` … `ifup aoip`, link stays up
  because `lan` holds eth0): stop at ifdown (statime kept — link up),
  `check: starting (PTP locked, 10.0.2.15)` at ifup — immediate start,
  no `lost` detour.
- **drift restart while running**: baseline corrupted + synthesized
  `ifupdate` with `IFUPDATE_ADDRESSES=1` →
  `check: address 10.9.9.9 -> 10.0.2.15 on eth0, restarting` — one
  restart, baseline reseeded, new pid.
- **renewal silence**: `ifupdate` without the address flag → handler
  silent (probe logged the event, no `check` action).
- **clock loss**: `service statime stop` → after `lost_timeout` (30 s
  on this board) `ptp-monitor: clock lost` → `hotplug-ptp: stopping
  camilladsp (PTP clock lost)`.
- **recovery**: `service statime start` → BMCA re-run → lock (~5 s) →
  `check: starting (PTP locked, 10.0.2.15)`.
- **totals**: 0 panics, 0 crash loops, 0 manifest failures.

The complete lifecycle log of the session:

```
23:25:40 hotplug-iface: aoip down on eth0: stopping camilladsp
23:25:52 camilladsp: check: starting (PTP locked, 10.0.2.15)
23:26:33 camilladsp: check: address 10.9.9.9 -> 10.0.2.15 on eth0, restarting
23:27:49 hotplug-ptp: stopping camilladsp (PTP clock lost)
23:28:27 camilladsp: check: starting (PTP locked, 10.0.2.15)
```

Implementation gotcha worth remembering (found the hard way): rc.common
executes an init script under the **script's own name as process
comm** — inside `/etc/init.d/camilladsp`, `pidof camilladsp` matches
the management shell itself, its command-substitution children and even
pipeline stages (busybox runs applets as in-process forks). The
`check`/`cdsp_running` logic therefore discriminates by
`/proc/<pid>/exe` (`/usr/bin/camilladsp` vs busybox), not by name. The
hotplug handlers don't need this — their process names differ.

Real link-loss timing (carrier toggles via cable pull) and the zcip→DHCP
address ladder still need hands-on hardware; everything else — including
GM loss against a real master — is now validated on the bridge rig
(below).

### Bridge-rig validation (real segment, host grand master)

From-scratch rebuild first (proper `camilladsp-dirclean`: fresh source
extract, all five package patches apply fuzz-0, full 116-crate cargo
build), then the guest on `tap0` of `br-dante` in real mode (single
NIC, `aoip` DHCP on the physical LAN, host `statime-gm` priority1 10):

- **boot on the real segment**: DHCP address, locked as **slave** to
  the host GM with live servo values, `check: starting (PTP locked,
  192.168.1.125)` — the whole chain on a real network.
- **flap** (`ifdown`/`ifup aoip`, link held by the proto-none lan):
  stop → re-DHCP (same address) → `check` → start, ~19 s end-to-end.
- **GM death, default config**: the guest statime **self-elects
  grandmaster** and keeps self-clocking — updates resume long before
  `lost_timeout`, so no `lost` fires and **the service keeps running**
  on the local clock. That is the designed standalone semantics (D10),
  not a lifecycle gap: a default box degrades to its own clock source
  rather than going silent.
- **GM death, `slave_only=1`** (a true sink that must never master):
  statime cannot self-elect → updates stop → `lost` → `hotplug-ptp:
  stopping camilladsp (PTP clock lost)`; statime itself stays up,
  waiting. **GM return**: relock as slave in ~5 s → `locked` → `check`
  → camilladsp restarted with the same address.

```
21:24:14 camilladsp: check: starting (PTP locked, 192.168.1.125)
21:25:29 hotplug-iface: aoip down: stopping camilladsp
21:25:48 camilladsp: check: starting (PTP locked, 192.168.1.125)
21:46:58 hotplug-ptp: stopping camilladsp (PTP clock lost)
21:47:49 camilladsp: check: starting (PTP locked, 192.168.1.125)
```

Design note for sink deployments: if a box should go **silent** when
the master disappears (rather than free-running on its own clock), set
`statime.main.slave_only='1'` — the `lost` path then stops the DSP as
the matrix expects.

### Extended validation (file split + edge cases)

Second guest round, same image:

- **GM master-mode outage** (prio1 128, `ip link set eth0 down`):
  camilladsp stopped at ifdown, statime kept ("grandmaster-configured,
  keeping statime"), `locked:true` persisted (local usrvclock) — and
  the DSP **stayed down through 70 s of heartbeat checks** (link-up
  guard, 0 starts). Link back → `check: starting` ✓.
- **lan-up-after-lost** (slave): statime stop → `lost` → camilladsp
  stopped; `ifdown/ifup aoip` → statime restarted by 40-statime-net →
  relock ~5 s → `check: starting` ✓.
- **crash-loop self-heal**: 7× `kill -9` → procd "in a crash loop",
  gives up → heartbeat `check` restarts within 60 s ✓.
- **manual stop**: restarted by the heartbeat within 70 s (see the
  operator contract: use `enabled=0` to keep it down) ✓.
- **`enabled=0`**: stays down through heartbeat *and* ifup; re-enable +
  `check` starts ✓.
- **rapid flap ×3**: converges to running+locked, 5 lifecycle lines
  total (netifd coalescing + idempotent handlers), 0 panics ✓.
- **split topology negative gate** (`--net socket-listen`, aoip static
  on eth1, lan DHCP on eth0): `ifdown lan` leaves camilladsp+statime
  untouched (no handler output at all); `ifdown aoip` stops both;
  `ifup aoip` recovers the chain ✓.
- known cosmetic: on self-electing segments the post-restart `check`
  can race the relock (stale lock, see ordering scenarios) — one
  "no clock available" crash absorbed by respawn, converges ≤60 s.

#### Found along the way (camilladsp patch stack — fixed separately)

The default **protected pipeline** config could not start camilladsp at
all on the first validation runs: every start aborted at
`--make-manifest` (`invalid type: integer 0, expected a string`).
Pre-existing breakage of the camilladsp patch stack, orthogonal to the
lifecycle: the committed 0003+0005 series did not apply on a fresh
extract (the 8e796d2 regeneration of 0005 had been diffed against a
non-committed working-tree state of 0003), the binaries from the stale
never-re-patched build trees still parsed the policy the old way
(anchor-name `gaps`, `user_slot_*` placeholders) while genconf since
14e9f10 emits slot indexes and description attribution, and genconf
rendered `allowed_after` anchors as names where the parser wants slot
indexes. Reported to the stack owners and fixed by them in `de31c22`
("regenerate 0005 cleanly; genconf allowed_after -> slot indexes") —
this lifecycle's final validation ran on top of that fix.

## Mainline follow-ups (not blockers)

- statime link-loss send-timestamp panic (upstream `main.rs:715/1048`) —
  cosmetic now: nothing keeps statime running into a dead link.
- inferno `expect()` on addressless BIND_IP at PCM open — guarded
  around, still worth fixing upstream.
