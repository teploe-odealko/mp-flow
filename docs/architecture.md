# Архитектура

MPFlow — single-service приложение: один Node.js процесс обслуживает backend API и собранный React frontend.

## Основные слои

- `src/backend` — HTTP API, auth, healthchecks, metrics, observability.
- `src/core` — доменная модель учета, документы, проводки, партии, остатки и отчеты.
- `src/infra/db` — PostgreSQL persistence, schema bootstrap, шифрование секретов каналов.
- `src/plugins` — marketplace-интеграции и plugin runtime.
- `src/frontend` — React приложение и пользовательские сценарии.
- `tests` — unit, integration, scenario и browser smoke проверки.

## Данные и multi-tenant

Production-режим использует PostgreSQL. Данные разделяются по `workspace_id`, который определяется по authenticated user session. Пользователь получает доступ только к своему workspace. Shared-доступы между аккаунтами в UI сейчас скрыты: базовая модель — один аккаунт, один личный кабинет.

Marketplace credentials не возвращаются на frontend. Они хранятся отдельно от доменных сущностей и шифруются ключом `ACCOUNTING_ENCRYPTION_KEY`.

## Runtime

Рекомендуемый production-режим:

- `ACCOUNTING_PERSISTENCE=postgres`;
- `AUTH_REQUIRED=true`;
- durable PostgreSQL с backup;
- один stateless app container;
- Caddy или другой reverse proxy с HTTPS.

In-memory режим остается только для быстрых тестов и локальных smoke-сценариев.

## Наблюдаемость

- `/api/health/live` — процесс жив.
- `/api/health/ready` — приложение готово обслуживать запросы, в Postgres-режиме проверяет базу.
- `/metrics` — Prometheus metrics с RPS, latency, status codes и runtime metrics.
- Sentry-compatible DSN — ошибки backend/frontend.
- JSON/stdout logs собираются внешним log collector.
