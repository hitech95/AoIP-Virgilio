# webui — user guide

The speaker's web interface. Reach it at `http://<device>/` (or
`https://` once TLS is enabled — see below). Chrome/Firefox/Safari on a
LAN machine; nothing to install.

## First login

A fresh device has **no administrator password**: the login page asks
you to **set one** (min 6 chars). That password is the `root` account —
the same one used on the serial console. It can be changed later under
**System**.

Sessions expire after 5 minutes of inactivity; failed logins are slowed
down exponentially (1, 2, 4, 8 s per attempt from the same address).

## Pages

| Page | What it does |
|---|---|
| **Status** | one screen: PTP lock + freq correction, CamillaDSP state/volume, system logs (tabs, 2 s refresh) |
| **System** | hostname, timezone, password change, reboot |
| **Network** | management interface (eth0/lan): DHCP or static address. **Careful: a wrong static address can lock you out** |
| **DSP > Filters** | your EQ: add/remove/reorder filters in the speaker's user slots, with a live response curve per channel; source-select presets (ch0 / ch1 / mix) |
| **DSP > Files** | upload FIR coefficient files; they take effect only when a `conv` filter in *Filters* references them |

### What the Filters page will NOT let you do

The speaker's crossover, protection limiting and driver FIRs are
**locked by the manufacturer** — they are not rendered as editable and
cannot be changed from the web UI, the websocket API, or any tool: every
configuration change is validated against a signed manifest inside
CamillaDSP itself (attempts are rejected and logged). Your EQ lives in
dedicated slots per input channel; the allowed filter types and the
maximum number of steps are set by the product configuration.

## TLS (HTTPS)

The device ships HTTP-only on the LAN. To enable HTTPS (recommended —
the login password otherwise travels unencrypted):

```sh
# on the device console (certificates are admin-supplied; the image
# ships no openssl):
uci set webui.tls.enable='1'
uci set webui.tls.cert='/etc/webui/cert.pem'     # defaults
uci set webui.tls.key='/etc/webui/key.pem'
uci commit webui
service webui reload        # assembles + tests the nginx config, reloads
```

With TLS on, port 80 answers with a redirect to HTTPS and the session
cookie is marked `Secure`. If the certificate files are missing the
device stays on HTTP (logged on the console) rather than becoming
unreachable.

## Security model (summary)

- nginx is the only listening service; the CamillaDSP websocket is
  reachable **only** through the authenticated `/ws` proxy.
- Login verifies the Linux `/etc/shadow` hash of `root` (SHA-512).
- Sessions: RAM-only, bound to the client address, 5 min sliding TTL.
- The generic config bridge can only write `system`, `network`,
  `camilladsp`, `inferno`, `webui` — everything else is read-only.
- Uploaded files land in `/opt/user_data/filters/` with sanitized
  names; they are inert data until referenced by a filter.
- Every DSP change is validated three times: by the webui daemon, by
  the config generator, and by the manifest enforcement inside
  CamillaDSP.

Architecture, wire contract and design decisions: `plan/webui.md`.
Test reports: `docs/test-webui-m*.md`.
