import assert from 'node:assert/strict'
import { SpectrumAnalyzer } from '../lib/spectrumAnalyzer'
import { getEffectiveSmoothing } from '../lib/heatmapSeries'
import { smoothDbBins } from '../lib/fractionalOctaveSmoothing'
import { toDisplayNorm, clamp01, displayNormToColorNorm, BAR_RAMP, sampleRamp, heatmapAlpha, DEFAULT_HEATMAP_ALPHA_TUNING } from '../rendering/canvasLayers/palette'
import { SpectrumAnalyzerLayer } from '../rendering/canvasLayers/SpectrumAnalyzerLayer'
import { SpectrumRtaLayer } from '../rendering/canvasLayers/SpectrumRtaLayer'
import { SpectrumHeatmapLayer } from '../rendering/canvasLayers/SpectrumHeatmapLayer'
import { ScaleReferenceLayer } from '../rendering/canvasLayers/ScaleReferenceLayer'
import { freqToLogX, binAtXWithFreqs } from '../rendering/canvasLayers/freqAxis'
import { loadVizOptions, saveVizOptions } from '../lib/vizOptionsPersistence'

// Real failure: retained 32-bin averages were interpreted on the 128-bin
// frequency grid, and new bins became NaN. Exercise switches both ways.
const analyzer = new SpectrumAnalyzer()
let now = 1000
for (const count of [32, 128, 32, 128]) {
  const frequencies = Array.from({ length: count }, (_, i) => 12 * (24000 / 12) ** (i / count))
  const frame = frequencies.map(f => -20 - 60 * Math.min(1, Math.abs(Math.log2(f / 1000))))
  analyzer.update(frame, now += 100)
  const state = analyzer.getState()
  for (const key of ['staDb', 'ltaDb', 'peakDb', 'peakStaDb', 'peakLtaDb'] as const) {
    assert.deepEqual(state[key], frame, `${key} must reseed on ${count}-bin switch`)
  }
  const layer = new SpectrumAnalyzerLayer({ showSTA: true, showLTA: true })
  layer.setSeries({ staNorm: state.staDb!.map(db => toDisplayNorm(db, 0)), ltaNorm: state.ltaDb!.map(db => toDisplayNorm(db, 0)) })
  const paths: number[][][] = []
  let path: number[][] = []
  const context = {
    beginPath() { path = []; paths.push(path) },
    moveTo(x: number, y: number) { path.push([x, y]) },
    lineTo(x: number, y: number) { path.push([x, y]) },
    setLineDash() {}, stroke() {},
  } as unknown as CanvasRenderingContext2D
  const axis = { minHz: 10, maxHz: 24000, nyquistHz: 24000 }
  layer.render({ ctx: context, width: 1000, height: 400, binsNormalized: [], mode: 'pre', freqAxis: axis, binFreqs: frequencies })
  for (const line of paths) {
    assert.equal(line.length, count)
    assert(line.flat().every(Number.isFinite), 'every rendered coordinate must be finite')
    const peak = line.reduce((a, b) => b[1] < a[1] ? b : a)
    const index = frame.indexOf(Math.max(...frame))
    assert.equal(peak[0], freqToLogX(frequencies[index], 1000, axis))
  }
  for (let i = 0; i < count; i++) {
    assert(Math.abs(binAtXWithFreqs(freqToLogX(frequencies[i], 1000, axis), frequencies, 1000, axis) - i) < 1e-9)
  }
}
analyzer.reset()
analyzer.update(Array(128).fill(-150), now += 100)
assert(analyzer.getState().staDb!.every(db => clamp01(toDisplayNorm(db, 0)) === 0))
for (const offset of [-12, 0, 12]) {
  assert(toDisplayNorm(-20, offset) > toDisplayNorm(-50, offset), 'louder always draws taller')
  assert.equal(clamp01(toDisplayNorm(-150, offset)), 0, 'silence must be invisible')
  assert(Math.abs(displayNormToColorNorm(toDisplayNorm(-3, offset), offset) - 0.95) < 1e-12, 'red threshold must stay at −3 dBFS for every offset')
}
for (const count of [32, 128]) {
  const input = Array(count).fill(-150)
  input[Math.floor(count / 2)] = -12
  const outputs = ['1/12', '1/6', '1/3'].map(mode => {
    const effective = getEffectiveSmoothing(mode as '1/12' | '1/6' | '1/3', true)
    assert.equal(effective, mode, 'high precision must respect smoothing')
    return smoothDbBins(input, effective)
  })
  assert.equal(new Set(outputs.map(frame => Math.max(...frame))).size, 3)
  assert(outputs.flat().every(Number.isFinite))
}
// A disappearing live bar must not take its held peak with it. Exercise the
// real analyzer hold/decay and the renderer all the way to the plot floor.
const peakAnalyzer = new SpectrumAnalyzer()
peakAnalyzer.update([-18], 0)
const bars = new SpectrumRtaLayer({ enabled: true, showPeak: true })
let rectangles: number[][] = []
const barContext = {
  fillRect(...rectangle: number[]) { rectangles.push(rectangle) },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
} as unknown as CanvasRenderingContext2D
let previousY = -Infinity
let sawBelowGate = false
let disappeared = false
for (let time = 100; time <= 6500; time += 100) {
  peakAnalyzer.update([-150], time)
  const peakDb = peakAnalyzer.getState().peakDb![0]
  if (time <= 2000) assert.equal(peakDb, -18, 'peak survives silence throughout hold')
  bars.setConfig({ peakSeries: [toDisplayNorm(peakDb, 0)] })
  rectangles = []
  bars.render({ ctx: barContext, width: 100, height: 400, binsNormalized: [toDisplayNorm(-150, 0)], mode: 'pre' })
  if (peakDb > -60) {
    assert.equal(rectangles.length, 2, 'outlined crest remains after bar disappears')
    const y = rectangles[1][1]
    assert(y >= previousY, 'peak falls monotonically toward zero height')
    previousY = y
    if (toDisplayNorm(peakDb, 0) < 0.05) sawBelowGate = true
  } else {
    assert.equal(rectangles.length, 0, 'peak disappears at the floor')
    disappeared = true
  }
}
assert(sawBelowGate && disappeared)
peakAnalyzer.resetAverages()
assert.deepEqual(peakAnalyzer.getState().peakDb, [-150], 'reset removes held RTA peaks on silence')
assert.deepEqual(peakAnalyzer.getState().peakStaDb, [-150], 'reset removes averaged peak history')
const opacityStyles: string[] = []
const opacityContext = {
  ...barContext,
  fillStyle: '',
  fillRect() { opacityStyles.push(this.fillStyle) },
} as unknown as CanvasRenderingContext2D
bars.setConfig({ showPeak: false, heatmapActive: true })
for (const [gain, maxAlpha] of [[0.5, 0.95], [1, 0.95], [1, 0.2]]) {
  bars.setConfig({ tuning: { magnitudeGain: gain, maxAlpha, gateThreshold: -90, gateSoftness: 0, alphaGamma: 4, minAlpha: 0 } })
  bars.render({ ctx: opacityContext, width: 100, height: 400, binsNormalized: [0.5], mode: 'pre' })
}
assert.equal(new Set(opacityStyles).size, 3, 'RTA gain changes hue and max alpha changes opacity')
opacityStyles.length = 0
for (const gain of [1, 1.6]) {
  bars.setConfig({ tuning: { magnitudeGain: gain, maxAlpha: 0.8, gateThreshold: -90, gateSoftness: 0, alphaGamma: 4, minAlpha: 0 } })
  bars.render({ ctx: opacityContext, width: 100, height: 400, binsNormalized: [toDisplayNorm(-18, 0)], mode: 'pre' })
}
const rgb = opacityStyles.map(style => style.match(/[\d.]+/g)!.map(Number))
assert(rgb[0][1] > rgb[0][0], 'default sensitivity preserves green at −18 dBFS')
assert(rgb[1][0] > 3 * rgb[1][1], 'higher sensitivity makes the same −18 dBFS bar red')
assert.equal(rgb[0][3], rgb[1][3], 'color gain must not change opacity')
for (const offset of [-12, 0, 12]) {
  const tuning = { ...DEFAULT_HEATMAP_ALPHA_TUNING, gateThreshold: -45 }
  assert.equal(heatmapAlpha(toDisplayNorm(-50, offset), tuning, offset), 0, 'absolute gate rejects the same level at every offset')
  assert(heatmapAlpha(toDisplayNorm(-40, offset), tuning, offset) > 0, 'absolute gate passes the same level at every offset')
  bars.setConfig({ offsetDb: offset, tuning, showPeak: false })
  opacityStyles.length = 0
  bars.render({ctx:opacityContext,width:100,height:400,binsNormalized:[toDisplayNorm(-50,offset)],mode:'pre'})
  assert.equal(opacityStyles.length, 0, 'RTA gate must not move with offset')
}
const fillStyles: string[][] = []
const fillRects: number[][][] = []
const fillLayer = new SpectrumHeatmapLayer({ enabled: true })
for (const fillMode of ['under', 'above', 'background'] as const) {
  const styles: string[] = [], rects: number[][] = []
  const ctx = { fillStyle: '', fillRect(...rect: number[]) { styles.push(this.fillStyle); rects.push(rect) } } as unknown as CanvasRenderingContext2D
  fillLayer.setConfig({ fillMode })
  fillLayer.render({ ctx, width: 4, height: 400, binsNormalized: [0.2, 0.5, 0.8], mode: 'pre' })
  fillStyles.push(styles); fillRects.push(rects)
}
assert.deepEqual(fillStyles[0], fillStyles[1], 'above and under must use identical per-column RGBA')
assert.deepEqual(fillStyles[0], fillStyles[2], 'background and under must use identical per-column RGBA')
for (let x = 0; x < 4; x++) {
  assert.equal(fillRects[0][x][3] + fillRects[1][x][3], 400, 'above/under are complementary extents')
  assert.equal(fillRects[2][x][3], 400)
}
for (const offset of [-12, 0, 12]) {
  for (const db of [-24, -18, -12, -9]) {
    const [r, g] = sampleRamp(BAR_RAMP, displayNormToColorNorm(toDisplayNorm(db, offset), offset))
    assert(g > r, `${db} dBFS stays cyan/green, not yellow/orange`)
  }
  const [r, g, b] = sampleRamp(BAR_RAMP, displayNormToColorNorm(toDisplayNorm(-3, offset), offset))
  assert(r > 3 * g && r > 3 * b, 'red stays near clipping')
}
let stored = JSON.stringify({version:3,heatmapMagnitudeGain:2.5,heatmapGateThreshold:0.05,spectrumSeries:'lta'})
for (const offset of [-12, 0, 12]) {
  const labels: {text:string,x:number,y:number}[] = []
  const ctx = {
    save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},fillRect(){},
    measureText(text:string){return {width:text.length*7}},
    fillText(text:string,x:number,y:number){labels.push({text,x,y})},
  } as unknown as CanvasRenderingContext2D
  new ScaleReferenceLayer({scaleDb:offset}).render({ctx,width:800,height:400,binsNormalized:[],mode:'pre'})
  assert(labels.every(l=>l.x>=0&&l.x<80&&l.y>=0&&l.y<=400),'all FFT labels stay inside the left canvas edge')
  assert(labels.some(l=>l.text.startsWith('0 dBFS')))
  assert.equal(labels.some(l=>l.text==='-60'),offset!==12)
}
;(globalThis as any).localStorage = {getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value}}
const migrated = loadVizOptions()
assert.equal(migrated.heatmapMagnitudeGain,1)
assert(Math.abs(migrated.heatmapGateThreshold + 56.7)<1e-9)
assert.equal(migrated.spectrumSeries,'lta','migration preserves other preferences')
saveVizOptions(migrated)
assert.equal(JSON.parse(stored).version,4)
console.log('Spectrum regression checks passed: precision, X/Y, silence, smoothing, peak decay/reset, color gain, absolute gate, fill opacity, persistence migration')
