# Spectrum regression review — 2026-10-02

> **Status 2026-10-02**: completed (regression review) — confirmed faults fixed by
> the 2026-10-02 spectrum commits; re-test steps recorded below.

## Confirmed faults and fixes

- STA/LTA/peak arrays survived 32→128 switches. Old frequency indices were
  reused on the new grid; undefined entries turned into NaN. Reseed all
  arrays and timestamps on length changes; controller resets on changed
  center frequencies, tap changes, and stop/reconnect.
- High precision silently forced curve smoothing off. Respect the user mode.
- Curve lines used the latest poll while heatmap fill used an interpolated
  frame. Draw both from the same display frame; apply offset every rAF.
- Heatmap interpolation was linear in Hz while the curve was linear in log-X.
  Use log-frequency interpolation and clamp fill magnitudes before drawing.
- RTA heatmap colors followed the viewport offset. Convert the unclamped
  display magnitude back to absolute dBFS for color; red stop at −3 dBFS.
- Enabling the DSP spectrum reset its interval asynchronously to 100 ms,
  racing the RTA 50 ms configuration. Remove the hidden interval/tap setters.
- Avoid overlapping spectrum polls and discard responses after stop/tap changes.
- Correct stale scale/protocol comments; remove duplicate heatmap styles.

## Verification actually performed

- `npm run test:spectrum`: precision transitions 32→128→32→128, all averaged
  and peak arrays, finite rendered coordinates, peak frequency X positions,
  axis inverse mapping, silence, amplitude direction, absolute color thresholds,
  distinct smoothing outputs in both resolutions. The transition assertion
  reproduced the original NaN/stale-index failure before the analyzer guard.
- Targeted TypeScript check of `rendering/spectrumVizController.ts` and `dsp.ts`
  with ES2022/DOM, ESNext, bundler resolution and skipLibCheck: passed.
- Actual daemon stepped tones through ALSA loopback, then repeated with
  CamillaDSP `SignalGenerator` capture in an isolated QEMU guest. Frequencies:
  50, 100, 250, 1000, 4000, 10000, 16000 Hz, plus near-silence; 32/128 bins,
  Fs 48 kHz, FFT 4096. Stop/start and reset spectrum between Generator steps
  to avoid stale daemon snapshots during capture reconfiguration.
- Chrome connected through Playwright MCP extension to the authenticated
  live EQ page. Served the newly built production bundle and replayed the
  recorded REAL daemon frames through the page's spectrum WebSocket request
  path. Config/other requests still forwarded to the guest. Checked actual
  canvas path coordinates, not a separate mapping formula.
- 56 STA/LTA frequency-position checks passed through repeated precision
  switches. Switches also checked without Reset averages: no NaNs or left
  remapping. 1 kHz plots at 991 Hz, 4 kHz at 3900 Hz, 10 kHz at 10116 Hz
  in high precision — the daemon's actual bucket centers.
- Three high-precision smoothing modes produce distinct curves; silence
  settles at the bottom with no heatmap fill. Screenshots and numeric
  results are in `/tmp/opencode/sta-high-precision-chrome.png`,
  `/tmp/opencode/sta-silence-chrome.png`, and
  `/tmp/opencode/chrome-sweep-results.json`.

## Limits and remaining considerations

- This was a stepped sweep with captured-frame browser replay, not a
  simultaneous continuous chirp through the rig's current audio source.
- Only 48 kHz was exercised end-to-end in this review.
- Low-frequency resolution is limited by FFT 4096 (11.72 Hz bins): a 50 Hz
  tone can produce a tied plateau in high precision around the 46.875 Hz FFT
  bin; the leftmost maximum is labeled 42 Hz. That limitation is different
  from the fixed stale-average index remapping across the whole spectrum.
- Daemon aggregation yields roughly −10.2 dBFS for a −12 dBFS generator
  tone above the low-frequency resolution region (Hann power aggregation).
  Absolute broadband calibration remains a daemon-level consideration.
