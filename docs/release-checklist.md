# Release checklist

## Репозиторий

- [ ] Старый GitHub repo переименован в `mp-flow-archive`.
- [ ] Новый clean repo создан как `mp-flow`.
- [ ] В clean repo нет старых папок `accounting/`, `website/`, `landing/`, `moysklad/`, `tmp/`.
- [ ] В clean repo нет `.env`, `node_modules`, `dist`, `test-results`, дампов и скриншотов с секретами.
- [ ] `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` лежат в корне.
- [ ] GitHub Actions проходят на `main`.

## Приложение

- [ ] `npm ci`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] Production startup smoke проходит.
- [ ] Критичные UI-сценарии проверены вручную через локальный браузер.

## Production

- [ ] PostgreSQL durable и с backup.
- [ ] `ACCOUNTING_ENCRYPTION_KEY` сохранен вне репозитория.
- [ ] SMTP работает, email verification приходит.
- [ ] Sentry/GlitchTip получает тестовую ошибку.
- [ ] Grafana показывает RPS, коды ответов, latency и health.
- [ ] Новый пользователь видит только свои данные.
- [ ] Автодеплой из `main` проверен на реальном commit.
