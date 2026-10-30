import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/preload/overlay.ts'),
          toolbox: resolve('src/preload/toolbox.ts')
        }
      }
    }
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/renderer/overlay.html'),
          toolbox: resolve('src/renderer/toolbox.html')
        }
      }
    }
  }
})
