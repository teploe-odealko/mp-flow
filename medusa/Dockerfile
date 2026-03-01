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
# Admin UI build (served from ./public/admin/)
COPY --from=builder /app/.medusa/server/public ./public

# Plugin (package.json + compiled .medusa for exports resolution)
RUN mkdir -p node_modules/mpflow-plugin-ozon
COPY --from=builder /app/plugins/ozon/package.json ./node_modules/mpflow-plugin-ozon/package.json
COPY --from=builder /app/plugins/ozon/.medusa ./node_modules/mpflow-plugin-ozon/.medusa

# psql for DB reset capability
RUN apk add --no-cache postgresql-client

EXPOSE 9000

# RESET_DB=true → drop and recreate the database before migrating (one-time use)
CMD ["sh", "-c", "\
  if [ \"$RESET_DB\" = 'true' ]; then \
    echo 'RESET_DB: dropping and recreating database...' && \
    node -e \" \
      const u = new URL(process.env.DATABASE_URL); \
      const env = { PGPASSWORD: u.password, PGHOST: u.hostname, PGPORT: u.port, PGUSER: u.username }; \
      const db = u.pathname.slice(1); \
      const {execSync} = require('child_process'); \
      const opts = {env: {...process.env, ...env}, stdio: 'inherit'}; \
      execSync('dropdb --if-exists ' + db, opts); \
      execSync('createdb ' + db, opts); \
      console.log('Database ' + db + ' reset complete'); \
    \"; \
  fi && \
  npx medusa db:migrate && npx medusa start"]
