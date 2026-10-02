# Test — webui M2 (vendored OUI frontend + status page)

> **Status 2026-09-18**: historical snapshot — milestone test report of its
> execution date; rig era of its timestamp, not re-verified since.
> The OUI patch stack has since grown to four patches (0002 home-route,
> 0003 prefs/footer, 0004 english-only locale); "the ONLY OUI fork"
> below was true at execution time — current inventory: `docs/patches.md`.

DoD per `plan/webui.md` §12 M2, executed 2026-09-15: same simple-mode rig
as M1 (`--fwd 18080:80`), image rebuilt with the frontend (vendored OUI
@ 386f49e + one shell patch + `webui-app-status`).

## What shipped

- `deps/oui` (pinned rev, `.gitmodules`) — only `oui-ui-core` +
  `login/layout/home` apps are built; backend (lighttpd/lua-eco) unused.
- `patches/0001-oui-login-plaintext-post.patch` — the ONLY OUI fork: the
  shell's `$oui.login()` drops the MD5 challenge dance and POSTs the
  password (server verifies via /etc/shadow).
- `src/webui-app-status/` — tabs PTP | CamillaDSP | Logs, one
  `call('status','all')` per 2 s poll + `logs.read`, volume slider
  (`dsp.volume_set`, integer dB per `docs/camilladsp.md`).
- `scripts/webui/build-frontend.sh` — host-node npm+vite build into
  staging (shell → `ui/`, app UMD bundles → `ui/views/`, menus →
  `menu.d/`); wired into `webui.mk` (network at build time: same
  precedent as the camilladsp cargo build). Dist = **460 KB gzipped**.
- webuid: `ui.get_menus` (merged `menu.d`), `logs.read` (logread tail),
  `dsp.volume_set`. Boot symlinks S84nginx/S85webui.

## Results (host → 127.0.0.1:18080)

| Check | Result |
|---|---|
| `GET /` | 200, index.html (431 B) |
| `GET /assets/index-*.js` (AE gzip) | 200, 392 KB via **gzip_static** from the pre-built `.gz` |
| `GET /views/{login,layout,home,status}.umd.js` | 200 (1.7–4.0 KB each) |
| `login` (plaintext POST, as the patched shell sends) | 200 + sid |
| `call ui.get_menus` | merged menus: `/status /status/status /system /network` |
| `call status.all` | `ptp.locked=true` (lone master), `dsp=null` (camilladsp off), board data |
| `call logs.read` | live logread tail |
| M1 regression (auth gating, /ws 403/101) | unchanged (M1 suite still applies) |

Not verified here (no browser on the rig): actual rendering/interaction.
Every request the SPA issues is verified; a headless-browser pass can be
added to the rig later.

## Bugs found the hard way (all fixed in-tree)

1. **`gzip_static on;` was missing** — the directive existed only in the
   plan text, not the conf. Symptom: assets 404 (only `.gz` files exist,
   `vite-plugin-compression` deletes originals).
2. **gzip_static respects `gzip_types`** (default: text/html only) —
   .js/.css assets need `gzip_types application/javascript text/css …`.
3. **ucode: `lsdir` needs the `fs` import** — a bare `lsdir()` global is
   undefined, throws, and my `try { } catch { return {} }` swallowed it
   into silently-empty menus. Lesson recorded in
   `scripts/webui/README.md`; the catch now only guards the directory
   probe itself.
4. OUI app bundles must be named by view (`login.umd.js`), not package
   dir (`oui-app-login`) — strip both `oui-app-` and `webui-app-`
   prefixes in the build script.
5. procd `restart` of a service whose stdout is block-buffered hides
   logs mid-run (file-write debugging beats printf on target).
