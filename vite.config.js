import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// VITE_BASE lets the dev server (and built bundle) live under a path prefix
// like '/w/1/' when the app is mounted behind an ingress that strips that
// prefix before forwarding. Defaults to '/' for plain local `npm run dev`.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [tailwindcss(), vue()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: true,
    host: true, // Listen on all network interfaces
    // Accept Host: headers from anywhere on the LAN (RFC-1918) plus
    // cluster-internal DNS. Set true to disable host check entirely.
    allowedHosts: true,
    // HMR over the ingress: the browser connects through the same host/port
    // it loaded the page from, under the prefix. clientPort 80 because
    // Traefik terminates on the host's :80 (mapped to :8080 by k3d).
    hmr: process.env.VITE_HMR_CLIENT_PORT
      ? { clientPort: Number(process.env.VITE_HMR_CLIENT_PORT) }
      : true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
