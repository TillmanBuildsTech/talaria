import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { serveTalariaConfig } from "./talaria-config.mjs";
import {
  isProjectsDocsPath,
  handleProjectsDocs,
  sendProjectsDocsResult,
  readJsonBody,
  projectsDocsHome,
} from "./projects-docs.mjs";
import { serveVercelKey } from "./vercel-key.mjs";
import { serveDeployDispatch } from "./deploy-dispatch.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const AUTH_USER = env.DEV_AUTH_USER || "";
  const AUTH_PASS = env.DEV_AUTH_PASS || "";

  // Minimal dev-server basic auth. Gates everything except /api, which is
  // already protected by the Hermes gateway's own Bearer key. Mirrors the
  // Hermes dashboard basic-auth pattern. Credentials come from server-side
  // .env vars (DEV_AUTH_USER / DEV_AUTH_PASS) and never reach the client.
  const devBasicAuth = () => ({
    name: "dev-basic-auth",
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (AUTH_USER && AUTH_PASS && !req.url?.startsWith("/api")) {
          const header = req.headers.authorization || "";
          const [scheme, encoded] = header.split(" ");
          let ok = false;
          if (scheme === "Basic" && encoded) {
            const decoded = Buffer.from(encoded, "base64").toString("utf8");
            const [user, pass] = decoded.split(":");
            ok = user === AUTH_USER && pass === AUTH_PASS;
          }
          if (!ok) {
            res.statusCode = 401;
            res.setHeader("WWW-Authenticate", 'Basic realm="Talaria dev"');
            res.end("Unauthorized");
            return;
          }
        }
        next();
      });
    },
  });

  // Serve the real per-profile API keys on the Vite dev server — the live
  // path the app actually uses (talaria-dev.service → Caddy). Without this,
  // GET /talaria-config falls through to Vite's SPA fallback (index.html),
  // applyServerConfig() throws on r.json() and swallows it, and no agent is
  // ever provisioned with its own key — so /p/<profile>/ chats 401 and show
  // "Tap to retry". Same payload as serve.mjs, from the shared module.
  const serveTalariaConfigDev = () => ({
    name: "serve-talaria-config",
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.method === "GET" && req.url?.split("?")[0] === "/talaria-config") {
          serveTalariaConfig(res);
          return;
        }
        next();
      });
    },
  });

  // Serve per-project docs on the Vite dev server (the live path the app
  // actually uses). The web/PWA GatewayDocsTransport calls
  // /api/v1/projects/<slug>/docs/*, which the Hermes gateway has no route for
  // and which the /api proxy would otherwise forward to it → 404 ("Creating a
  // doc doesn't work"). Intercept here and read/write the docs on this Hermes
  // host, same as serve.mjs (shared projects-docs.mjs).
  const serveProjectsDocsDev = () => ({
    name: "serve-projects-docs",
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (!isProjectsDocsPath(pathname)) {
          next();
          return;
        }
        const body = await readJsonBody(req);
        const result = await handleProjectsDocs(
          { method: req.method ?? "GET", pathname, body },
          projectsDocsHome()
        );
        if (sendProjectsDocsResult(res, result)) return;
        next();
      });
    },
  });

  // Serve the Vercel API-key store on the Vite dev server — the live path the
  // app actually uses (talaria-dev.service → Caddy). Without this,
  // GET/PUT /api/deployments/vercel-key falls through to the /api gateway
  // proxy (which 404s it) and the deployments tab can't save/read the default
  // key. Same handlers as serve.mjs, from the shared module.
  const serveVercelKeyDev = () => ({
    name: "serve-vercel-key",
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === "/api/deployments/vercel-key") {
          void serveVercelKey(req, res);
          return;
        }
        next();
      });
    },
  });

  // Server-side GitHub proxy for the Vite dev server — mirrors serve.mjs's
  // githubProxyFactory. The dev server proxies /api to the gateway (localhost:8642),
  // so the dispatch path calls the gateway's github proxy directly with the
  // browser's Authorization header. The stored Vercel key never reaches the browser.
  const gatewayOrigin = "http://localhost:8642";
  const githubProxyDev = (authHeader: string | undefined) => async ({
    method,
    path,
    body,
  }: {
    method: string;
    path: string;
    body?: unknown;
  }) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authHeader) headers.Authorization = authHeader;
    const res = await fetch(`${gatewayOrigin}/api/v1/github/proxy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method, path, body: body ?? {} }),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  };

  // Serve the deployment dispatch on the Vite dev server — the server-side path
  // that reads the stored Vercel key and injects it into workflow_dispatch
  // inputs (only when the workflow declares a vercel_token input).
  const serveDeployDispatchDev = () => ({
    name: "serve-deploy-dispatch",
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === "/api/deployments/dispatch") {
          if (req.method === "OPTIONS") {
            res.writeHead(204).end();
            return;
          }
          if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "method not allowed" }));
            return;
          }
          void serveDeployDispatch(req, res, {
            githubProxy: githubProxyDev(req.headers.authorization),
          });
          return;
        }
        next();
      });
    },
  });

  return {
    define: {
      __HERMES_API_KEY__: JSON.stringify(env.HERMES_API_KEY || process.env.HERMES_API_KEY || ""),
    },
    plugins: [
      serveTalariaConfigDev(),
      serveProjectsDocsDev(),
      serveVercelKeyDev(),
      serveDeployDispatchDev(),
      devBasicAuth(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "apple-touch-icon.png"],
        manifest: {
          name: "Talaria",
          short_name: "Talaria",
          description: "Talk to every Hermes profile as a contact — DM, group, and @mention your agents",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /\/api\/v1\/.*$/,
              handler: "NetworkOnly",
            },
          ],
        },
      }),
    ],
    server: {
      // Vite 6 host-allowlist (DNS-rebinding protection). Allow the tailnet
      // MagicDNS hostname used to reach this dev server from the phone.
      allowedHosts: ["hermes.tailb04d0e.ts.net"],
      proxy: {
        // The app builds gateway paths under an origin/bare root: chat /v1/*,
        // multiplex /p/<profile>/*, sessions /api/*. Forward all three to the
        // gateway verbatim, stripping browser Origin/Referer (gateway 403s on
        // them) and forwarding Authorization.
        "/v1": { target: "http://localhost:8642", changeOrigin: true, configure: (p) => p.on("proxyReq", stripBrowserHeaders) },
        "/p": { target: "http://localhost:8642", changeOrigin: true, configure: (p) => p.on("proxyReq", stripBrowserHeaders) },
        "/api": { target: "http://localhost:8642", changeOrigin: true, configure: (p) => p.on("proxyReq", stripBrowserHeaders) },
        // Kanban bridge → serve.mjs (NOT the gateway; the gateway 404s on
        // /kanban-api). serve.mjs reads the per-project board SQLite directly.
        // Without this entry the Vite dev server answers /kanban-api with SPA
        // HTML / 404 and the Command Center loads no tasks.
        "/kanban-api": { target: "http://localhost:8643", changeOrigin: true },
      },
    },
  };
});

function stripBrowserHeaders(proxyReq: { setHeader: (k: string, v: string) => void; removeHeader: (k: string) => void }, req: IncomingMessage) {
  if (req.headers.authorization) {
    proxyReq.setHeader("authorization", req.headers.authorization);
  }
  proxyReq.removeHeader("origin");
  proxyReq.removeHeader("referer");
}
