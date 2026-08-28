import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const AUTH_USER = env.DEV_AUTH_USER || ''
  const AUTH_PASS = env.DEV_AUTH_PASS || ''

  // Minimal dev-server basic auth. Gates everything except /api, which is
  // already protected by the Hermes gateway's own Bearer key. Mirrors the
  // Hermes dashboard basic-auth pattern. Credentials come from server-side
  // .env vars (DEV_AUTH_USER / DEV_AUTH_PASS) and never reach the client.
  const devBasicAuth = () => ({
    name: 'dev-basic-auth',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (AUTH_USER && AUTH_PASS && !req.url.startsWith('/api')) {
          const header = req.headers.authorization || ''
          const [scheme, encoded] = header.split(' ')
          let ok = false
          if (scheme === 'Basic' && encoded) {
            const decoded = Buffer.from(encoded, 'base64').toString('utf8')
            const [user, pass] = decoded.split(':')
            ok = user === AUTH_USER && pass === AUTH_PASS
          }
          if (!ok) {
            res.statusCode = 401
            res.setHeader('WWW-Authenticate', 'Basic realm="Talaria dev"')
            res.end('Unauthorized')
            return
          }
        }
        next()
      })
    }
  })

  return {
    define: {
      __HERMES_API_KEY__: JSON.stringify(env.HERMES_API_KEY || process.env.HERMES_API_KEY || '')
    },
    plugins: [
      devBasicAuth(),
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
      // Vite 6 host-allowlist (DNS-rebinding protection). Allow the tailnet
      // MagicDNS hostname used to reach this dev server from the phone.
      allowedHosts: ['hermes.tailb04d0e.ts.net'],
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
  }
})

function stripBrowserHeaders(proxyReq, req) {
  if (req.headers['authorization']) {
    proxyReq.setHeader('authorization', req.headers['authorization'])
  }
  proxyReq.removeHeader('origin')
  proxyReq.removeHeader('referer')
}
