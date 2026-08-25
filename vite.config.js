import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  define: {
    __HERMES_API_KEY__: JSON.stringify(process.env.HERMES_API_KEY || '')
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Talaria',
        short_name: 'Talaria',
        description: 'Talk to every Hermes profile as a contact — DM, group, and @mention your agents',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/.*$/,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  server: {
    proxy: {
      // The app builds gateway paths under an origin/bare root: chat /v1/*,
      // multiplex /p/<profile>/*, sessions /api/*. Forward all three to the
      // gateway verbatim, stripping browser Origin/Referer (gateway 403s on
      // them) and forwarding Authorization.
      '/v1': { target: 'http://localhost:8642', changeOrigin: true, configure: (p) => p.on('proxyReq', stripBrowserHeaders) },
      '/p': { target: 'http://localhost:8642', changeOrigin: true, configure: (p) => p.on('proxyReq', stripBrowserHeaders) },
      '/api': { target: 'http://localhost:8642', changeOrigin: true, configure: (p) => p.on('proxyReq', stripBrowserHeaders) }
    }
  }
})

function stripBrowserHeaders(proxyReq, req) {
  if (req.headers['authorization']) {
    proxyReq.setHeader('authorization', req.headers['authorization'])
  }
  proxyReq.removeHeader('origin')
  proxyReq.removeHeader('referer')
}
