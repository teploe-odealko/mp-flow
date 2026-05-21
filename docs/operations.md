# Операционная готовность

## Healthchecks

- `GET /api/health/live` — процесс отвечает.
- `GET /api/health/ready` — приложение готово принимать трафик; в PostgreSQL-режиме проверяет базу.
- `GET /api/health` — совместимый короткий healthcheck.

## Основные метрики

Prometheus scrape `/metrics` собирает:

- `mpflow_http_requests_total` — RPS и коды ответов по route/method/status.
- `mpflow_http_request_duration_seconds` — latency histogram по route/method/status.
- `mpflow_http_requests_in_flight` — текущие активные запросы.
- `mpflow_node_*` — runtime metrics Node.js.
- `mpflow_app_info` — service, environment, release.

В Grafana должны быть панели:

- uptime приложения;
- общий RPS;
- 4xx/5xx rate;
- p95 latency;
- top routes by RPS;
- top slow routes;
- status codes по выбранной ручке;
- container CPU/memory;
- Postgres availability/backup freshness, если exporter подключен.

## Ошибки

Sentry-compatible DSN задается через `SENTRY_DSN`. В событиях должны быть:

- `environment`;
- `release`;
- `service=mpflow`;
- request context без cookies, Authorization и marketplace API keys.

## Логи

Production-контейнер пишет в stdout/stderr. В compose-контуре логи собирает Promtail и отправляет в Loki. В логах нельзя хранить:

- cookies;
- Authorization headers;
- Ozon API keys;
- SMTP passwords;
- database passwords;
- email verification tokens.

## Backups

Минимальный уровень:

- provider backup PostgreSQL;
- ежедневный `pg_dump` в object storage;
- проверка восстановления хотя бы раз перед публичным релизом.

Целевые значения для раннего production:

- RPO: 24 часа;
- RTO: 1-4 часа;
- retention: 14 daily + 4 weekly + 6 monthly.
