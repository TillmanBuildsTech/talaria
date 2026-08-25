# Talaria — build the Vue PWA, then run serve.mjs (static + gateway proxy)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/serve.mjs ./serve.mjs
COPY --from=build /app/package.json ./
ENV PORT=8765
EXPOSE 8765
CMD ["node", "serve.mjs"]
