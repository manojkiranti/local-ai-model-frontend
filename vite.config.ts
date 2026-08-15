/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The gateway (FastAPI) runs on :8000. Proxying /v1 and /health through Vite in
// dev keeps requests same-origin, so the backend needs no CORS changes.
const GATEWAY = process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/v1': { target: GATEWAY, changeOrigin: true },
      '/health': { target: GATEWAY, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
