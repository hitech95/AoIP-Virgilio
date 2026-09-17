# webui host dev-loop (plan/webui.md M1)

Run the webuid daemon on the development host against a host build of
the pinned ucode, and drive the full JSON contract over SCGI — no QEMU
needed for daemon work. Everything here is host-only; nothing ships in
the image.

## One-time: host ucode build (pinned rev + needed modules)

The Buildroot toolchain produces a *target* (armv7) ucode; for host runs
build a second one. Requires json-c (static is fine) + libubox + ubus
headers; all small cmake projects:

```sh
PREFIX=$HOME/.cache/uc-host           # anywhere writable
git clone https://github.com/json-c/json-c && \
  cmake -S json-c -B json-c/build -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_INSTALL_PREFIX=$PREFIX && \
  cmake --build json-c/build -j && cmake --install json-c/build
git clone https://github.com/openwrt/libubox && \
  cmake -S libubox -B libubox/build -DBUILD_LUA=OFF -DCMAKE_PREFIX_PATH=$PREFIX \
    -DCMAKE_INSTALL_PREFIX=$PREFIX && cmake --build libubox/build -j && \
  cmake --install libubox/build
git clone https://github.com/openwrt/ubus && \
  cmake -S ubus -B ubus/build -DBUILD_LUA=OFF -DCMAKE_PREFIX_PATH=$PREFIX \
    -DCMAKE_INSTALL_PREFIX=$PREFIX && cmake --build ubus/build -j && \
  cmake --install ubus/build
git clone https://github.com/jow-/ucode && cd ucode && \
  git checkout 85922056ef7abeace3cca3ab28bc1ac2d88e31b1 && \
  cmake -S . -B build-host -DCMAKE_PREFIX_PATH=$PREFIX -DCMAKE_INSTALL_PREFIX=$PREFIX \
    -DSOVERSION=20230711 -DFS_SUPPORT=ON -DUBUS_SUPPORT=ON -DULOOP_SUPPORT=ON \
    -DSOCKET_SUPPORT=ON -DUCI_SUPPORT=OFF \
    -DCMAKE_C_FLAGS="-Wno-error" && cmake --build build-host -j && \
  cmake --install build-host
```

(Use the exact rev from `br-external/package/ucode/ucode.mk`. gcc >= 14
needs `-Wno-error` for one const-qualifier warning.)

## Files

- `build-frontend.sh` — builds the vendored OUI shell + our apps into a
  staging tree (`ui/`, `ui/views/`, `menu.d/`); injects `skin.css` into
  the shell's index.html. Host node only, nothing ships.
- `scgi.py` — minimal SCGI client speaking exactly what nginx
  `scgi_pass` sends (netstring env + body). Use for raw contract tests.
- `test-webuid.sh` — 14-case contract suite (login/alive/logout/call/
  error codes). Expects the daemon on `/tmp/webui.sock`. Run the SPLIT
  daemon (module tree) like this — note **-L needs an ABSOLUTE path**:

  ```sh
  ucode -L "$REPO/br-external/package/webui/daemon/modules" \
        "$REPO/br-external/package/webui/daemon/webuid" \
        /tmp/webui.sock scripts/webui/shadow-fixture
  ```

  (PATH must include a `cryptpw` stub that echoes its 2nd argument.)
- `ws_probe.py` — raw WS handshake probe: prints the status line
  (403 vs 101 vs 502) for `/ws` with/without a cookie.
- `shadow-fixture` — fake `/etc/shadow` for the daemon's second argv.

The daemon itself lives in `br-external/package/webui/daemon/`:
`webuid` (composition root) + `modules/*.uc` (util, http, sessions,
auth, ubusx, ucix, dsp, filesx, menus, mods_* -> rpcmods, rpc, scgix),
installed to `/usr/bin/webuid` + `/usr/share/webui/ucode/`.

## Gotchas found the hard way (keep in mind)

- **ucode module syntax (pinned rev)**: `export { a, b };` lists work,
  but `export function f()` FAILS to parse; and `ucode -c file.uc`
  compiles as a PROGRAM where any export is illegal — import the file
  (or compile the entry) to check modules.
- **`ucode -L <dir>` needs an ABSOLUTE path** — multi-segment relative
  module dirs silently fail to resolve.
- **every fs-module function must be imported** (`lsdir`, `open`,
  `popen`, ...): a bare call is an undefined global that throws — inside
  a try/catch this fails silently (cost: hours; twice).
- **ucode has no function hoisting**: a function may only call functions
  declared *textually above* it (later names resolve as missing globals
  at runtime). Bottom-up order within a file; cross-file imports are
  resolved at module load and are safe.
- **fs-module functions must be imported** (`lsdir`, `writefile`, ...):
  a bare `lsdir()` is an undefined global that throws — inside a
  `try/catch` this fails silently (cost: an hour of empty menus).
- **pinned-rev ucode has no argv-form `fs.popen`** — commands go through
  `/bin/sh -c` strings; use single-quote escaping (`shq()` in util.uc).
- **`json(x)` only parses** in this rev; serialization is
  `sprintf("%J", obj)`. `join(sep, array)` takes the separator FIRST.
- **ucode uci: mutations need `c.load(config)` first** — `add()`/`set()`
  on a not-yet-loaded cursor silently lose their staged delta at
  `commit()`. Every write path loads before staging.
- **ucode ubus void replies are `null`** — `network reload`, `service
   event` etc. return an empty blob; treat null as SUCCESS (`conn.call()
   ?? {}`), real failures raise exceptions.
- **`uci.foreach(config, cb)` silently no-ops** — the callback lands in
  the type-filter slot; use `foreach(config, null, cb)`.
- **nginx `gzip_static` respects `gzip_types`** — pre-gzipped .js/.css
  assets 404 unless the types are listed (default: text/html only).
- Never put a `pkill -f <daemon-pattern>` in the same shell command as
  anything mentioning the daemon path — the wrapper's own cmdline
  matches and the shell kills itself.

## QEMU target test

See `docs/test-webui-m1.md`.