- Fractional octave labels are approximate on 32 coarse buckets because
  minimum kernels keep the controls distinct; this is documented in the UI guide.

This record supersedes earlier plan claims that arithmetic-only probes had
verified actual rendered curve direction/position or authenticated Chrome.

## Packaging/deployment

- `webui-rebuild` and full `virgilio_srcqemu_defconfig` image build passed.
- Confirmed the new bundle is present in `rootfs.ext2` (the `rootfs.ext4`
  image symlink). Uncompressed bundle SHA-256:
  `e422680954ce6680b1180280035626b0d55b6fc0f925b6d42af13df023d67be6`.
- The active rig was left running: serial was occupied by an existing telnet
  session, and live deployment was not confirmed. Its HTTP bundle still had
  the old hash. Restart the rig from the rebuilt image to deploy these fixes.
- Removed temporary Chrome bundle/frame interception and stopped the isolated
  test guest and sweep servers after verification.

## Follow-up: RTA crest visibility and palette

- Removed the live-bar gate from crest drawing. Held peaks remain visible
  after the live bar disappears and decay below the bar gate to the viewport
  floor before disappearing. A zero-height bar is never painted, even if
  the gate tuning is zero.
- Crests use a dark amber core/white outline in light mode and pale amber
  core/dark outline in dark mode; theme is sampled each render.
- The previous ramp blended toward orange starting at −24 dBFS. Added
  explicit absolute stops: blue −30, cyan −24, green −18 through −9,
  orange −6, red −3 dBFS. These are visualization thresholds, not a
  claim of a calibrated hardware-meter palette.
- Regression test drives actual analyzer hold/decay and RTA drawing from
  live to silence, checks the marker below the gate and disappearance at
  the floor, and verifies −18/−12/−9 remain green at every window offset.
- Chrome verification used a temporary harness importing the production
  RTA layer/analyzer, since the live guest required a new login after its
  restart. Light/dark screenshots: `/tmp/opencode/rta-palette-light.png`
  and `/tmp/opencode/rta-palette-dark.png`. Canvas checks confirm all ten
  markers survive 2 s hold after silence and decay to none at 7.5 s.
- Targeted TypeScript check and `npm run test:spectrum` passed.

## Follow-up: dedicated spectrum ruler and isolated preview

- Left dBFS column: 0/−12/−24/−36/−48/−60 ticks, mapped through the same
  66 dB normalization as the spectrum. Out-of-window ticks are hidden;
  0 is pinned with an arrow when above the window. EQ gain stays right.
- Short ruler marks only; the dotted 0 dBFS reference is the sole full-width
  spectrum line. Improved its light-theme contrast and kept the −60 label
  inside the chart footer boundary.
- Offset tooltip explains display-only behavior; clicking the numeric
  offset resets to 0 dB.
- WebUI rebuild, srcqemu image build, spectrum regressions and diff check
  passed. Separate snapshot guest serves `http://127.0.0.1:18086/#/dsp/live`,
  console 5569, disconnected socket segment 15569. Host forwards are
  loopback-only, no tap attachment or host audio playback.
- Chrome/Playwright checks ran against the authenticated full application
  served by that guest, not a component harness: ruler positions, −12/+12
  offset endpoints, reset, tooltip, series switching and heatmap popover.
   Temporary Playwright screenshots and snapshots were removed after review.
- The test DSP currently captures the guest ALSA loopback and discards
  playback to `/dev/null`; no continuous test source is left running.
  These UI checks do not claim a new end-to-end audio sweep.
- Existing playback guest PID 2971005 stayed running; only the preview
  guest was restarted after the final label/contrast adjustment.

## Follow-up: spectrum controls and smoothing

- Restored blue RTA/LTA and green STA button styles, including plain
  colored inactive states. Disabled tap selection when FFT is off.
- PRE/POST use Element Plus virtual tooltips anchored to the SVG groups;
  tooltip components live outside the SVG namespace for reliable rendering.
- Smoothing changes reprocess the cached raw frame and reseed history;
  old LTA smoothing no longer takes 8–16 seconds to settle out.
