# Plan — statime PTPv1 master mode

> **Status 2026-09-14**: implemented (partial) — steps 1–3 + 5 delivered as
> `br-external/package/statime/0003-ptpv1-master.patch` (fuzz-0 clean on
> the 244f20a pin, submodule left pristine). Unit level of the test plan
> done, including an in-process master↔slave exchange through the public
> `handle_*_receive` entry points (68 tests pass on the patched tree).
> Also fixed en route: the v1 Follow_Up serializer wrote
> associatedSequenceId/timestamp at wrong offsets (never round-tripped
> with the fork's own parser — it had never been exercised). Step 4
> (statime-linux smoke-run) and test levels 2–4 still open. Dialect facts
> (§5) resolved as: stratum 3, identifier "DFLT", preferred =
> priority1 < 128, sync interval = port config — all flagged in code as
> unverified pending a real Dante capture.

Goal: close the last PTPv1 gap in the statime fork (`deps/statime`,
`inferno-dev` @ 244f20a) so a virgilio device can **clock a legacy
Dante network** (real Dante endpoints slaved to us). Today the fork
implements PTPv1 *slave* only; master TX is explicitly stubbed
(`port/master.rs:14` and `:96`: "trying to act as master in PTPv1, not
implemented yet").

Related: plan.md D2 (PTPv2 default rationale), plan/statime-phc-only-mode.md
(independent; both touch port/config — sequence PRs accordingly).

## 1. What exists today (code-referenced)

| piece | status | where |
|---|---|---|
| v1 wire format, RX side | ✓ | `wire_format` v1 structs + parsers (slave in production use) |
| v1 Delay_Req TX | ✓ | slave sends Delay_Req → v1 serializer path exists for it |
| v1 election, slave side | ✓ | `bmca.rs:264-316` `MasterAnnouncement::PTPv1`, `PortIdentity::from_v1_header` |
| v1 Sync / Follow_Up / Delay_Resp TX | ✗ stubbed | `master.rs:14` (`send_sync`), `master.rs:96` (`send_delay_resp`) |
| v1 Announce | n/a | PTPv1 has no Announce — election happens via Sync sender comparison |
| v1 hardware timestamp mode | ✓ plumbed | `InterfaceTimestampMode::HardwarePTPv1All` (statime-linux) |

## 2. Design

### 2.1 Message TX (the core gap)

- **Sync**: serialize v1 Sync from the existing v1 structs; identity
  fields (communication technology, clock identifier, UUID/instance)
  filled exactly as `from_v1_header` reads them on the slave side, so
  our own slaves (and `bmca` v1 comparison) already understand us.
- **Follow_Up**: v1 two-step. Mirror the v2 flow (`send_sync` action +
  timestamp callback → follow-up with the actual TX timestamp).
  Two-step is the safe default (Dante devices expect follow-ups; make
  one-step a non-goal).
- **Delay_Resp**: v1 format includes the requester identity fields the
  parser already decodes; serialize the inverse.
- Reuse the v2 cadence machinery (sync interval timers, sequence ids)
  with v1 defaults — see open questions.

### 2.2 State machine

v1 election is *simpler* than BMCA: no Announce; a port in
`Listening/Master` that stops hearing better Syncs takes over as master;
hearing a better v1 Sync demotes it. The slave half of that comparison
already runs (`bmca.rs` v1 branches) — master mode mostly means: when
`PortState::Master` and `protocol_version == PTPv1`, the (currently
stubbed) send hooks fire. No new port states expected; verify the v2
MASTER timer set applies cleanly.

### 2.3 Datasets / identity

v1 advertises inside Sync (no Announce): keep the fork's current v1
identity mapping consistent both directions. The values a *real* Dante
master puts there (clock identifier string, sync interval) are dialect
facts we must match or at least accept — see open questions.

## 3. Implementation steps

1. v1 `Sync`/`Follow_Up`/`Delay_Resp` serializers next to the existing
   parsers (+ unit round-trip tests: parse(serialize(x)) == x).
2. Fill `master.rs:14` (sync + follow-up cadence) and `:96`
   (delay resp on request) using them.
3. Identity/dataset plumbing for v1 master (single source of truth with
   `from_v1_header`).
4. statime-linux: nothing new expected (timestamp modes and config
   already carry `PTPv1`); smoke-run only.
5. Patch series: `br-external/package/statime/0003-ptpv1-master.patch`
   (working copy → diff → pristine restore, standard workflow).

## 4. Test plan (no Dante hardware required for levels 1–3)

1. **Unit**: wire round-trips; golden bytes captured from the fork's own
   v1 slave RX where available.
2. **Self-test rig**: br-dante with `protocol = "PTPv1"`: guest A
   master, guest B slave — lock, offsets via `ptp-monitor` (ubus ptp
   status), slave freq_ppm settles; GM-loss/gain handover in v1.
3. **Cross-implementation**: host-side linuxptp (`ptp4l` 1588-2002
   mode) or classic **ptpd** (native v1) on `br-dante` as both master
   and slave against us — catches dialect/format drift that self-tests
   can't.
4. **Real Dante device** (eventually, the only true oracle): one
   Audinate endpoint slaved to a virgilio v1 master; also validates the
   v1 slave side against their dialect, which has never had a
   silicon-verified run either.

## 5. Open questions (Dante dialect facts)

- v1 subdomain + multicast groups Dante joins (default `_DFLT` /
  224.0.1.129:319/320 is the assumption; confirm from the slave's
  socket setup and, better, a capture of a real Dante network).
- Sync/Follow_Up interval Dante expects (their documented timing;
  default to the fork's configurable interval, verify at level 4).
- Clock identifier / communication-technology values real Dante masters
  transmit (affects whether we win or lose election against them —
  usually *lose on purpose* is fine: they have the better clock).
- One-step vs two-step Sync acceptance (we ship two-step only).

## 6. Risks

- **Spec access**: IEEE 1588-2002 is paywalled. Implement strictly from
  the fork's own v1 parsers and behavioral references; do NOT copy from
  linuxptp/ptpd (GPL vs the fork's MIT/Apache).
- **Unverifiable dialect details** until someone has Audinate hardware
  in reach (§4.4).
- Election interactions: a virgilio v1 master must not destabilize a
  network where real Dante devices also master (we should lose
  gracefully; test at level 4).
- Priority note (from the earlier discussion): only needed for
  mixed virgilio+legacy-Dante installs where we must be the clock —
  **park behind statime-phc-only-mode.md unless that's a confirmed
  product requirement.**

## 7. Deliverables

- `0003-ptpv1-master.patch` (+ upstream fork PR, split: serializers /
  master state machine / tests)
- rig scripts + docs section for the v1 self-test
- captures + notes from the cross-implementation runs → results/
