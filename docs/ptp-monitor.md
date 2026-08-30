# ptp-monitor

`ptp-monitor` is a ucode daemon (`/etc/init.d/ptp-monitor`, S80, script
`/usr/bin/ptp-monitor`) that reports statime's PTP lock state and
triggers procd **hotplug events**. It never manages services itself —
policy lives in `/etc/hotplug.d/ptp/*` handlers.

It exists because of an inherent property of the stack: with no PTP master
on the link, the inferno ALSA plugin cannot obtain a media clock
(`snd_pcm_hw_params` fails with ETIMEDOUT after ~5 s), camilladsp exits,
and procd stops respawning it after the default crash-loop threshold
(6 fast crashes). Nothing would ever bring it back when a master appears.

## How lock detection works

statime exports its (virtual) clock through the **usrvclock protocol**
(`usrvclock-rs`, shipped with inferno): a unix datagram socket at
`/tmp/ptp-usrvclock` (path from `/etc/config/inferno`, `clock_path`).
A client registers by sending one empty datagram, then receives a
40-byte update **on every servo action** (`OverlayClock::set_frequency` /
`step_clock` → `Server::send`):

| offset | size | field |
|--------|------|-------|
| 0 | 2 | magic `'VC'` |
| 2 | 4 | protocol major/minor (u16, native endian) |
| 6 | 2 | flags |
| 8 | 8 | `clock_id` i64 (underlying clockid) |
| 16 | 8 | `last_sync` i64 ns |
| 24 | 8 | `shift` i64 ns (accumulated correction) |
| 32 | 8 | `freq_scale` f64 (rate correction) |

The servo only acts on incoming sync/delay measurements, so **datagrams
flow exclusively while statime is slaved to a master**. This makes the
socket a precise, event-driven lock signal — no polling of statime
internals needed.

### Lone nodes and masters (post-patch)

Upstream, the servo only acts on incoming sync/delay measurements, so the
usrvclock socket only carried updates **while slaved to a master**: a
self-elected grandmaster exported nothing and could not host inferno
instances. We carry `br-external/package/statime/0001-export-usrvclock-
overlay-while-master.patch`: a 1 Hz task re-sends the last overlay while
any port is in Master state — the identity overlay (shift 0, freq 0) on
boot ("the reference is my own underlying clock"), or the last disciplined
parameters after a slave→master transition (holdover). With it, a lone
node self-clocks, `ptp-monitor` locks, and camilladsp boots standalone;
`updates flowing` now means "a valid clock source exists (leading or
following)". (On the default QEMU slirp link, statime first chases its own
reflected multicast — `Measurement too far from state, resetting` — then
BMCA re-elects it grandmaster and it self-clocks; lock time is just less
predictable than on an isolated link. NB: inferno panics if
`INFERNO_BIND_IP` names an interface without an IPv4 address, so test
rigs on isolated links must configure a static IP first.)

## Outputs

| channel | how | payload |
|---------|-----|---------|
| ubus object | `ubus call ptp status` | `{ locked, mode, ptp_version, domain, priority1, updates, clock_path, clock_id, shift_ns, freq_scale, freq_ppm, last_sync_ns }` |
| ubus events | `ubus listen ptp` | same object, on lock/lost transitions |
| procd hotplug | sources `/etc/hotplug.d/ptp/*` | env `ACTION=locked\|lost`, `PTP_CLOCK_PATH`, `PTP_SHIFT_NS`, `PTP_FREQ_PPM` |

`mode` (statime port state lowercased: `master`/`slave`/…), `domain` and `priority1`
come from statime's **observation socket** (`/tmp/statime-observe.sock`,
uci `statime.main.observation_path`): statime serves one JSON blob of its
full instance state per client connect; the monitor refreshes it every
5 s over a non-blocking connect/drain cycle. `ptp_version` (1 or 2) is
read from uci (`statime.main.protocol`) — the running protocol.

The hotplug path uses procd's native dispatcher (25.12 `hotplug-dispatch`:
procd watches `/etc/hotplug.d/` via inotify; every subdirectory becomes a
`hotplug.<name>` ubus object). The daemon calls
`ubus call hotplug.ptp call '{"env":["ACTION=locked",...]}'`; procd then
runs each `/etc/hotplug.d/ptp/*` via `/bin/sh -c ". /lib/functions.sh;
. <script>"` with that environment. Note this procd has no standalone
`/sbin/hotplug-call` binary — the ubus dispatcher replaced it.

While locked, `ACTION=locked` is re-emitted every ~60 s so that
idempotent handlers double as crash-loop self-heal. Re-registration is
automatic: after `lost_timeout` s of silence the usrvclock client
re-registers every ~5 s (statime restarts create a fresh socket).

Servo values (`shift_ns`, `freq_ppm`) come from the overlay; PTP
`offsetFromMaster`/`meanPathDelay` live inside statime and are not
exported — that would need a statime patch.

## The camilladsp handler (`/etc/hotplug.d/ptp/10-camilladsp`)

- `ACTION=locked`: starts camilladsp if `uci camilladsp.main.enabled`
  is 1 and no process is running;
- `ACTION=lost`: stops camilladsp if running.

Stopping on loss is a policy choice: without it, inferno free-runs on
the last overlay and audio keeps flowing on a drifting clock. Edit (or
remove) the handler to change the behaviour — the monitor does not care.

## Configuration (`/etc/config/ptp-monitor`)

```
config ptp-monitor 'main'
	option clock_path '/tmp/ptp-usrvclock'  # keep in sync with inferno
	option settle '3'        # consecutive 1 s ticks with updates -> locked
	option lost_timeout '5'  # s without updates -> lost
```

## ucode build requirements

`/usr/bin/ptp-monitor` needs ucode modules beyond the OpenWrt defaults:
`uloop` (timers/process spawn), `socket` (AF_UNIX datagrams), `ubus`
(object publish/events) — enabled in `br-external/package/ucode/ucode.mk`
(`struct` and `fs` were already on). Version quirks of this ucode pin:
`fs.lsdir()` (not `readdir`); `uloop.interval()` for the repeating tick
(`uloop.timer` returns the callback, not the handle).

## Verified behaviour

- single guest on an isolated link (`--net socket-listen`, no peer): with
  the master-export patch statime GM-elects, the identity overlay flows,
  `locked:true`, and camilladsp auto-boots standalone;
- single guest on slirp: after the reflected-multicast chase settles,
  statime GM-elects and self-clocks (slower/less predictable than an
  isolated link); a lone isolated guest needs a static IP first or the
  inferno instance panics on the address-less BIND_IP interface;
- two guests (B master, A slave): B self-clocks (identity overlay,
  camilladsp running), A locks with live servo values, camilladsp
  auto-started, and `arecord -D inferno -d 5` returns RC=0 with exactly
  5 s of clock-timed audio (1,920,044 B);
- `lost` path (master disappearing mid-run) is symmetric in code but not
  yet exercised in a recorded test.
