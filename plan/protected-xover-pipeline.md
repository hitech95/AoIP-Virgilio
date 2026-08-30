# Plan — protected crossover pipeline (driver protection vs user EQ)

Goal: a camilladsp pipeline where the speaker-design and driver-protection
chain (final crossover + FIR + safety limiting) is **mandatory and
tamper-proof**, while the user only ever gets well-defined **user-effect
slots before the protected tail**. Third-party websocket/HTTP tools must
not be able to remove, disable, edit or reposition protected elements.

## 1. Signal chain (target)

```
devices          capture 'Inferno' (uci: inferno/camilladsp sync)   [PROTECTED]
   │ stereo
mixer  "source select": ch1+ch2 /2 | ch1 | ch2        (uci option)  [PROTECTED]
   │ creates two mono ways: TW, WF
   ├── TW ──> [ user effects: EQ, delay, gain … ]      (WS slots)   [USER]
   │            └─> [ xover HP + FIR + protection ]    (uci)        [PROTECTED]
   └── WF ──> [ user effects ]                          (WS slots)  [USER]
                └─> [ xover LP + FIR + protection ]     (uci)        [PROTECTED]
devices          playback per way (alsa/inferno)       (uci)        [PROTECTED]
```

Rules:
- user steps may ONLY exist between the mixer and the first protected
  step of their channel (position lock);
- protected steps are pinned: name, type, params and order;
- mixer source selection and device bindings are protected (changing
  them reroutes audio — not a user action).

## 2. Threat model

| actor | vector | mitigation |
|---|---|---|
| network third-party tool | camilladsp WS/HTTP config write | WS/HTTP bound to **loopback only** (product init); no auth exists upstream — loopback is the perimeter |
| local service daemon (preset loader) | WS WriteConfig | **manifest validation** (§3): it can only rewrite the user region |
| compromised/buggy daemon, arbitrary local process | WS WriteConfig / editing /tmp/camilladsp.yml + Reload | same validation on EVERY config-apply path; on-disk tamper → **abort** (§4) |
| user via uci/ssh | uci itself | out of scope: uci IS the vendor surface (protected region defined there) |

## 3. Manifest (what "protected" means, machine-checkably)

`camilladsp-genconf` renders TWO artifacts from the same uci tree:

1. `/tmp/camilladsp.yml` — the full config (protected objects rendered
   from uci steps flagged `protected '1'`; user slots rendered as
   placeholder `basic_convolver`/`gain 0 dB` steps named `user_slot_*`);
2. `/tmp/camilladsp.manifest` — canonical JSON of the protected
   skeleton:
   ```
   { devices: {…sha256 of canonical serialization…},
     mixers:  {…},
     protected_steps: { TW: [ {name, type, sha256(params)} … in order ],
                        WF: [ … ] },
     user_slot_bounds: { TW: {after_mixer, before_index: 0}, … } }
   ```
   (One rendering ⇒ config and manifest can never disagree. uci reloads
   regenerate both atomically, so `reload_service` stays safe.)

## 4. Enforcement — camilladsp patch (0003-protected-pipeline.patch)

The fork already carries patches; this adds a *config gate*:

1. `--manifest <path>` CLI option; loaded at startup.
2. Validation function `config_matches_manifest(cfg, manifest)`:
   - devices/mixers subsections byte-equivalent (canonical form) to the
     manifest hashes;
   - per channel: protected steps present, exact names/types/param
     hashes, exact order, contiguous at the tail;
   - user steps: only between mixer output and first protected step,
     from an allow-list of filter types (EQ/convolver/gain/delay…).
3. Gates (the ONLY paths that install a new config):
   - startup: on-disk config vs manifest → mismatch = **abort**
     (exit non-zero; procd respawn keeps retrying — silence, speakers
     safe; log CRIT with the offending object);
   - WS `WriteConfig` / HTTP config PUT / `Reload`: candidate config
     validated BEFORE apply → violation = reject, keep the running
     config, log CRIT (audio never stops for a refused edit).
   This is exactly the abort-vs-reject split the requirement implies:
   *runtime* tampering is refused (service continues), *persistent*
   tampering halts the pipeline.
4. No manifest option passed → behaviour identical to upstream (feature
   is opt-in; keeps the patch upstream-submittable as "locked config").

## 5. User preset daemon (firmware side, later milestone)

- speaks WS on loopback to camilladsp: ReadConfig → splice preset steps
  into user slots → WriteConfig (validation passes: protected region
  untouched);
- presets live in `/opt/user_data/presets/` (survive factory reset);
- exposes safe operations over ubus (load/preview/list) — never raw
  config writes;
- runs unprivileged; no uci access.

## 6. uci schema (extends D4 chain-node schema)

```
config mixer 'src_sel'            # PROTECTED (implicit)
    option mode 'ch1_ch2_avg'     # ch1_ch2_avg | ch1 | ch2

config step                       # user slot (implicit role by position)
    option channel 'TW'
    option filter 'user_eq'

config step
    option channel 'TW'
    option filter 'tw_hp_fir'
    option protected '1'          # → manifest, pinned
```

`camilladsp-genconf` assigns roles by `protected` flags + position
invariants (user steps before first protected step, else refuse to
render — early failure at config time, not runtime).

## 7. Test plan (DoD)

1. Render: uci per §6 → yml + manifest; camilladsp starts clean.
2. WS tamper matrix (small python WS client, loopback):
   - delete protected step → rejected, audio continues, CRIT logged;
   - edit FIR file path / params → rejected;
   - move protected step after a user step → rejected (position lock);
   - user EQ in slot → accepted, audible;
   - user step placed after xover → rejected;
   - swap mixer mode via WS → rejected.
3. On-disk tamper: edit yml, SIGHUP/Reload → abort + respawn silence;
   restore → audio returns.
4. Chain test: stereo→mono select per uci mode; TW/WF on separate
   playback channels; FIR coeffs from /opt/user_data.
5. Regression: no-manifest run identical to upstream; existing
   single-channel rigs unaffected.

## 8. Files touched (estimate)

| file | change |
|---|---|
| `deps/camilladsp/src/config/` + `src/bin.rs` + WS/HTTP handlers | manifest load, validation, gates (~+300 LoC) |
| `br-external/…/usr/bin/camilladsp-genconf` | role rendering + manifest emitter |
| `…/etc/init.d/camilladsp` | pass `--manifest`, bind WS loopback |
| `…/etc/config/camilladsp` (+ docs/camilladsp.md §schema) | `protected` flags, `src_sel` mixer |
| `configs/` | example TW/WF xover+FIR pair (from docs/crossover-to-camilladsp.md work) |

## 9. Risks / open questions

- **Validation strictness vs benign renames**: canonicalization must
  ignore key order but not values; decide whether silence on ANY
  mismatch is acceptable for field devices (proposal: yes — that is
  the product promise).
- WS WriteConfig round-trip fidelity: the daemon must re-serialize the
  protected region byte-identically in canonical form (use ReadConfig
  output as the base for splicing — it already is canonical).
- Upstream appetite for a "locked manifest" feature unknown; the patch
  is self-contained and opt-in, good odds for the conversation.
- FIR coefficient updates BY THE VENDOR: they flow through uci → genconf
  → manifest regen (both artifacts move together) — allowed by design;
  document that vendor updates require uci/OPKG, not WS.
- Per-way source selection (TW mono from ch1, WF from ch2) is a
  plausible future uci extension; schema keeps `mode` scalar now.
