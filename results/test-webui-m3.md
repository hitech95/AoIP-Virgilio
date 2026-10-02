# Test — webui M3 (config pages: generic uci bridge + system + network)

DoD per `plan/webui.md` §12 M3, executed 2026-09-15 on the simple-mode
rig. All flows driven over HTTP exactly as the apps drive them.

## What shipped

- **webuid uci bridge** (plan §4): `load/get/set/add/delete` on the ucode
  uci cursor, **write-ACL allowlist** `{system network camilladsp inferno
  webui}` — reading any config, writing only those. `set` commits
  immediately (OUI model); `delete` takes `options[]` for option-level
  deletes.
- **webui.set_password**: verifies the current password via cryptpw,
  hashes the new one with `mkpasswd -m sha512` (random salt), rewrites
  the root shadow field, then **drops every session** (force re-login).
- **webui-app-system** (vendored from `oui-app-system` + our panels):
  hostname + timezone (full zoneinfo table, POSIX TZ string), password
  change, reboot. Apply = `uci set` + `$oui.reloadConfig('system')` →
  `ubus service event config.change` → procd reload trigger →
  `/etc/init.d/system reload` re-applies hostname/TZ.
- **webui-app-network**: LAN (eth0) dhcp/static editor, lockout warning,
  stale-option cleanup on protocol switch, apply via
  `ubus call network reload`.

## Results (host → 127.0.0.1:18080, then console verification)

| Check | Result |
|---|---|
| `uci.load system` | full section tree incl. ntp |
| `uci.set hostname/zonename/timezone` + reloadConfig | persisted; `hostname` → `speaker-living`; `zonename=Europe/Rome` + POSIX TZ in uci |
| `uci.set` on non-allowlisted config | `error -4 config not writable` |
| network static flow (set → delete stale → `network reload`) | eth0 = 192.168.50.7 via netifd (verified in guest; hostfwd broke as expected — that's the lockout the UI warns about) |
| network dhcp restore | 10.0.2.15 lease back |
| `set_password` wrong current | `-3 current password wrong` |
| `set_password` correct | `{}`; **all sessions invalidated** (`alive` false); login with new password works |
| M1/M2 regression | auth gating, menus, status, logs unchanged |

## Bugs found the hard way

1. **ucode ubus void replies are `null`** — methods like `network
   reload` or `service event` return an empty blob; treating null as
   failure produced false `-6` errors (and hid the fact that the
   operation succeeded). Fixed inside `ubus_call`: `conn.call(...) ??
   {}`. Lesson added to `scripts/webui/README.md`.
2. **`ubus call system board` caches the boot-time hostname** — after a
   hostname change the status page shows the old name until reboot (or
   procd restart). Cosmetic; noted here so it is not mistaken for an
   apply failure (check `hostname` / shell prompt instead).
3. ucode `uci.foreach(config, callback)` silently does nothing — the
   callback lands in the *type-filter* slot; the correct form is
   `foreach(config, null, cb)`.

## Notes

- The OUI shell's `reloadConfig()` sugar (`ubus service event`) is the
  canonical apply path on this firmware — procd's per-service reload
  triggers (`procd_add_reload_trigger`) are registered by the
  OpenWrt-style init scripts and verified to fire for `system`.
- The network page's explicit `network reload` is belt-and-braces;
  `service event {package: network}` would also work via
  `/etc/init.d/network reload`.
