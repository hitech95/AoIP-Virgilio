# Test — webui M4 (filters page + uploads, protected-pipeline integration)

> **Status 2026-09-18**: historical snapshot — milestone test report of its
> execution date; rig era of its timestamp, not re-verified since.

DoD per `plan/webui.md` §12 M4, executed 2026-09-15 on the simple-mode rig
with the protected 2-way policy active (subchains + user EQ slots, the
`scripts/genconf-test/protected-2way.uci` tree; vendor FIR coeff stand-in
created at `/usr/share/camilladsp/coeffs/wf_fir.txt` because the image
ships no vendor coefficients).

## Architecture change landed (vs plan §9 wording)

User filter steps are **uci-native**: genconf now accepts `list names` on
editable slot steps (validated against `allow`/`max_steps`, rendered
after the `user_slot_<name>` anchor). Persistence, validation and apply
all ride the existing uci → genconf → manifest → SIGHUP chain — no WS
client, no preset daemon needed. genconf test suite extended to 17 cases
(positive render, allow-list / max_steps / undefined-filter rejections,
policy-unchanged assertion).

## What shipped

- **genconf**: user steps on editable slots (`+ allow/max validation`).
- **webuid**: `filters.schema/get/set` (layer-1 validation + transactional
  write: backup uci → apply → genconf dry-run → restore-or-reload),
  `mix.set` (source-select presets for user_gains mixers), `files.list/
  delete` + `/oui-upload` (multipart parser, sanitized basenames, 16 MB
  cap, uploads land in `/opt/user_data/filters/`).
- **webui-app-filters**: manifest-driven slot editors (add/remove/reorder,
  per-type params), live cascade response curves (vendored camillaEQ
  biquad math, RBJ cookbook, canvas), source-select presets, locked
  chains shown read-only.
- **webui-app-files**: upload/list/delete.

## Results

| Check | Result |
|---|---|
| `filters.set` peak+gain on user_in0, peak on user_in1 | `{}`; camilladsp **stays Running** through the manifest-validated reload; `filters.schema` round-trips the persisted filters |
| `filters.set` type not in allow (`lrlp`, `limiter`) | `-4 not allowed` (layer 1) |
| `filters.set` > max_steps (9 vs 8) | `-2 exceed max_steps` |
| `filters.set` on locked subchain | `-4 is locked` |
| genconf-layer rejection (undefined filter) | dry-run catches, uci **restored**, error surfaced |
| `mix.set` source 0/1/mix | routes rewritten, applied |
| upload FIR (multipart) → `files.list` → conv filter referencing it | applied, daemon Running (coeff parsed) |
| **ATTACK via raw WS: remove locked woofer tail** | `ConfigValidationError: locked subchain 'wf_tail' is missing, modified or moved` — rejected, config intact |
| **ATTACK via raw WS: edit limiter inside locked tail** | `ConfigValidationError: content hash mismatch` — rejected, state Running |
| M1–M3 regression | auth/WS gating, menus, status, uci bridge unchanged |

## Bugs found the hard way

1. **ucode-uci: `add()`/`set()` on a not-yet-loaded cursor lose their
   delta at `commit()`** — sections silently vanished. Every mutation
   path now calls `c.load(config)` first. (Caught by the transactional
   genconf dry-run doing exactly its job.)
2. camilladsp v4 WS protocol is **serde-enum-keyed** (`"GetStateJson"`,
   `{"SetConfigJson": "<string>"}`), not `{"command": ...}`; SetConfigJson
   takes a *string* payload. Documented here for future WS tooling.

## Notes

- The browser-side rendering of the filters page (curves, drag UX) is
  built and served but not exercised headless; every request the page
  makes is verified. A headless-browser pass is a rig upgrade candidate.
- camilladsp rejects configs with unused filter definitions — frontend
  always sends the full slot content, so this only bites raw WS clients.
