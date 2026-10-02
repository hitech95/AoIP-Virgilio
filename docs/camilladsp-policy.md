# camilladsp — protected pipeline policy reference

This page is the complete reference for the **policy gating** and the
**manifest** of the camilladsp pipeline: which policies exist, what each
one allows or pins, how the partition is declared in uci, and how the
manifest is generated and enforced. For the package and general uci
reference see [camilladsp](camilladsp.md); for the editing UI see
`docs/webui.md`; for the design rationale see
`plan/protected-xover-pipeline.md`. Working example:
`configs/camilladsp_protected_2way.{yaml,policy.yml,manifest.json}`.

## The model in one page

The partition is declared **per pipeline step** in uci: every
`config pipeline_step` carries `option policy locked|free`. camilladsp
itself still runs a plain flat pipeline — the partition is compiled
into a **policy file** and a **manifest** (hashes + constraints), and
is enforced by the daemon on every config change.

```
uci (/etc/config/camilladsp)
 └─ camilladsp-genconf ──► /tmp/camilladsp.yml      plain config
                         └► /tmp/camilladsp.policy    partition declaration
     camilladsp --make-manifest ──► /tmp/camilladsp.manifest
     camilladsp --manifest ──► enforces it, forever after
```

- **Opt-in**: a config where no step carries a `policy` option is an
  unprotected upstream-style config (fully editable, no policy file is
  rendered). When any step carries a policy, **every** step must.
- Scope: the gate is **mistake-proofing** (a user or buggy tool must
  not touch the active crossover through any camilladsp path), not
  hardening against a rooted device.
- User-added filters are ordinary `config filter` sections appended to
  a free step's `names` — persistence is plain uci, nothing
  memory-only.

## The two policies

| policy | contents | position | used for |
|---|---|---|---|
| `locked` | pinned by hash (names, types, params, channel bindings, order, `bypassed`/`description`, referenced filter/mixer definitions) | pinned — each locked step is an **anchor** | routing mixer, xover + FIR + limiter tails |
| `free` | editable within constraints (`allow` list, owned `channels`, `max_steps`) | stays in its **slot** unless `allowed_after` grants other gaps | user EQ groups (e.g. per input channel) |

Notes:

- a `free` step without `allowed_after` defaults to the slot it sits
  in: contents editable, position pinned;
- the **set** of steps is manifest-fixed: at runtime no step can be
  added, removed, renamed or split — edits are content edits (and
  repositioning into granted gaps) only;
- the **last** pipeline entry must be `locked` — nothing follows the
  protection tail (genconf refuses to render otherwise).

## Where policies apply (pipeline regions)

| region | policy applies | what is enforced |
|---|---|---|
| `devices` section | implicitly locked, always | full hash: samplerate, chunksize, capture/playback — device changes reroute audio, never a user action |
| `mixers` section | pinned structure | channels in/out, dests, source routes, `scale`/`inverted` flags hashed; for mixers marked `user_gains` the fields in the mixer's allow list are free (`gain` always; `mute` opt-in via `list allow` — below); unmarked mixers are hashed gains included (fully locked) |
| `pipeline` steps of a `locked` anchor | `locked` | step-by-step equality + content hash of the run; a flipped `bypassed: true` is a protection bypass and is rejected |
| `pipeline` steps of a `free` group | editable slot | Filter steps only, from the `allow` list, on owned channels, ≤ `max_steps`, in a granted slot |
| `processors` section / Processor steps | forbidden | rejected outright when a manifest is active (Compressor/NoiseGate/RACE cannot be spliced in) |
| unreferenced filter definitions | forbidden | every `filters:` entry must be used by a pipeline step — nothing can be smuggled in unused |

## Policy declaration (uci)

### `config pipeline`

The pipeline **order**: one `list step '<pipeline_step-name>'` entry
per step, in order.

### `config pipeline_step '<name>'`

The section id is the step name (and its sub-chain name in the
policy/manifest). Every step is real and renders 1:1 — there are no
placeholder anchors.

| option | values | description |
|---|---|---|
| `policy` | `locked` / `free` | the policy (table above); mandatory in a protected config |
| `type` | `Filter` / `Mixer` | step type |
| `mixer` | mixer name | Mixer steps: which `config mixer` this step runs |
| `list channels` | `0 1 …` | bus channels; **required** for `free` steps — user filters may only touch these |
| `list names` | filter names | Filter steps: real `config filter` sections (a free step's names = its base filter(s) + user-added filters) |
| `list allow` | uci filter types | **required** for `free` steps: allowed user filter types (translation below) — there is no default |
| `max_steps` | number (default 8) | free steps: max user filters in the group |
| `list allowed_after` | locked step names | free steps: locked anchors whose gaps the group may relocate into (default: the slot the step sits in) |
| `label` | string | human name, rendered as the step `description`; when absent, **free steps render their section id** — the manifest validator attributes editable steps to their sub chain by `description` |

### `config mixer`

| option | description |
|---|---|
| `user_gains '1'` | marks the mixer's route **gains as free user state** (source-mix selection = gain presets). Structure stays pinned. Without it the mixer is fully locked, gains included. |
| `list allow` | extra free route fields for a `user_gains` mixer (`gain` always implied; `mute` is the only other value today). genconf renders it into the policy (`mixer_allow`) and the manifest, so the validator accepts exactly those fields. Default: `[gain]`. |

## The allow list

`allow` uses uci filter type names; `--make-manifest` translates them
to the camilladsp type names used at validation time (camilladsp
names also pass through; unknown names fail generation):

| uci type(s) | camilladsp filter |
|---|---|
| `gain` | Gain |
| `volume` | Volume |
| `peak`, `hp`, `lp`, `hs`, `ls`, `notch`, `ap`, `bp` | Biquad |
| `lrhp`, `lrlp` | BiquadCombo |
| `conv` | Conv |
| `delay` | Delay |

## Slots and gaps

Locked anchors are numbered `1..k` in pipeline order. **Slots** are
the gaps between them:

- **slot 0** sits before the first locked anchor (where the
  input-channel user EQ groups live);
- **slot k** sits after locked anchor k;
- a free step's `allowed_after` names anchors; genconf translates them
  to slot indexes and the policy carries only indexes (`gaps:
  [0, 2, …]`). Default: the slot the step sits in.

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

Read access is never gated: `GetConfig`, the WS **`GetPolicy`**
command (serves the active manifest — subchains + mixers, patch
`0005`), levels/state reads. Runtime volume/mute/faders and
`Stop`/`Exit` are state/process control, deliberately not gated.

## Files

| artifact | produced by | notes |
|---|---|---|
| `/tmp/camilladsp.yml` | `camilladsp-genconf` (uci) | plain config, format unchanged |
| `/tmp/camilladsp.policy` | `camilladsp-genconf` (uci) | partition declaration (subchains, constraints, `user_gains`, `mixer_allow`); no hashes in shell |
| `/tmp/camilladsp.manifest` | `camilladsp --make-manifest yml policy` | hashes + constraints; generated by the same binary that validates (one canonical form); generation self-checks |
| `/usr/share/camilladsp/coeffs/` | image build | vendor FIR coefficients (read-only); locked conv filters must point here |

Tests: rust unit tests (`cargo test config::manifest`), host genconf
harness (`scripts/genconf-test/run.sh`), live WS tamper matrix
(`scripts/protected_ws_test.py` — expectations verified against the
patched validator via `--check`, 2026-10-02).
