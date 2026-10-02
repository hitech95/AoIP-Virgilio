# webui-app-inferno ↔ camilladsp coupling (rework needed)

> **Status 2026-09-27**: open (documented debt) — the Kconfig dependency
> `BR2_PACKAGE_WEBUI_APP_INFERNO select BR2_PACKAGE_CAMILLADSP` is a
> workaround for an architectural coupling, not a clean dependency.

## Current state

The inferno webui app does two things:

1. **Status view** — Dante node state (subscriptions, flows, clock).
   Needs only `inferno` (+ core ubus).
2. **Settings page** — edits `/etc/config/inferno` (advertised device
   name, bind interface) and *applies* them by restarting camilladsp:

   `br-external/package/webui/src/webui-app-inferno/daemon/mods_inferno.uc:60`
   ```js
   let p = popen("(sleep 1; /etc/init.d/camilladsp restart) >/dev/null 2>&1 &", "r");
   ```

## Why the coupling exists

In the current product architecture the inferno ALSA PCM runs **inside
the camilladsp process** (capture/playback device `Inferno`). Its runtime
settings (device name, channels, sample rate, bind interface) live in
`/etc/config/inferno` but are only consumed when `camilladsp-genconf`
renders them into the camilladsp config at (re)start. There is no
standalone inferno daemon in the product path, so "apply inferno
settings" is literally "restart camilladsp".

Consequences:

- The webui app hard-codes knowledge of *another* service's init script
  (layering violation: app → service → service).
- `WEBUI_APP_INFERNO` forces `CAMILLADSP` even for a hypothetical
  capture-only / status-only device (see docs/dependency-map.md).
- A device that runs inferno outside camilladsp (e.g. inferno2pipe,
  aoip-bridge debug path) cannot apply settings from the UI.

## Rework options (in increasing order of effort)

### A. Guard the restart (soft dep, minimal)

Make the apply path conditional and drop the Kconfig select:

```js
if (params?.apply != false && access("/etc/init.d/camilladsp", X_OK))
	popen("(sleep 1; /etc/init.d/camilladsp restart) >/dev/null 2>&1 &", "r");
```

`WEBUI_APP_INFERNO` then selects only `inferno`. Settings apply silently
becomes commit-only where camilladsp is absent. Cheap, but the layering
violation (app restarting a foreign service) remains.

### B. uci-commit + ubus event (OpenWrt-style decoupling)

The app only `uci commit`s (already does) and emits an ubus event, e.g.
`ubus call webui event '{ "type": "config.change", "data": { "config": "inferno" } }'`
(or procd's existing config-reload plumbing). The consumer side — whoever
embeds the inferno PCM, today camilladsp's init — subscribes and reloads
itself. No app knows about other services; the dependency becomes purely
runtime and optional. This is the target architecture for *all* webui
settings pages (network already goes through uci/netifd reload).

### C. Standalone inferno supervision (bigger redesign)

If inferno grows its own supervised lifecycle (name registration,
subscription management outside camilladsp), the settings page becomes a
plain `reload` of the inferno service and the camilladsp link disappears
naturally. Track together with any "inferno as a service" work.

## Rule going forward

New webui apps must not call other services' init scripts directly;
declare the Kconfig dep for what they *talk to over ubus/uci* and use
events/reloads for propagation. Add the check to the review notes in
docs/dependency-map.md when this is resolved.
