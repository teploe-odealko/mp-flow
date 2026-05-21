FROM mirror.gcr.io/library/node:22-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM mirror.gcr.io/library/node:22-slim AS runtime

ENV NODE_ENV=production
ENV ACCOUNTING_PERSISTENCE=postgres
ENV HOST=0.0.0.0
ENV PORT=3004

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 3004
CMD ["node", "dist/server/index.js"]
