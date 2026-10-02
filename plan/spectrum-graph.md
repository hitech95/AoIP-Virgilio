# Plan — Spectrum graph and heatmap

Updated: **2026-10-02**

Status: **Implemented and deployed, including inset canvas ruler, hidden
Offset row, switch active labels, and revised filter settings popover.**

The main source guest was restarted with the latest rebuilt image, including
the left dBFS ruler, revised controls, peak reset, RTA smoothing bypass,
corrected RTA Gain sensitivity, and identical opacity across curve-fill modes.
The isolated preview guest has been stopped.

Detailed verification evidence and limitations:
[spectrum-verification-2026-10-02.md](spectrum-verification-2026-10-02.md).
User-facing guide: [../docs/webui.md](../docs/webui.md).

## 1. Goal and scope

Provide an audio-engineer-oriented live EQ spectrum display with:

- Exclusive **RTA / STA / LTA** selection and independent **Peak** toggle.
- Solid RTA spectrum graph bars with optional level colors.
- Tap-colored curve fills with uniform per-frequency-column opacity.
- A fixed absolute dBFS display window, independent of the EQ gain scale.
- Explicit source, precision, smoothing, and visual tuning controls.

The level colors are visualization thresholds, not a hardware calibration claim.
No daemon changes were introduced for this visualization work.

## 2. Current design decisions

### Series, frequency geometry, and update rates

- **RTA:** one solid bar per returned frequency bucket; no client-side
  fractional-octave smoothing. Daemon temporal smoothing remains **0.45**.
- **STA / LTA:** short-/long-term averaged curves. Default time constants
  **0.8 / 8 seconds**, or **2 / 16 seconds** with High precision enabled.
- Standard / High precision select **32 / 128 buckets**. Geometry follows
  actual daemon-reported `frequencies` and `levels.length`.
- FFT size: smallest supported power of two with `sampleRate / fftSize ≤ 15 Hz`,
  clamped to 1024–8192: **4096 at 44.1/48 kHz**, **8192 at 96 kHz**.
- RTA polls/configures **50 ms**; curve modes **100 ms**, with daemon temporal
  smoothing **0.7**. Client display interpolation uses approximately **80 ms**.
- Bars use 90% of the smaller adjacent log-frequency gap. Baseline and
  bucket-center marks are drawn when the bucket count is readable (≤64).
- Current production axis starts at **10 Hz** and ends at
  **min(30 kHz, sampleRate/2)**. The original requested 20 kHz upper cap is
  **not implemented**; do not claim a fixed 10 Hz–20 kHz production domain.

### Absolute spectrum scale and ruler

- Fixed **66 dB** window; Offset 0 displays **+6…−60 dBFS**.
- Offset range **−12…+12 dB**, default 0:
  `windowTop = 6 + offset`, `windowBottom = −60 + offset`.
- Normalization: `(dBFS − windowBottom) / 66`, where **1 = loud/top** and
  **0 = floor**. Mapping is unclamped; drawing layers clamp visible geometry.
- Positive Offset moves the signal downward. No auto-ranging or moving RMS/VU
  reference cursor.
- **Inset left canvas dBFS ruler**: 0, −12, −24, −36, −48, −60 when visible.
  Out-of-window 0 is pinned with an arrow. EQ gain labels remain on the right.
  No external FFT column/padding; labels have theme-aware backing and clear
  with the spectrum. Header/frequency strips span the restored plot width.
- Only the dotted **0 dBFS** reference spans the plot; other spectrum marks
  are short ruler ticks. Theme-aware window-range label remains top-left.
- Offset tooltip explains its display-only effect. Clicking the numeric
  Offset value resets it to 0 dB.
- Chart label sizes: FFT reference 12 px; frequency / EQ gain labels 13 px.

### RTA heatmap colors, Gain, Max α, and Gate

- Heatmap **off**: tap-family bars, PRE blue / POST green.
- Heatmap **on**: whole bar receives one level color, not a vertical gradient.
- Default palette uses absolute level, independent of Offset:

  | dBFS | Color |
  |---|---|
  | −60 | Deep blue |
  | −30 | Blue |
  | −24 | Cyan |
  | −18 through −9 | Green |
  | −6 | Orange |
  | −3 | Red |
  | 0 | Deep red |

