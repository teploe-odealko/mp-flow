FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Build client + server + plugins ──────────
FROM deps AS builder
COPY . .
RUN npm run build:client
RUN npm run build:server

# ── Production ────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/src/server/index.js"]
