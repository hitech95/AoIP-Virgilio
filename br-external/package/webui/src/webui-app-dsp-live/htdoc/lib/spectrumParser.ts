/**
 * Spectrum data parser (strict dB-domain)
 * Parses CamillaDSP spectrum data in dBFS format
 * (ported from CamillaEQ src/dsp/spectrumParser.ts)
 */

export interface SpectrumData {
  binsDb: number[] // Spectrum data in dB domain (dBFS: 0 dB = full scale)
}

/**
 * Parse spectrum data from WebSocket response
 * Expects spectrum in dBFS (negative values, 0 dB max)
 */
export function parseSpectrumData(value: unknown): SpectrumData | null {
  if (!Array.isArray(value)) {
    return null
  }

  // Require at least 3 values (reject legacy 2-channel format)
  if (value.length < 3) {
    return null
  }

  if (!value.every((v) => typeof v === 'number' && !isNaN(v))) {
    return null
  }

  return { binsDb: value as number[] }
}

/**
 * Convert dB to normalized [0..1] for rendering
 */
export function dbToNormalized(db: number, minDb: number = -100, maxDb: number = 0): number {
  const clamped = Math.max(minDb, Math.min(maxDb, db))
  return (clamped - minDb) / (maxDb - minDb)
}

/**
 * Convert array of dB values to normalized [0..1] for rendering
 */
export function dbArrayToNormalized(binsDb: number[], minDb: number = -100, maxDb: number = 0): number[] {
  return binsDb.map((db) => dbToNormalized(db, minDb, maxDb))
}
