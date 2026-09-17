/*
 * Biquad magnitude response math (RBJ Audio EQ Cookbook), ported from
 * camillaEQ's client/src/dsp/filterResponse.ts (MIT, AlfredJKwack) --
 * trimmed to the uci filter types the protected pipeline exposes in
 * editable slots: peak, low/high shelf, notch, allpass, gain.
 * Conv (FIR) and delay are not drawn (flat informational lines).
 */

const LOG2 = Math.log(2)

export function biquadCoeffs(type, f, gainDb, q, fs) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = 2 * Math.PI * f / fs
  const cw = Math.cos(w0), sw = Math.sin(w0)
  const alpha = sw / (2 * (q || 0.707))

  let b0, b1, b2, a0, a1, a2

  switch (type) {
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
      break
    case 'ls':  /* low shelf */
      b0 = A * ((A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * alpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cw)
      b2 = A * ((A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * alpha
      a1 = -2 * ((A - 1) + (A + 1) * cw)
      a2 = (A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * alpha
      break
    case 'hs':  /* high shelf */
      b0 = A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * alpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cw)
      b2 = A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * alpha
      a1 = 2 * ((A - 1) - (A + 1) * cw)
      a2 = (A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * alpha
      break
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    case 'ap':
      b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
      break
    default:
      return null
  }
  return [b0 / a0, b1 / a0, b2 / a0, a0 / a0, a1 / a0, a2 / a0]
}

/* magnitude in dB of one biquad at frequency f */
export function biquadMagDb(coeffs, f, fs) {
  const [b0, b1, b2, a0, a1, a2] = coeffs
  const w = 2 * Math.PI * f / fs
  const c = Math.cos(w), s = Math.sin(w)
  const c2 = 2 * c * c - 1        /* cos(2w) */
  const s2 = 2 * s * c            /* sin(2w) */
  const nre = b0 + b1 * c + b2 * c2, nim = -(b1 * s + b2 * s2)
  const dre = a0 + a1 * c + a2 * c2, dim = -(a1 * s + a2 * s2)
  return 10 * Math.log10((nre * nre + nim * nim) / (dre * dre + dim * dim))
}

/*
 * Cascade response over a log frequency grid.
 * filters: [{type, f, gain, q, ...}] (uci params; strings from uci!)
 * Returns { freqs: [...], totalDb: [...] } or null when nothing plottable.
 */
export function cascadeResponse(filters, fs, points = 240) {
  const fmin = 20, fmax = Math.min(20000, fs / 2 - 1)
  const freqs = []
  for (let i = 0; i < points; i++)
    freqs.push(fmin * Math.pow(fmax / fmin, i / (points - 1)))

  let total = null
  for (const f of filters) {
    const type = String(f.type)
    const fq = parseFloat(f.f), g = parseFloat(f.gain ?? 0), q = parseFloat(f.q)

    if (type === 'gain') {
      const gdb = parseFloat(f.gain ?? 0)
      if (isNaN(gdb)) continue
      total = total ?? new Array(points).fill(0)
      for (let i = 0; i < points; i++) total[i] += gdb
      continue
    }
    if (type !== 'peak' && type !== 'ls' && type !== 'hs' &&
        type !== 'notch' && type !== 'ap')
      continue
    if (isNaN(fq) || fq <= 0) continue

    const coeffs = biquadCoeffs(type, fq, isNaN(g) ? 0 : g, q, fs)
    if (!coeffs) continue
    total = total ?? new Array(points).fill(0)
    for (let i = 0; i < points; i++)
      total[i] += biquadMagDb(coeffs, freqs[i], fs)
  }
  if (!total) return null
  return { freqs, totalDb: total }
}