- **Latest correction:** RTA **Gain controls color sensitivity**, not opacity.
  Ramp coordinate = `clamp(absoluteColorNorm × Gain)`.
  **1.0× preserves the default palette**; higher values make quieter buckets
  reach orange/red sooner. Colors at non-default Gain therefore do not retain
  the default threshold interpretation. Gain does not change measured level,
  bar height, or peaks.
- **Max α** independently sets uniform bar opacity when heatmap is on.
- **Gain** slider is logarithmic, **0.25×…4.0×**, centered at **1.0×**.
- **Gate** is visual only: an absolute **−90…0 dBFS** threshold, default
  **−57 dBFS**, independent of Offset/Gain. It never gates audio or held peaks.
- **Contrast and Fill controls are disabled in RTA mode.**

### Curve-mode heatmap fills

- Fill belongs to the selected STA/LTA series and uses the same interpolated
  display frame as its line.
- Each pixel column has uniform color/opacity over its painted height.
  Strength interpolates on the log-frequency axis; color uses the tap family.
- Alpha chain: magnitude gain, soft-knee gate, contrast/gamma, maximum alpha.
  Defaults: **Gain 1.0×** (internal default opacity multiplier 2.5),
  **Gate −57 dBFS**, gate softness **2 dB**, **Contrast 2.8**,
  minimum alpha **0**, maximum alpha **0.95**.
- Gate suppresses weak fill within this visual gain/opacity chain, not audio.
- **Under:** curve to floor. **Above:** top to curve.
  **Background:** full-height column.
- **Latest correction:** all three modes use **identical per-column RGBA**.
  Only painted extent changes. Previous Above ×0.45 and Background ×0.60
  opacity multipliers have been removed.

### Peaks, smoothing, and lifecycle

- Peak hold **2 seconds**, decay **12 dB/s**; RTA uses raw-frame peak history,
  while STA/LTA maintain their own averaged-series envelopes.
- RTA crests survive disappearing/gated bars and decay to the viewport floor.
  They use dark amber / white outline in light mode and pale amber / dark
  outline in dark mode.
- **Reset averages resets STA/LTA and all peak envelopes/timestamps**, including
  RTA crests. Layer configs refresh immediately.
- **Curve Smoothing is disabled and bypassed in RTA mode.** Its setting is
  remembered for STA/LTA; this does not disable daemon temporal smoothing.
- Curve modes support Off / 1/12 / 1/6 / 1/3. Minimum kernel half-widths
  **1 / 2 / 4 buckets** keep modes distinct; octave labels are approximate,
  especially on coarse 32-bucket data.
- Changing smoothing reprocesses the latest raw frame and reseeds history,
  avoiding an 8–16 second LTA transition from the old smoothing shape.
- Frequency-grid, bucket-count, tap, and stop/reconnect changes reset history.
  Polls are serialized and stale-generation responses discarded.

## 3. Current UI and persistence

Section order: **Spectrum → Signal Tap → Curve Smoothing → Heatmap → Token Visuals**.

- Spectrum header contains **FFT enable** and **Reset averages**.
- RTA/STA/LTA use an **Element Plus button group**, with blue RTA/LTA and green
  STA styling, colored plain inactive states, and hover explanations.
- Peak is independent; Offset and High precision are in Spectrum.
- Offset row is currently hidden (retained in code). Peak aligns to the end
  of the series row. High precision uses Element Plus active-text, with its
  label taking the theme accent color when enabled.
- Signal Tap is disabled while FFT is off. PRE/POST use Element Plus hover/focus
  tooltips, anchored to SVG groups with tooltip components outside SVG.
- Heatmap header gear opens a settings popover beside its enable toggle.
- English and Italian labels/tooltips are present.
- Visualization persistence schema is **version 4**; version 3 gain is divided
  by 2.5 and its gate fraction converted to dBFS at Offset 0. FFT enable is deliberately
  not restored on reload; other preferences are remembered.
- WS requests use object-null form for parameterless commands. Correctly
  JSON-quoted string commands also work; earlier claims that strings were
  universally unsupported were incorrect.

