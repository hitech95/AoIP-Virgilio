# Findings — inferno subscription resume vs official Dante behaviour

Context: T6/X1 rig tests (plan/final-polish.md) + code read of
`deps/inferno/inferno_aoip/src/device_server/channels_subscriber.rs`
(commit 75d9198, plus our 0001/0002 patches). No diagnostics run yet —
this file is the record of what is known and where the fixes would go.

## Official Dante behaviour (reference)

- receivers **mute to silence** on flow loss (never stuck tones);
- subscriptions **persist** on the receiver (reboots, power cycles);
- audio **resumes automatically** when the transmitter returns.

## What inferno already has (code-grounded)

| piece | where | status |
|---|---|---|
| persistence (`rx_subscriptions.toml`) | `state_storage.rs` + `save_state`/`load_state` | works (T1/X1) |
| silence on loss (plugin outputs zeros) | ALSA plugin capture path | works (T6) |
| orphan detection: flow timeout → `remote = None`, resolver re-armed | `channels_subscriber.rs:1085-1125` | works (T6 logs) |
| retry loop: every 9 s while `needs_resolving` | `channels_subscriber.rs:1252` | runs (presumed) |
| mDNS re-discovery of tx (`query_chan`) | `resolve_subscriptions()` | worked at first subscribe; **unverified after tx reboot** |

## Gaps (pinpointed, fix-sized)

1. **Resume after TX reboot never completes.** Retries are invisible at
   warn loglevel (all debug/trace). Unknown whether the 9 s loop fires
   and whether `query_chan` gets an answer from the rebooted TX.
   → *Diagnosis needed*: sink logspec
   `warn,inferno_aoip::device_server::channels_subscriber=debug`,
   kill + reboot the source, watch the retry/mDNS lines.
2. **Upstream TODO = no re-arm on flow-request failure**:
   `// TODO else set self.resolve_now = true to retry`
   (`channels_subscriber.rs:~992`). On request failure the channel gets
   `SubscriptionStatus::TxFail` but the resolver can suspend → dead end.
   → *Patch*: implement the TODO with backoff.
3. **Start-time race poisons the RX ring** ("unable to receive start
   time, ring_buffer addressing will be wrong!" → `snd_pcm_hw_params`
   ETIMEDOUT → camilladsp dies; respawn can limp in an unrecoverable
   **trickle state**, ~1500 fps dribble). Re-subscribing on the broken
   instance does not reliably recover; only wipe-state + restart does.
   → *Patch*: on start-time failure do `disconnect_channel` +
   `remote = None` + re-resolve (same as orphan) instead of running with
   a wrongly-addressed ring.
4. **Early-boot no-IP panic** (`settings.rs:36` `create_self_info`):
   ptp hotplug can start camilladsp before `network.aoip` has an address
   → respawn loop until configured. Blocks the whole resume story at
   boot.
   → *Fix*: defer/wait (inferno side) or address-wait (hotplug handler).

## Proposed order when picked up

1. Diagnosis run (gap 1) — decides mDNS-side vs resolver-side.
2. Patch 0003: gaps 2+3 (same "re-arm on failure" theme, contained).
3. Gap 4 boot-order fix.
4. Validation: scripted TX-reboot + RX-reboot rig tests, N repetitions;
   pass = audio auto-resumes < ~15 s (one retry cycle + mDNS round).

## Related rig facts (already recorded in final-polish.md)

- runbook: after source reboot → re-subscribe; on trickle →
  `--remove` + stop camilladsp + wipe
  `/opt/user_data/inferno_aoip/*/rx_subscriptions.toml` + start +
  one manual subscribe (reliable, verified).
- all three upstream candidates for the inferno author: start-time race,
  unrecoverable trickle state, no-IP panic.
