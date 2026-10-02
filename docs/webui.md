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

## DSP > Live EQ: spectrum display

The order-icon button in each EQ fader header opens **Filter settings**:
edit the filter name and use **Save name** (or Enter), or **Cancel**. Duplicate
names are rejected. The separate **Delete band** action removes the filter.
Naming/deletion remains available for muted filters in editable blocks.

The live EQ page can show the signal spectrum behind the EQ curves
(**Spectrum** toggle — it starts off on every page load because the
analysis costs CPU on the speaker). The **Spectrum** section is first,
followed by **Spectrum Signal Tap** for PRE/POST selection.

- **Series**: **RTA** draws one bar per frequency bucket;
  **STA**/**LTA** draw the short/long-term averaged curve. **Peak** adds
  the peak-hold envelope (dashed curve, or crest markers on the bars).
  RTA peaks hold for 2 seconds, then decay at 12 dB/s to the plot floor,
  independently of whether the live bar is below the gate. Crest markers
  use dark amber on light backgrounds and pale amber on dark backgrounds,
  with a contrasting outline.
- **Heatmap**: with **RTA** the bars take the blue→green→red level scale
  (red = the last ~3 dB below clipping); with **STA/LTA** the curve gets
  a fill whose brightness follows the signal, with fill styles and a
   tunable opacity chain (Contrast/Gain/Gate/Max α) in the settings popover
   opened by the header gear next to the enable toggle.
  RTA colors are blue at −30 dBFS, cyan at −24, green at −18 through −9,
  orange at −6 and red at −3 dBFS, interpolated between those levels.
- The vertical scale is a fixed **66 dB** window: **+6…−60 dBFS** at
  offset zero. **Offset** shifts the window by **−12…+12 dB**; the window
   label and dotted **0 dBFS** reference follow it, with both labels on
   the left of the chart. Quiet material sits
  lower and silence is below the floor; the axis never auto-rescales.
  RTA heatmap colors remain tied to absolute dBFS regardless of offset.
  An inset **dBFS** ruler inside the left canvas edge marks 0, −12, −24, −36, −48 and
  −60 when visible; EQ gain remains on the right. Only the 0 dBFS reference
  spans the chart, avoiding a second full grid. The ruler reserves no gutter
  and disappears with the spectrum when disabled. Hover **Offset** for its
  display-only explanation; click its numeric value to reset to 0 dB.
- **High precision**, in the **Spectrum** section, raises the bucket
  count (32 → 128); the FFT size
  follows the sample rate automatically (4096 at 44.1/48 kHz, 8192 at
  96 kHz). A precision or frequency-grid change reseeds averages and
  peaks, so old bins cannot be drawn on a different frequency grid.
- **Curve smoothing** applies only to STA/LTA and is disabled in RTA mode,
  preserving the original bucket response. Its setting is remembered when
  returning to curves. It respects its toggle and selected mode at both
  resolutions. On coarse 32-bin data the three modes use minimum
  half-widths of 1/2/4 buckets to stay visually distinct; their displayed
  octave fractions are therefore approximate at that resolution.
  Changing smoothing immediately reseeds the averages from the latest
  spectrum frame, so LTA does not retain the previous smoothing shape.
- **Reset averages** resets STA/LTA and all peak envelopes, including RTA
  bar crests. **Signal Tap** is disabled while the spectrum is off; PRE/POST
  explanations use hover/focus tooltips.
- In **RTA** heatmap settings, **Gain** controls palette sensitivity: 1.0×
  preserves the default dBFS color thresholds; higher values make quieter
  buckets reach red sooner. **Max α** independently controls bar opacity.
  Neither changes bar height. **Contrast** and **Fill**
  are disabled because those apply to curve-mode fills only.
  Gain uses a logarithmic slider centered at 1.0×, from 0.25× to 4.0×.
  **Gate** is an absolute visual threshold in **dBFS** (−90…0, default −57),
  independent of Offset and Gain, not an audio gate. RTA hides bars below it;
  peaks remain independent. Curve fills use a 2 dB soft knee around that
  threshold. Under/Above/Background use identical per-column RGBA;
  only the painted vertical extent changes.


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
Test reports: `results/test-webui-m*.md`.
