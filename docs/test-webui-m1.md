# Test — webui M1 (skeleton: nginx + webuid + auth contract)

DoD per `plan/webui.md` §12 M1, executed 2026-09-15 on the bridge-rig
workflow (simple mode): `./scripts/run-qemu.sh --net user --fwd 18080:80
--console telnet:5560`, Buildroot image built from `rk3506qemu_defconfig`
with `BR2_PACKAGE_WEBUI=y`.

## Setup in guest (console)

```
/etc/init.d/webui enable; /etc/init.d/nginx enable
/etc/init.d/webui start; /etc/init.d/nginx start
# root password for the shadow-verify test (image ships root/empty):
H=$(mkpasswd -m sha512 test123)
sed -i "s#^root:[^:]*:#root:${H}:#" /etc/shadow
```

Known prereg issues hit and fixed along the way (all landed):

1. nginx default temp paths `/var/cache/nginx/*` do not exist and nginx
   only `mkdir`s the LAST path component → crash loop at boot. Fixed:
   flat tmpfs paths in `nginx.conf` (`/tmp/nginx_client` etc.).
2. `single-nic-fixup` disables `network.lan` DHCP on every single-NIC
   boot — including `--net user` simple mode, not only `--no-mgmt` rigs.
   For this test DHCP was restored by hand in the guest:
   `uci set network.lan.proto=dhcp; uci commit; /etc/init.d/network
   restart` (eth0 → 10.0.2.15). **Open item:** teach the fixup to tell
   simple mode from `--no-mgmt` (or run webui tests on the tap rig).

## Results (host → 127.0.0.1:18080 → guest nginx :80)

| # | Case | Result |
|---|---|---|
| 1 | `login` root/test123 (real `$6$` shadow hash, busybox cryptpw) | `200` + `{sid}` + `Set-Cookie: webui_sid=…; HttpOnly; SameSite=Strict` |
| 2 | `login` root/WRONG | `401` (with per-addr backoff delay) |
| 3 | `login` non-root | `401` |
| 4 | `alive` with sid | `{ "alive": true }` |
| 5 | `call` without session | `401` |
| 6 | `call status.all` | live data: `dsp.state=Starting`, `version 4.1.3`, `board.hostname=rk3506qemu` |
| 7 | WS probe `/ws` **no cookie** | **`403`** — auth_request rejects before any proxying |
| 8 | WS probe `/ws` valid cookie | **`101 Switching Protocols`** — full chain nginx→camilladsp WS |
| 9 | WS probe `/ws` bogus cookie | `403` |
| 10 | direct `GET /_auth` | `404` (internal location not directly reachable) |

In-guest sanity: `wget --post-data … http://127.0.0.1/oui-rpc` →
`{ "alive": false }`; SCGI socket `/run/webui.sock` as
`srw-rw---- root www-data 0660`.

Host contract suite (14 cases, `scripts/webui/test-webuid.sh`): 14/14
PASS against the host ucode harness (see `scripts/webui/README.md`).

## Verdict

**M1 green** twice in a row (host suite + target e2e). The auth-gated
websocket — the requirement that drove the whole architecture — is
verified end to end: unauthenticated `/ws` never reaches camilladsp,
authenticated handshakes complete.
