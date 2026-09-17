# Test — webui M5 (TLS, first-boot password, hardening)

DoD per `plan/webui.md` §12 M5, executed 2026-09-15 on the simple-mode
rig (`--fwd 18080:80 --fwd 18443:443`). Certificates: self-signed pair
generated on the host, fetched by the guest over slirp
(`http://10.0.2.2:8001`) — the image ships no openssl CLI, certs are
admin-supplied by design.

## What shipped

- **nginx restructure**: static `nginx.conf` (globals + security
  headers + `include conf.d/*.conf`), shared `webui-locations.conf`,
  and three server-block templates assembled by `/etc/init.d/webui`
  from `uci webui.tls` (`nginx-http.conf`, `nginx-redirect.conf`,
  `nginx-https.conf.in`). `service webui reload` regenerates, runs
  `nginx -t`, and only reloads when valid.
- **BR2_PACKAGE_NGINX_HTTP_SSL_MODULE** enabled (webui Config.in).
- **webuid**: `webui.firstboot_status` / `webui.firstboot` (no-auth
  allowlist, precondition = empty root hash), login returns `-1001`
  firstboot marker on empty root password, `Secure` cookie while TLS
  is on.
- **Own login app** (`webui-app-login`) replaces OUI's: normal login +
  first-boot set-password flow. OUI fork count stays at one (the shell
  login patch).

## Results

| Check | Result |
|---|---|
| HTTP → HTTPS redirect (tls on) | `301 -> https://…` |
| HTTPS index + headers | 200 + `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |
| `firstboot_status` without session (fresh boot, empty root pw) | `{firstboot: true}` |
| login with empty root pw | `401 {"code":-1001,"message":"firstboot: set a root password"}` |
| `webui.firstboot {new}` (unauthenticated) | `{}` — password set |
| `webui.firstboot` again (hash now set) | `-4 root password already set` |
| login with the new password | sid + `Set-Cookie: …; HttpOnly; SameSite=Strict; Secure` |
| WS over wss without cookie | `403` |
| WS over wss with cookie | `101 Switching Protocols` |
| rate-limit (4 wrong logins) | 1.2 s → 2.2 s → 4.2 s → 8.2 s (exponential, non-blocking) |
| correct login after backoff | 0.17 s (immediate) |
| config-test guard | invalid generated config (missing ssl module pre-rebuild) left the RUNNING config untouched |

## Bugs found the hard way

1. The init script referenced template filenames that did not match the
   installed ones (`https.conf` vs `nginx-https.conf.in`) — nothing
   listened. Also `/etc/nginx/conf.d` needed `mkdir -p` (not in the
   skeleton).
2. **nginx was built without the SSL module** — enabling a Buildroot
   symbol does not rebuild an already-built package; `nginx-dirclean`
   was required. Symptom: `nginx -t` → *"the ssl parameter requires
   ngx_http_ssl_module"*.
3. Boot order: nginx (S84) starts before webui (S85) assembles
   `conf.d/` → first boot listened on nothing until a reload. Fixed:
   `start_service` reloads nginx after assembling.
4. Pushing long base64 through the serial console (heredoc) corrupts
   lines — transfer files via the slirp host (10.0.2.2) instead.

## camillagui under /diag — decision

**Not shipped in v1**: the filters page + auth'd `/ws` cover the tuning
use case; the official GUI dist can be dropped into
`/usr/share/webui/ui/diag/` later without any backend change (patch
0003 keeps it honest).
