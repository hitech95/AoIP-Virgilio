/* live camilladsp filter definition -> uci filter object (inverse of
 * the genconf vocabulary; only types the UIs can create) */
export function liveDefToUci(def: any): Record<string, any> | null {
  if (!def) return null
  const p = def.parameters ?? {}
  switch (def.type) {
    case 'Gain':
      return { type: 'gain', gain: p.gain, ...(p.inverted ? { inverted: '1' } : {}), ...(p.mute ? { mute: '1' } : {}) }
    case 'Volume':
      return { type: 'volume', fader: p.fader, ...(p.ramp_time != null ? { ramp_time: p.ramp_time } : {}), ...(p.limit != null ? { limit: p.limit } : {}) }
    case 'Conv':
      return { type: 'conv', filename: p.filename }
    case 'Limiter':
      return { type: 'limiter', clip_limit: p.clip_limit }
    case 'BiquadCombo':
      return { type: p.type.startsWith('LinkwitzRileyHigh') ? 'lrhp' : 'lrlp', f: p.freq, order: p.order }
    case 'Biquad': {
      const base = { Peaking: 'peak', Highshelf: 'hs', Lowshelf: 'ls', Highpass: 'hp',
        Lowpass: 'lp', Bandpass: 'bp', Notch: 'notch', Allpass: 'ap' }[p.type as string]
      if (!base) return null
      if (base === 'peak' || base === 'hs' || base === 'ls')
        return { type: base, f: p.freq, gain: p.gain, ...(p.slope != null ? { slope: p.slope } : (p.q != null ? { q: p.q } : {})) }
      return { type: base, f: p.freq, q: p.q }
    }
    default:
      return null
  }
}

/** dB <-> linear (uci/live mixer route gains are LINEAR) */
export const dbToLinear = (db: number): number => Math.pow(10, db / 20)
export const linearToDb = (lin: number): number => 20 * Math.log10(Math.max(1e-6, lin))
