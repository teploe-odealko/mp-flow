# MPFlow

MPFlow — open-source система управленческого учёта для продавцов маркетплейсов. Проект помогает вести товары, закупки, складские остатки, продажи, выплаты, расходы, себестоимость и управленческие отчёты в одном контуре.

## Возможности

- SaaS-логика: каждый пользователь работает только со своим личным кабинетом и данными.
- Email/password авторизация с подтверждением почты.
- Подключение Ozon-канала, загрузка карточек, остатков, продаж и финансовых событий.
- Документо-центричный учёт: закупки, приёмки, перемещения, продажи, возвраты, расходы и выплаты.
- FIFO-себестоимость, партии, движения склада и сбалансированные бухгалтерские проводки.
- Отчёты: P&L, баланс, unit-экономика, журнал и главная книга.
- Production-наблюдаемость: healthchecks, Sentry-compatible ошибки, Prometheus metrics, Grafana dashboards и Loki logs.

## Стек

- Backend: TypeScript, Hono, Zod, PostgreSQL.
- Frontend: React, TanStack Query, Vite, Tailwind CSS.
- Observability: Sentry SDK, Prometheus, Grafana, Loki, prom-client.
- Tests: Vitest и Playwright.
- Runtime: один Node.js процесс отдаёт API и собранный React frontend.

## Требования

- **Node.js 22 LTS** (минимум 20.19) — версия зафиксирована в `.nvmrc`, `nvm use` подхватит её.
- **npm** (идёт вместе с Node).
- **Docker + Docker Compose** — для PostgreSQL, на которой работает приложение.

## Быстрый старт

MPFlow работает на PostgreSQL. Поднимите БД, запустите dev и создайте владельца — без почтового сервера.

```bash
cp .env.example .env      # шаблон настроен на локальный Docker-Postgres
docker compose up -d      # PostgreSQL на 127.0.0.1:54322
npm install
npm run dev
```

Откройте `http://127.0.0.1:5174`. На первом старте — экран **«Первый доступ»**: введите email и пароль и нажмите «Создать владельца». Аккаунт владельца создаётся **без подтверждения почты** и сразу входит (owner-setup как в n8n).

- Следующие пользователи (мультиаккаунт/cloud) подтверждают email. SMTP в dev не настроен — ссылка подтверждения печатается в консоль backend (строки `[auth:mail] …`).
- Кто может стать владельцем, ограничивается через `ACCOUNTING_AUTH_BOOTSTRAP_EMAILS` (по умолчанию пусто — владельцем становится первый зарегистрировавшийся; для публичного сервера задайте список).
- Изолированная база (без основного volume): `docker compose -f docker-compose.standalone.yml up -d` (Postgres на `127.0.0.1:55432`, пропишите его в `DATABASE_URL`).

Адреса и порты:

- frontend (Vite dev): `http://127.0.0.1:5174`;
- backend (API): `http://127.0.0.1:3004` (порт через `PORT`);
- healthcheck: `http://127.0.0.1:3004/api/health/ready`;
- PostgreSQL: `127.0.0.1:54322` (standalone — `55432`).

`make dev`, `make db`, `make check`, `make down` делают то же самое — см. `Makefile`.

## Команды

```bash
npm run dev               # backend (tsx watch) + frontend (Vite) с hot reload
npm test                  # все vitest-тесты
npm run test:unit         # только unit
npm run test:integration  # integration: API + доменный движок, без Docker
npm run test:scenarios    # сквозные сценарии учёта
npm run build             # dist/frontend + dist/server
npm start                 # node dist/server/index.js — API и фронт одним процессом на :3004
```

Тесты против реального PostgreSQL запускаются отдельно:

```bash
docker compose up -d
docker exec mpflow-postgres psql -U mpflow -d postgres -c "create database mpflow_tests;"
RUN_POSTGRES_TESTS=1 \
  TEST_DATABASE_URL=postgresql://mpflow:mpflow_local@127.0.0.1:54322/mpflow_tests \
  npm run test:integration
```

## Архитектура

- `src/backend` — HTTP API (Hono), авторизация, healthchecks, metrics, observability.
- `src/core` — доменная модель учёта: документы, сбалансированные проводки, FIFO-партии, остатки и отчёты.
- `src/infra/db` — PostgreSQL persistence, bootstrap схемы, шифрование секретов каналов.
- `src/plugins` — marketplace-интеграции и plugin runtime.
- `src/frontend` — React-приложение и пользовательские сценарии.
- `tests` — unit, integration и scenario-проверки.

Один Node.js процесс отдаёт API и собранный фронт. Данные multi-tenant: разделяются по `workspace_id`, который определяется из авторизованной сессии — пользователь видит только свой workspace. Marketplace-креды хранятся отдельно от доменных сущностей, шифруются ключом `ACCOUNTING_ENCRYPTION_KEY` и не возвращаются на frontend.

Учётная модель: бизнес-действие → документ → posting engine → сбалансированная проводка → журнал/главная книга → отчёты. Обычные сценарии никогда не требуют ручного выбора дебета/кредита — правила проводок принадлежат backend.

## Production

Минимальный production-контур — один сервер с Docker Compose и внешней PostgreSQL с backup. Готовые provisioning-файлы (Caddy, Grafana, Prometheus, Loki, Promtail), deploy-скрипты и systemd-таймер автодеплоя из `main` лежат в каталоге `deploy/`. App-образ собирается из `Dockerfile`.

Минимальные production-переменные (полный список — в `.env.example`):

```env
NODE_ENV=production
ACCOUNTING_PERSISTENCE=postgres
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/mpflow?sslmode=require
ACCOUNTING_ENCRYPTION_KEY=<long-random-secret>   # потеря ключа = нечитаемые креды каналов
AUTH_REQUIRED=true
PUBLIC_APP_URL=https://<domain>
CORS_ORIGIN=https://<domain>
ACCOUNTING_AUTH_BOOTSTRAP_EMAILS=<owner-email>
ACCOUNTING_EMAIL_PROVIDER=smtp                    # + ACCOUNTING_AUTH_SMTP_* для подтверждения почты
SENTRY_DSN=<dsn>
METRICS_TOKEN=<long-random-token>
```

Порядок: создать БД `mpflow` с backup → положить secrets на сервер → задеплоить через `deploy/scripts/mpflow-deploy-production` → проверить `https://<domain>/api/health/ready` → зарегистрировать owner-аккаунт и убедиться, что новый пользователь видит пустой кабинет, а не чужие данные. Секреты не коммитятся — `.env.example` только шаблон.

## Наблюдаемость

- `GET /api/health/live` — процесс жив; `GET /api/health/ready` — готовность (в Postgres-режиме проверяет БД).
- `GET /metrics` — Prometheus (в production требует bearer `METRICS_TOKEN`): `mpflow_http_requests_total`, `mpflow_http_request_duration_seconds`, `mpflow_http_requests_in_flight`, runtime- и `mpflow_app_info`-метрики.
- Ошибки — Sentry-compatible через `SENTRY_DSN`; в контекст не попадают cookies, Authorization и marketplace API keys.
- Логи — stdout/stderr (в compose-контуре Promtail → Loki). Бэкап БД: provider-backup + ежедневный `pg_dump` в object storage, проверка восстановления до публичного релиза.

## Документация

- [Security policy](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)
- [AGPL-3.0-or-later license](LICENSE)

## Лицензия

MPFlow распространяется под лицензией AGPL-3.0-or-later. Если вы запускаете изменённую версию как сетевой сервис, пользователи должны иметь доступ к исходному коду этой версии.
