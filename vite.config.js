import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// App version is read from package.json at config time and injected as the
// compile-time constant __APP_VERSION__ (consumed by src/version.js).
//
// Only the client's OWN build SHA is baked here — it *is* the client build.
// The server/worker/control/meta SHAs are reported at runtime by the backend's
// /api/v1/common/version endpoint (see composables/useVersionLabel.js), not
// baked into the shell.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
const appBuildMeta = {
  clientSha: process.env.VITE_APP_CLIENT_SHA || '',
  buildTime: process.env.VITE_APP_BUILD_TIME || '',
}

// VITE_BASE lets the dev server (and built bundle) live under a path prefix
// like '/w/1/' when the app is mounted behind an ingress that strips that
// prefix before forwarding. Defaults to '/' for plain local `npm run dev`.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_META__: JSON.stringify(appBuildMeta),
  },
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