- Reset averages now resets all peak envelopes/timestamps; layer configs
  refresh immediately, including RTA crests.
- RTA Gain/Max α now affect uniform bar opacity; Contrast/Fill are disabled.
- Regression tests and targeted TypeScript passed. WebUI/image builds and
  diff check passed. Updated only the loopback preview guest.
- Chrome checks of the image-served full app used recorded real daemon
  tone/silence frames through Playwright WS replay: distinct STA/LTA shapes
  at all three smoothing settings within 500 ms, no manual average reset;
  RTA held markers disappeared on reset; bar RGBA changed with Gain/Max α;
  Fill/Contrast disabled; tap disabled with FFT off; PRE hover tooltip visible.
  Replay instrumentation is temporary and removed by page navigation.

## Follow-up: RTA gain sensitivity and consistent fill opacity

- Corrected RTA Gain semantics: color-ramp coordinate is multiplied by
  Gain/2.5 (2.5 preserves the default palette); Max α alone sets opacity.
  Geometry and peak levels remain unchanged. Gate remains a visual cutoff.
- Removed hard-coded Above ×0.45 and Background ×0.60 alpha multipliers;
  all curve fill modes now share per-column RGBA, changing only extent.
- Added regression assertions for same −18 dBFS bar green at Gain 2.5/red
  at Gain 4 with identical alpha, plus identical fill RGBA and complementary
  under/above geometry. Tests, production build, full image build, diff check
  passed.
- Chrome actual-production-layer harness verified identical RGBA for 400
  columns in all fill modes and identical bar height/opacity while Gain
  changed hue. This follow-up was not tested on the authenticated main app;
  the main playback guest was left running with its previously deployed build.

## Follow-up: neutral Gain and absolute Gate

- Gain now uses 1× neutral and a logarithmic 0.25×–4× slider, geometrically
  centered at 1×. RTA multiplies the absolute palette coordinate by Gain;
  curve fills retain the original baseline opacity multiplier internally.
- Gate is now −90…0 dBFS, default −57, independent of Offset and Gain.
  RTA uses an absolute cutoff; curve fill uses a 2 dB soft knee.
- Persistence version 4 migrates version-3 Gain /2.5 and converts its gate
  fraction to dBFS at Offset 0, preserving other visualization preferences.
- Regression tests verify offset-independent gates in both render paths,
  neutral color sensitivity, and persistence migration. Tests, targeted
  controller/DSP TypeScript, production build, package/image builds, and
  diff check passed. Initial packaging silently failed (`/tmp` inode
  exhaustion) and was not deployed at first; after the rebuild fix this UI is
  now deployed to the main guest (served bundle SHA-256
  `93d4d0416d7de241e179acb433755f3dc76a278fc66684599a55f1cb52f96c32`, PTP
  locked, CamillaDSP/MPD confirmed). No additional authenticated browser
  verification is claimed beyond the mock-config UMD harness.

## Follow-up: capture/playback meter colors and scale alignment

- Shared `VuMeter.vue` previously resized the gradient with RMS fill height,
  placing red at the top even for quiet signals. It now clips a full-track
  gradient with fixed dBFS color stops (green through −18, amber at −6,
  orange at −3, red at 0).
- Labels previously used the channel height including its name; bars used
  the shorter track height. Scale layout now excludes the fixed-height name
  row. Existing continuous piecewise mapping (−108…+9 dBFS) is retained.
- Headless Chromium rendered the actual Vue component at three fluid heights
  and a fixed 200px height, sweeping 11 known levels on both channels.
  Label/zero alignment errors were below 0.6px; fill clipping and peak
  positions matched the known levels. This was an isolated component check,
  not an authenticated live-page inspection (Chrome extension unavailable).
- Production build, package build, image build and `git diff --check` passed.
  Staged, target, image and served bundle content/hash matched:
  `ed5563043a463f38c30070712b1541bb0f17c3d82c278160500372c0dc776cc5`.
  Source guest restarted; HTTP 200, PTP locked, CamillaDSP and MPD running.
