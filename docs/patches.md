# Downstream patches

Single source of truth for every patch this tree carries against upstream
sources. Component docs describe *behavior*; this page describes the patch
stacks themselves. When a patch is added, removed, or renumbered, update
this page in the same commit.

## How patches are applied — two mechanisms

| mechanism | packages | how |
|---|---|---|
| **Buildroot auto-apply** | camilladsp, inferno, statime, netifd, ubox | `NNNN-slug.patch` files at the package root (`br-external/package/<pkg>/`) are applied by the Buildroot infra against the pinned `deps/` submodule rev, in numeric order, fuzz 0. Nothing in the `.mk` needs to mention them. |
| **webui frontend script** | webui (OUI shell) | `patches/*.patch` inside the package are applied by `scripts/webui/build-frontend.sh` to a staging copy of the vendored `deps/oui` tree (`patch -Np1 --fuzz=0`, numeric order) before the npm/vite build. Buildroot applies nothing here — the package builds from its own `src/`. |

## Stacks

### camilladsp — 5 patches, pinned @ `05e9cfc` (v4.1.3)

| patch | what it does |
|---|---|
| `0001-capture-use-poll-descriptors-revents` | ALSA capture uses `PollDescriptors` revents (carries the `pcm` handle in `FileDescriptors`) — stops poll-based capture from spinning on partial reads. |
| `0002-add-built-in-fft-spectrum-analyzer` | Built-in log-spaced FFT spectrum analyzer (new `src/spectrum.rs`), 10 Hz levels via new `GetSpectrumLevels`/`SetSpectrum*` WS commands. Powers the webui spectrum graph. |
| `0003-locked-config-manifest` | Locked-config manifest system: `--manifest`/`--make-manifest` CLI, `src/config/manifest.rs` validates config against the policy manifest at startup and on every change. See `docs/camilladsp-policy.md`. |
| `0004-add-ubus-status-object` | `ubus` cargo feature (ubus-zero pinned rev) + `src/ubusserver.rs`: native ubus status object. Enabled via `--features 32bit,ubus` in the `.mk`. See `docs/camilladsp.md` §ubus. |
| `0005-expose-policy-over-ws` | `GetPolicy` WS command serving the active manifest (subchains + mixers); manifest validation attributes editable subchains by step description / slot indexes. |

Caution: 0004 was generated against 0001+0002 (not on top of 0003) — it
applies to `src/bin.rs` only with an offset. Harmless today; keep in mind
when regenerating the series (see `de31c22` for the incident class).

### inferno — 5 patches, strictly stacked, pinned @ `75d9198`

| patch | what it does |
|---|---|
| `0001-capture-poll-period-level` | Throttles RX-flow `on_transfer` to one notification per PCM period — poll-based consumers stop spinning on 1 kHz partial reads. |
| `0002-state-storage-env-path` | `StateStorage` path configurable via `STATE_PATH` env (wired to uci `inferno.main.state_dir`). |
| `0003-bits-per-sample-configurable` | TX-advertised sample depth from `INFERNO_TX_BITS_PER_SAMPLE` (mapped from uci `format`); hardens flow-control against garbage `bits_per_sample`. |
| `0004-global-address-preference` | BIND_IP interface resolution prefers global IPv4 over RFC 3927 link-local — Dante peers reach the device when DHCP and zcip coexist. |
| `0005-race-free-flow-teardown` | Guards the link-loss timeout vs. teardown race in `flows_rx`/`channels_subscriber` (no more poisoned `flows_info` / dead subscriber). |

0003 and 0004 carry `Upstream-rev:` baseline comments — keep that practice.

### statime (fork) — 2 patches, pinned @ `244f20a`

| patch | what it does |
|---|---|
| `0001-export-usrvclock-overlay-while-master` | Re-sends the usrvclock overlay at 1 Hz while acting as grandmaster — leading/lone nodes are valid clock sources. Long-form docs: `docs/ptp-monitor.md`, `docs/inferno.md` §clock chain. |
| `0003-ptpv1-master` | PTPv1 **master** TX: v1 Sync/Follow_Up/Delay_Resp constructors, `port/master.rs` two-step sync + Delay_Resp answering, v1 Delay_Req RX, master↔slave unit test. Needed for pure-PTPv1 Dante networks without real Dante clock masters. |

**0002 is reserved** for `0002-phc-only-mode.patch` (planned deliverable in
`plan/statime-phc-only-mode.md`, upstream issues #380/#517). Do not renumber.

### webui (OUI shell) — 4 patches, applied to vendored `deps/oui`

| patch | what it does |
|---|---|
| `0001-oui-login-plaintext-post` | Shell login POSTs the plaintext password (server verifies via /etc/shadow) instead of OUI's MD5 challenge dance. Rides on TLS. |
| `0002-oui-home-route-status-overview` | `/` redirects to `/status/overview` (drops the duplicate `/home` route). |
| `0003-oui-localstorage-prefs-sidebar-footer` | Theme/locale persisted in localStorage with deterministic precedence (saved choice → device `get_theme` → OS); copyright footer moved into the sidebar. |
| `0004-oui-english-only-locale` | Strips zh-CN/zh-TW/ja-JP locales from the shell, apps, and element-plus (en fallback). |

The series is stacked (0003 on 0001's post-image, 0004 on 0003's). It is
regeneration-fragile — see `bb16d56` (0003 once carried a hunk that
cancelled 0001) before regenerating any member.

### Build-system one-offs

| patch | what it does |
|---|---|
| `netifd/0001-no-libnl-udebug` | Compiles out OpenWrt-only libnl udebug callbacks (vanilla Buildroot libnl lacks the hooks). |
| `ubox/0001-cmake-build-options` | `UBOX_BUILD_EXTRA_TOOLS`/`UBOX_BUILD_LOGGING` CMake options — skips unneeded tools and the udebug-linking logd. |

procd, uci, ucode, jsonfilter, udebug, virgilio-\*: carried **patchless**.

## Series discipline (all stacks)

1. Stacked trees: generate patch N+1 with patches 1..N applied to the
   submodule working tree.
2. Regenerate-until-identical, then replay on a **fresh extract** — the
   build must apply the whole series fuzz-0 (a contaminated baseline
   silently produces patches that reject on clean extracts; incidents:
   `de31c22`, `bb16d56`).
3. Verify stacking via the `index` blob hashes when in doubt (each patch's
   pre-image must equal the previous patch's post-image for shared files).
4. Header style for new patches: short `#` comment block with the product
   reason and an `Upstream-rev: <pin> + <patches>` baseline line.
5. Numbering is stable once shipped; reserved numbers are recorded in the
   plan doc that reserved them (statime 0002) — never renumber to close a gap.