## 4. Implementation and verification status

App paths are relative to
`br-external/package/webui/src/webui-app-dsp-live/htdoc/`.

| Area | Implementation / evidence |
|---|---|
| Palette and scale | `rendering/canvasLayers/palette.ts`, `ScaleReferenceLayer.ts`, chart ruler in `components/chart/EqPlotArea.vue` |
| Solid bars / independent crests | `rendering/canvasLayers/SpectrumRtaLayer.ts` |
| Uniform curve fill | `rendering/canvasLayers/SpectrumHeatmapLayer.ts` |
| Shared frame / poll lifecycle | `rendering/spectrumVizController.ts` |
| Averages / peaks / smoothing | `lib/spectrumAnalyzer.ts`, `fractionalOctaveSmoothing.ts`, `heatmapSeries.ts` |
| Controls / state | `components/viz/`, `components/HeatmapSettings.vue`, `stores/vizOptions.ts`, `lib/vizOptionsPersistence.ts`, `locale.json` |
| Regression suite | `npm run test:spectrum`; precision transitions, X/Y, silence, smoothing, peak decay/reset, color sensitivity, identical fill RGBA and complementary geometry |
| Browser verification | Full authenticated preview app with recorded real daemon-frame replay for controls/smoothing/peak reset; latest gain/fill fixes checked using actual production layers in a Chrome harness |
| Builds | Production Vite build, WebUI package rebuild, full srcqemu image build, and diff check passed |

Earlier stepped-tone verification exercised actual daemon frames at **48 kHz**
with 32/128 buckets, including repeated precision switches. **56 actual canvas
frequency-position checks passed**. This was captured-frame replay, not a new
simultaneous continuous sweep through the current playback source.

Vite build does **not** perform a full Vue typecheck. Targeted TypeScript checks
passed in prior controller/DSP reviews; do not describe this as full-project
typecheck coverage.

## 5. Deployment and remaining work

- Main WebUI: `http://192.168.1.125/#/dsp/live`.
- Main guest rebuilt and restarted with the full latest UI (filter
  settings/name/delete popover, inset canvas ruler, hidden Offset, active-text
  labels). WebUI HTTP 200, PTP locked, CamillaDSP and MPD processes confirmed
  after rebuild/restart. Served uncompressed bundle SHA-256 (verified identical
  to the staged, target, and in-image bundles):
  `ed5563043a463f38c30070712b1541bb0f17c3d82c278160500372c0dc776cc5`
  (includes the subsequent capture/playback meter color/scale fix).
- Earlier notes claiming deployment of the popover build were wrong: frontend
  packaging had silently failed (`/tmp` inode exhaustion), and the guest served
  the older bundle `6a18ba3f37a2af98f7a641f9d37da25363b04338f8697b4ee7e16fa187bdb16a`
  until the fixed rebuild above.
- Isolated preview on `127.0.0.1:18086` is stopped. It previously used a
  disconnected socket segment and loopback-only forwards, with no host audio.
- Implementation, tests, documentation and build support are split into
  focused feature commits.

Outstanding considerations:

1. Review the latest deployed UI on live content.
2. Resolve absolute amplitude calibration: daemon Hann aggregation measured
   approximately **−10.2 dBFS for a −12 dBFS generated tone**. Broadband
   calibration remains unverified.
3. FFT 4096 at 48 kHz has **11.72 Hz** base resolution; low-frequency tones can
   produce tied plateaus. More display buckets do not remove this limitation.
4. End-to-end verification at 44.1/96 kHz and target-hardware CPU measurements
   remain outstanding.
5. Requested fixed 20 kHz upper display cap remains outstanding.
6. Confirm PRE/POST capture/playback terminology for all supported routing
   configurations; these are daemon taps, not necessarily immediately adjacent
   to the selected editable EQ block.

## 6. References

- [Verification record](spectrum-verification-2026-10-02.md)
- [WebUI guide](../docs/webui.md)
- Daemon analyzer patch:
  `br-external/package/camilladsp/0002-add-built-in-fft-spectrum-analyzer.patch`
- Original CamillaEQ alpha-chain reference:
  `/home/nicolo/Documenti/Progetti/camillaeq-0.1.5`
