import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'
import vueI18n from '@intlify/unplugin-vue-i18n/vite'

const env = loadEnv('', process.cwd())

export default defineConfig({
  plugins: [
    vue(),
    viteCompression({
      deleteOriginFile: true
    }),
    vueI18n({
      compositionOnly: false
    })
  ],
  /* @vue-flow/core's dev-warn helper reads process.env.NODE_ENV in a
   * computed form (["production","prod"].includes(process.env.NODE_ENV||""))
   * that Vite's lib-mode default define does NOT replace -> bare
   * ReferenceError in the browser. Pin it explicitly. */
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    cssCodeSplit: true,
    lib: {
      formats: ['umd'],
      /* Multi-page app: build-frontend.sh sets VITE_ENTRY per page
       * (pages/<x>.vue -> view "<app>-<x>"); default single-page entry. */
      entry: env.VITE_ENTRY || 'index.vue',
      name: 'oui-com-' + env.VITE_APP_NAME,
      fileName: env.VITE_APP_NAME
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue'
        }
      }
    }
  }
})
