import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser only ever talks to our own server; /api is proxied to Express in dev.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { chunkSizeWarningLimit: 2000 },
})
