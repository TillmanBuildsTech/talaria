# Talaria — build the shared UI package + PWA host, then run serve.mjs
# (static + gateway proxy). Build context is the repo root (pnpm workspace).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/talaria-ui/package.json packages/talaria-ui/package.json
COPY apps/pwa/package.json apps/pwa/package.json
RUN pnpm install --frozen-lockfile
COPY packages/talaria-ui packages/talaria-ui
COPY apps/pwa apps/pwa
RUN pnpm --filter @talaria/ui build
RUN pnpm --filter @talaria/pwa build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/pwa/dist ./dist
COPY --from=build /app/apps/pwa/serve.mjs ./serve.mjs
COPY --from=build /app/apps/pwa/talaria-config.mjs ./talaria-config.mjs
COPY --from=build /app/apps/pwa/vercel-key.mjs ./vercel-key.mjs
COPY --from=build /app/apps/pwa/deploy-dispatch.mjs ./deploy-dispatch.mjs
COPY --from=build /app/apps/pwa/package.json ./
ENV PORT=8765
EXPOSE 8765
CMD ["node", "serve.mjs"]
