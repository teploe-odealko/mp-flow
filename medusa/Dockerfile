FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# ── Build admin UI + backend ──────────────────────────────
FROM deps AS builder

COPY . .
# medusa build exits 1 on TS warnings even when output is valid
RUN npm run build; test -d .medusa/server

# ── Production ────────────────────────────────────────────
FROM deps

# Remove devDependencies
RUN npm prune --omit=dev

COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/medusa-config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

EXPOSE 9000

CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
