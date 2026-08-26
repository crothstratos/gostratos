# Stratos VP CRM — Cloud Run image
# Build stage: install everything, run vite build + esbuild server bundle.
# Client-side VITE_* values come from .env.production (committed; these are
# public-by-design values, not secrets). Server-side secrets are injected at
# runtime by Cloud Run and are never present at build time.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: production dependencies only
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Cloud Run injects PORT; server.ts reads it.
CMD ["node", "dist/server.cjs"]
