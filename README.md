# MPFlow

MPFlow — open-source система управленческого учета для продавцов маркетплейсов. Проект помогает вести товары, закупки, складские остатки, продажи, выплаты, расходы, себестоимость и управленческие отчеты в одном контуре.

## Возможности

- SaaS-логика: каждый пользователь работает только со своим личным кабинетом и данными.
- Email/password авторизация с подтверждением почты.
- Подключение Ozon-канала, загрузка карточек, остатков, продаж и финансовых событий.
- Документо-центричный учет: закупки, приемки, перемещения, продажи, возвраты, расходы и выплаты.
- FIFO-себестоимость, партии, движения склада и бухгалтерские проводки.
- Отчеты: P&L, баланс, unit-экономика, журнал и главная книга.
- Production-наблюдаемость: healthchecks, Sentry-compatible ошибки, Prometheus metrics, Grafana dashboards и Loki logs.

## Стек

- Backend: TypeScript, Hono, Zod, PostgreSQL.
- Frontend: React, TanStack Query, Vite, Tailwind CSS.
- Observability: Sentry SDK, Prometheus, Grafana, Loki, prom-client.
- Tests: Vitest и Playwright.
- Runtime: один Node.js контейнер отдает API и собранный React frontend.

## Быстрый старт

```bash
npm ci
cp .env.example .env
docker compose up -d
npm run dev
```

После запуска:

- frontend: `http://127.0.0.1:5174`;
- backend: `http://127.0.0.1:3004`;
- healthcheck: `http://127.0.0.1:3004/api/health/ready`;
- PostgreSQL: `postgresql://mpflow:mpflow_local@127.0.0.1:54322/mpflow`.

Для полностью изолированного локального контура без старого Docker volume:

```bash
docker compose -f docker-compose.standalone.yml up -d
npm run dev
```

## Проверки

```bash
npm test
npm run build
npm run test:browser
```

Полный прогон PostgreSQL-теста:

```bash
docker compose up -d
docker exec mpflow-postgres psql -U mpflow -d postgres -c "create database mpflow_tests;"
RUN_POSTGRES_TESTS=1 \
  TEST_DATABASE_URL=postgresql://mpflow:mpflow_local@127.0.0.1:54322/mpflow_tests \
  npm run test:integration
```

## Production

Минимальный production-контур описан в [docs/deployment.md](docs/deployment.md). В репозитории есть Dockerfile, compose-конфиг для сервера и готовые provisioning-файлы Grafana/Prometheus/Loki в [deploy/production](deploy/production).

Обязательные production-переменные:

- `DATABASE_URL`;
- `ACCOUNTING_ENCRYPTION_KEY`;
- `AUTH_REQUIRED=true`;
- `PUBLIC_APP_URL`;
- `CORS_ORIGIN`;
- SMTP-переменные для подтверждения почты;
- `SENTRY_DSN`;
- `METRICS_TOKEN`.

Секреты не коммитятся. Используйте `.env.example` только как шаблон.

## Документация

- [Архитектура](docs/architecture.md)
- [Развертывание](docs/deployment.md)
- [Операционная готовность](docs/operations.md)
- [Security policy](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)
- [AGPL-3.0-or-later license](LICENSE)

## Лицензия

MPFlow распространяется под лицензией AGPL-3.0-or-later. Если вы запускаете измененную версию как сетевой сервис, пользователи должны иметь доступ к исходному коду этой версии.
