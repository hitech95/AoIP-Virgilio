# camilladsp — protected pipeline policy reference

This page is the complete reference for the **policy gating** of the
camilladsp pipeline: which policy options exist, what each one allows
or pins, and on which parts of the pipeline they act. For the package
and general uci reference see [camilladsp](camilladsp.md); for the
design rationale see `plan/protected-xover-pipeline.md`. Working
example: `configs/camilladsp_protected_2way.{yaml,policy.yml,
manifest.json}`.

## The model in one page

The pipeline is partitioned into logical **sub chains** (groups of
steps). Each sub chain carries a **policy** that decides what a
websocket (or any config-apply path) may do to it. camilladsp itself
still runs a plain flat pipeline — the partition lives in uci, is
compiled into a **manifest** (hashes + anchors + constraints), and is
enforced by the daemon on every config change.

```
uci (/etc/config/camilladsp)
 └─ camilladsp-genconf ──► /tmp/camilladsp.yml      plain config
                        └► /tmp/camilladsp.policy    partition declaration
     camilladsp --make-manifest ──► /tmp/camilladsp.manifest
     camilladsp --manifest ──► enforces it, forever after
```

Scope: the gate is **mistake-proofing** (a user or buggy tool must not
touch the active crossover through any camilladsp path), not
hardening against a rooted device. It is **opt-in**: started without
`--manifest`, camilladsp behaves exactly like upstream.

## The three policies

| policy | contents | position in the chain | used for |
|---|---|---|---|
| `locked` | pinned by hash (names, types, params, channel bindings, order, `bypassed`/`description`, referenced filter/mixer definitions) | pinned — anchors the slots | routing mixer, xover + FIR + limiter tails |
| `child` | editable within constraints (allow list, owned channels, `max_steps`) | pinned to its slot | user EQ groups (e.g. per input channel) |
| `free` | editable within constraints, like `child` | the whole run may relocate into declared gaps | defined by the model, unused in v1 |

Notes:

- "child" = child-only editing: the group's *contents* are editable,
  its *position* is not.
- content-locked + position-free is deliberately not a valid
  combination: locked content is only meaningful at a pinned position.
- the **set** of sub chains is manifest-fixed: at runtime no group can
  be added, removed, renamed or split — edits are content edits (and
  repositioning for `free`) only.
- the **last** sub chain must always be `locked`: nothing can be
  appended after the protection tail.

## Where policies apply (pipeline regions)

| region | policy applies | what is enforced |
|---|---|---|
| `devices` section | implicitly locked, always | full hash: samplerate, chunksize, capture/playback — device changes reroute audio, never a user action |
| `mixers` section | pinned structure | channels in/out, dests, source routes, `scale`/`inverted` flags hashed; for mixers marked `user_gains` the fields in the mixer's allow list are free (`gain` always; `mute` opt-in via `list allow` — below); unmarked mixers are hashed gains included (fully locked) |
| `pipeline` steps of a `locked` sub chain | `locked` | step-by-step equality + content hash of the run; a flipped `bypassed: true` is a protection bypass and is rejected |
| `pipeline` steps of a `child`/`free` sub chain | editable slot | Filter steps only, from the allow list, on owned channels, ≤ `max_steps`, after the group placeholder |
| `processors` section / Processor steps | forbidden | rejected outright when a manifest is active (Compressor/NoiseGate/RACE cannot be spliced in) |
| unreferenced filter definitions | forbidden | every `filters:` entry must be used by a pipeline step — nothing can be smuggled in unused |

## Policy options reference (uci)

### `config subchain`

