/**
 * Spectrum Analyzer
 * Implements STA/LTA averaging and Peak Hold in dB domain
 * All operations are O(N) per frame
 * (ported from CamillaEQ src/dsp/spectrumAnalyzer.ts)
 */

export interface AnalyzerState {
  liveDb: number[]
  staDb: number[] | null
  ltaDb: number[] | null
  peakDb: number[] | null
  peakLastHitMs: number[] | null
  /** peak envelopes of the averaged series (the RTA crest can ride the
   * SELECTED series, not only the raw frame) */
  peakStaDb: number[] | null
  peakLtaDb: number[] | null
  peakStaLastHitMs: number[] | null
  peakLtaLastHitMs: number[] | null
  lastUpdateMs: number
  initialized: boolean
}

export interface AnalyzerConfig {
  tauShort: number // STA time constant (seconds), default 0.8
  tauLong: number // LTA time constant (seconds), default 8.0
  holdTimeMs: number // Peak hold time (milliseconds), default 2000
  decayRateDbPerSec: number // Peak decay rate (dB/s), default 12
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  tauShort: 0.8,
  tauLong: 8.0,
  holdTimeMs: 2000,
  decayRateDbPerSec: 12,
}

export class SpectrumAnalyzer {
  private state: AnalyzerState
  private config: AnalyzerConfig
  private latestPeakFrame: number[] = []

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      liveDb: [],
      staDb: null,
      ltaDb: null,
      peakDb: null,
      peakLastHitMs: null,
      peakStaDb: null,
      peakLtaDb: null,
      peakStaLastHitMs: null,
      peakLtaLastHitMs: null,
      lastUpdateMs: 0,
      initialized: false,
    }
  }

  /**
   * Update analyzer with new spectrum frame.
   *
   * @param liveDbFrame smoothed frame driving STA/LTA (smoothing steadies
   *        the averages)
   * @param peakFrame optional UNsmoothed frame for the peak hold: peaks
   *        are transient by nature and smoothing would shave them off,
   *        making the hold look slow and flat. Defaults to liveDbFrame.
   */
  update(liveDbFrame: number[], nowMs: number, peakFrame?: number[]): void {
    const numBins = liveDbFrame.length
    const peaks = peakFrame ?? liveDbFrame
    this.latestPeakFrame = [...peaks]

    // Bin indices change meaning when precision changes. Reseed averages
    // and every peak/timestamp buffer together instead of mixing grids.
    if (!this.state.initialized || this.state.liveDb.length !== numBins) {
      this.state.liveDb = [...liveDbFrame]
      this.state.staDb = [...liveDbFrame]
      this.state.ltaDb = [...liveDbFrame]
      this.state.peakDb = [...peaks]
      this.state.peakStaDb = [...liveDbFrame]
      this.state.peakLtaDb = [...liveDbFrame]
      this.state.peakLastHitMs = Array(numBins).fill(nowMs)
      this.state.peakStaLastHitMs = Array(numBins).fill(nowMs)
      this.state.peakLtaLastHitMs = Array(numBins).fill(nowMs)
      this.state.lastUpdateMs = nowMs
      this.state.initialized = true
      return
    }

    // Calculate dt and clamp to prevent stale-frame jumps
    let dtMs = nowMs - this.state.lastUpdateMs
    dtMs = Math.max(0, Math.min(150, dtMs))
    const dtSec = dtMs / 1000

    this.state.liveDb = [...liveDbFrame]

    // Update STA (short-term average) - EMA in dB domain
    const alphaShort = Math.exp(-dtSec / this.config.tauShort)
    for (let i = 0; i < numBins; i++) {
      this.state.staDb![i] = alphaShort * this.state.staDb![i] + (1 - alphaShort) * liveDbFrame[i]
    }

    // Update LTA (long-term average) - EMA in dB domain
    const alphaLong = Math.exp(-dtSec / this.config.tauLong)
    for (let i = 0; i < numBins; i++) {
      this.state.ltaDb![i] = alphaLong * this.state.ltaDb![i] + (1 - alphaLong) * liveDbFrame[i]
    }

    // Update Peak Hold - per-bin max with hold and decay, fed by the raw
    // (unsmoothed) frame so real transients register; the averaged series
    // keep their own envelopes (the crest rides the SELECTED series)
    this.applyPeak(this.state.peakDb!, this.state.peakLastHitMs!, peaks, nowMs, dtSec)
    this.applyPeak(this.state.peakStaDb!, this.state.peakStaLastHitMs!, this.state.staDb!, nowMs, dtSec)
    this.applyPeak(this.state.peakLtaDb!, this.state.peakLtaLastHitMs!, this.state.ltaDb!, nowMs, dtSec)

    this.state.lastUpdateMs = nowMs
  }

  /**
   * Per-bin peak hold with hold-time and decay over one series.
   */
  private applyPeak(
    peakDb: number[],
    lastHitMs: number[],
    values: number[],
    nowMs: number,
    dtSec: number
  ): void {
    for (let i = 0; i < values.length; i++) {
      const currentPeak = peakDb[i]
      const v = values[i]

      if (v >= currentPeak) {
        peakDb[i] = v
        lastHitMs[i] = nowMs
      } else {
        const timeSinceHit = nowMs - lastHitMs[i]
        if (timeSinceHit > this.config.holdTimeMs) {
          const decayDb = this.config.decayRateDbPerSec * dtSec
          peakDb[i] = Math.max(v, currentPeak - decayDb)
        }
      }
    }
  }

  /**
   * Reset averages and every peak envelope to the current frame.
   */
  resetAverages(): void {
    if (this.state.initialized) {
      this.state.staDb = [...this.state.liveDb]
      this.state.ltaDb = [...this.state.liveDb]
      this.state.peakDb = [...this.latestPeakFrame]
      this.state.peakStaDb = [...this.state.liveDb]
      this.state.peakLtaDb = [...this.state.liveDb]
      const hits = Array(this.state.liveDb.length).fill(this.state.lastUpdateMs)
      this.state.peakLastHitMs = [...hits]
      this.state.peakStaLastHitMs = [...hits]
      this.state.peakLtaLastHitMs = [...hits]
    }
  }

  /** Invalidate history when the source or frequency grid changes. */
  reset(): void {
    this.state.initialized = false
    this.latestPeakFrame = []
    this.state.liveDb = []
    this.state.staDb = null
    this.state.ltaDb = null
    this.state.peakDb = null
    this.state.peakStaDb = null
    this.state.peakLtaDb = null
    this.state.peakLastHitMs = null
    this.state.peakStaLastHitMs = null
    this.state.peakLtaLastHitMs = null
    this.state.lastUpdateMs = 0
  }

  getState(): Readonly<AnalyzerState> {
    return this.state
  }

  updateConfig(config: Partial<AnalyzerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): Readonly<AnalyzerConfig> {
    return this.config
  }
}
