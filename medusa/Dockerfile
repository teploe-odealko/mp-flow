FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# ── Build plugin + admin UI + backend ─────────────────────
FROM deps AS builder

COPY . .

# Install plugin dependencies and build it
RUN cd plugins/ozon && npm install
RUN cd plugins/ozon && ../../node_modules/.bin/medusa plugin:build

# Copy built plugin into node_modules (symlinks unreliable in Docker)
RUN rm -rf node_modules/mpflow-plugin-ozon \
    && mkdir -p node_modules/mpflow-plugin-ozon \
    && cp plugins/ozon/package.json node_modules/mpflow-plugin-ozon/ \
    && cp -r plugins/ozon/.medusa node_modules/mpflow-plugin-ozon/

# Build main app (medusa build exits 1 on TS warnings even when output is valid)
RUN npm run build; test -d .medusa/server

# ── Production ────────────────────────────────────────────
FROM deps

# Remove devDependencies
RUN npm prune --omit=dev

COPY --from=builder /app/.medusa ./.medusa
# Compiled config (TS source can't load after prune removes @swc/core)
COPY --from=builder /app/.medusa/server/medusa-config.js ./medusa-config.js
# Symlink src → compiled output so module paths resolve to JS not TS
RUN ln -s .medusa/server/src src

# Plugin (package.json + compiled .medusa for exports resolution)
RUN mkdir -p node_modules/mpflow-plugin-ozon
COPY --from=builder /app/plugins/ozon/package.json ./node_modules/mpflow-plugin-ozon/package.json
COPY --from=builder /app/plugins/ozon/.medusa ./node_modules/mpflow-plugin-ozon/.medusa

EXPOSE 9000

CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
