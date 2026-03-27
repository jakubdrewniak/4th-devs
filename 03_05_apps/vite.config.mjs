import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(process.cwd(), 'ui'),
  plugins: [tailwindcss(), viteSingleFile()],
  build: {
    outDir: resolve(process.cwd(), 'dist/ui'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'ui/index.html'),
    },
  },
})
