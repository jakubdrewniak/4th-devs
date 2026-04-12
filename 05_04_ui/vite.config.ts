/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000'

  return {
    plugins: [tailwindcss(), svelte()],
    server: {
      port: 5173,
      proxy: {
        '/v1': backendOrigin,
      },
    },
    test: {
      globals: false,
      environment: 'node',
      include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
      setupFiles: ['./src/test-preload.ts'],
      restoreMocks: true,
    },
  }
})
