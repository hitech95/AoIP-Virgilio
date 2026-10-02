import { build } from 'esbuild'
const result = await build({
  entryPoints: [new URL('./spectrum-regression.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
})
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