| option | values | applies to | description |
|---|---|---|---|
| `name` | string | all | unique sub chain name; the slot placeholder is `user_slot_<name>` |
| `policy` | `locked` / `child` / `free` | all | the policy (table above) |
| `channels` | `0 1 …` | child, free | bus channels the slot owns; user steps may only touch these |
| `allow` | uci filter types | child, free | allowed user filter types (mapping below) |
| `max_steps` | number (default 8) | child, free | max user steps in the slot (placeholders don't count) |
| `list allowed_after` | anchor names | free | locked anchors whose gaps the group may relocate into |

### `config step`

| option | description |
|---|---|
| `subchain` | required when subchain sections exist; assigns the step to its group. A **locked** step is a normal step (`type Filter/Mixer` + filters). An **editable** slot is declared by ONE bare step — `index` + `subchain` only: genconf renders the placeholder there. |

### `config mixer`

| option | description |
|---|---|
| `user_gains '1'` | marks the mixer's route **gains as free user state** — the source-mix selection (100% ch0 / 100% ch1 / (ch0+ch1)/2) is a pure gain preset. Structure stays pinned. Without it the mixer is fully locked, gains included. |
| `list allow` | extra free route fields for a `user_gains` mixer (`gain` always implied; `mute` is the only other value today — enables the live-matrix destination mutes). genconf renders it into the policy (`mixer_allow`) and the manifest, so the validator accepts exactly those fields; anything else is rejected. Default: `[gain]`. |

### The allow list

`allow` uses uci filter type names; `--make-manifest` translates them
to the camilladsp type names used at validation time (camilladsp
names also pass through; unknown names fail generation):

| uci type(s) | camilladsp filter |
|---|---|
| `gain` | Gain |
| `peak`, `hp`, `lp`, `hs`, `ls`, `notch`, `ap` | Biquad |
| `lrhp`, `lrlp` | BiquadCombo |
| `conv` | Conv |
| `delay` | Delay |

Defaults to a conservative set (`gain peak hs ls notch ap conv
delay`); Volume/Loudness/Dither are stateful or format-affecting and
stay out for now.

## Placeholders and user slots

Every editable group renders a **placeholder** step
`user_slot_<name>` (Gain 0 dB — transparent) as its **first** step.
The placeholder is the group's identification anchor:

- user steps are appended **after** it — in the same Filter step
  (extra names after the placeholder) or as following steps;
- a step before the placeholder, or a placeholder missing from its
  slot, is rejected;
- the placeholder step carries explicit `channels` ⊆ the slot's
  owned channels;
- several editable groups may share one slot (e.g. both input-EQ
  groups live in slot 0, before the mixer); swapping their order
  within the same slot is allowed.

Slots are the gaps between locked anchors: slot 0 sits **before the
first locked anchor** (that is where the input-channel user EQ goes);
slot k sits after locked anchor k. Nothing may exist after the last
locked anchor.

## Enforcement

When `--manifest` is active, every config-apply path validates the
candidate against the manifest before it is used:

| path | on violation | on success |
|---|---|---|
| startup / on-disk config | **abort** (exit non-zero; procd respawns to silence — silence beats a mistuned speaker) | daemon runs |
| WS `SetConfig` / `SetConfigJson` / `PatchConfig` / `SetConfigValue` / `Reload` / `SetConfigFilePath` | **rejected** with `ConfigValidationError`, running config and audio untouched, `Config rejected by locked manifest: …` logged | applied |
| `--check`, SIGHUP reload | error / reload refused | validated |

Because `PatchConfig`/`SetConfigValue` rebuild the full candidate
config before validation, even a surgical
`SetConfigValue /filters/wf_lp/parameters/freq` goes through the same
walk. `service camilladsp reload` regenerates yml, policy and
manifest and compares: identical manifests ⇒ SIGHUP (no audio
interruption); changed (vendor locked edit) ⇒ restart to load the new
manifest.

Runtime volume/mute/fader, `Stop`/`Exit` are state/process control,
not config — deliberately **not gated** (at worst silence or a
respawned daemon, never a protection bypass).

## What a websocket client may do (cheat sheet)

| action over WS | result |
|---|---|
| add/edit/remove own EQ in the slot (allowed type, owned channel, after the placeholder, ≤ max_steps) | **accepted** |
| change route gains of a `user_gains` mixer (source mix) | **accepted** |
| mute/unmute a destination of a `user_gains` mixer (route or source `mute`) | **accepted** only when the mixer's allow list grants `mute`; otherwise rejected |
| swap editable groups within the same slot | **accepted** |
| relocate a `free` group into an allowed gap | **accepted** |
| edit/delete/move/`bypass` a locked step, its FIR path, its limiter | rejected |
| change devices, mixer structure (add/remove/re-flag routes), non-`user_gains` mixer gains | rejected |
| user step on a foreign channel, disallowed type, omitted `channels`, before the placeholder, past `max_steps` | rejected |
| step outside any slot / after the locked tail | rejected |
| Processor step or `processors:` section anywhere | rejected |
| read anything (`GetConfig`, levels, state); volume/mute/faders | allowed (never gated) |

Two runtime caveats: user edits are **memory-only** — a uci reload or
reboot resets the slots to placeholders (the preset daemon is the
future persistence story); and the socket is loopback-bound
(`ws_address`), so remote use means an SSH tunnel or the device's own
web UI.

## Files

| artifact | produced by | notes |
|---|---|---|
| `/tmp/camilladsp.yml` | `camilladsp-genconf` (uci) | plain config, format unchanged |
| `/tmp/camilladsp.policy` | `camilladsp-genconf` (uci) | partition declaration (sub chains, constraints, `user_gains`); no hashes in shell |
| `/tmp/camilladsp.manifest` | `camilladsp --make-manifest yml policy` | hashes + anchors + constraints; generated by the same binary that validates (one canonical form); generation self-checks |
| `/usr/share/camilladsp/coeffs/` | image build | vendor FIR coefficients (read-only); locked conv filters must point here |

Tests: rust unit tests (`cargo test config::manifest`, 26), host
genconf harness (`scripts/genconf-test/run.sh`, 12 checks), live WS
tamper matrix (`scripts/protected_ws_test.py`, 17 cases).
