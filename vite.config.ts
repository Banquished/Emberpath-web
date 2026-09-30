import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/nutrition/v1': {
        target: process.env.NUTRITION_SERVICE_URL || 'http://127.0.0.1:8001',
        rewrite: (path) => path.replace(/^\/api\/nutrition\/v1(?=\/|$)/, '/api/v1'),
      },
      '/api': {
        target: process.env.WEIGHT_SERVICE_URL || 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
