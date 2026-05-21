# Развертывание

Документ описывает простой production-контур для одного сервера. Для первого релиза достаточно VPS/Cloud Server с Docker Compose и внешней PostgreSQL-базой с backup.

## Рекомендуемая схема

- Домен: `mp-flow.ru`.
- Reverse proxy: Caddy.
- App: Docker image из этого репозитория.
- Database: managed PostgreSQL 17 или отдельный PostgreSQL-сервер с регулярными backup.
- Error tracking: GlitchTip или Sentry-compatible SaaS через `SENTRY_DSN`.
- Metrics/logs: Prometheus, Grafana, Loki, Promtail.

## Минимальные переменные приложения

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3004
ACCOUNTING_PERSISTENCE=postgres
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/mpflow?sslmode=require
ACCOUNTING_ENCRYPTION_KEY=<long-random-secret>
AUTH_REQUIRED=true
PUBLIC_APP_URL=https://mp-flow.ru
CORS_ORIGIN=https://mp-flow.ru
ACCOUNTING_AUTH_BOOTSTRAP_EMAILS=<owner-email>
ACCOUNTING_AUTH_PUBLIC_SIGNUP=true
ACCOUNTING_SAAS_WORKSPACES_ENABLED=true
ACCOUNTING_EMAIL_PROVIDER=smtp
ACCOUNTING_AUTH_EMAIL_FROM=MPFlow <noreply@mp-flow.ru>
ACCOUNTING_AUTH_SMTP_HOST=<smtp-host>
ACCOUNTING_AUTH_SMTP_PORT=465
ACCOUNTING_AUTH_SMTP_SECURE=true
ACCOUNTING_AUTH_SMTP_USER=<smtp-user>
ACCOUNTING_AUTH_SMTP_PASS=<smtp-password>
SENTRY_DSN=<dsn>
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git-sha>
METRICS_TOKEN=<long-random-token>
```

## Порядок развертывания

1. Создать PostgreSQL database `mpflow` и отдельного application user.
2. Включить provider backup базы.
3. Настроить отдельный logical backup через `pg_dump` в S3/object storage.
4. Создать сервер с Docker и Docker Compose.
5. Скопировать production secrets в `/opt/mpflow/prod-secrets.env`.
6. Скопировать app env в `/opt/mpflow/env/mpflow.env`.
7. Скопировать metrics token в `/opt/mpflow/env/mpflow-metrics-token`.
8. Клонировать репозиторий в `/opt/mpflow/repo`.
9. Запустить `deploy/scripts/mpflow-deploy-production`.
10. Проверить `https://mp-flow.ru/api/health/ready`.
11. Зарегистрировать owner-аккаунт, подтвердить email, войти в приложение.
12. Проверить, что тестовая ошибка попала в Sentry/GlitchTip, а RPS/status/latency видны в Grafana.

## Автодеплой main

В `deploy/systemd` есть timer, который раз в минуту проверяет `origin/main`. Если новый commit является fast-forward от последнего успешно развернутого commit, запускается deploy script.

Команды на сервере:

```bash
install -m 0755 deploy/scripts/mpflow-deploy-production /usr/local/bin/mpflow-deploy-production
install -m 0755 deploy/scripts/mpflow-auto-deploy-main /usr/local/bin/mpflow-auto-deploy-main
install -m 0644 deploy/systemd/mpflow-auto-deploy-main.service /etc/systemd/system/
install -m 0644 deploy/systemd/mpflow-auto-deploy-main.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mpflow-auto-deploy-main.timer
```

## Проверка после релиза

- `/api/health/live` возвращает 200.
- `/api/health/ready` возвращает 200 и видит PostgreSQL.
- `/metrics` без bearer-token возвращает 401 или 503 в production.
- `/metrics` с bearer-token отдается Prometheus.
- В Grafana есть RPS, коды ответов, latency p95, 4xx/5xx по ручкам.
- Email verification приходит на реальный mailbox.
- Новый пользователь видит пустой личный кабинет, а не чужие данные.
- Ozon credentials сохраняются и не отображаются обратно в UI.
