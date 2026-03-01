# Как внести вклад в MPFlow

Спасибо за интерес к проекту! Этот документ поможет начать.

## Настройка окружения

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow/admin
npm install
```

Запустить PostgreSQL:

```bash
docker run -d --name mpflow-pg \
  -e POSTGRES_USER=mpflow \
  -e POSTGRES_PASSWORD=mpflow \
  -e POSTGRES_DB=mpflow \
  -p 5432:5432 \
  postgres:17-alpine
```

Запустить dev-сервер:

```bash
npm run dev
```

Откройте http://localhost:5173 (Vite dev-сервер с прокси на API :3000).

## Структура проекта

```
admin/               Основное приложение (бэкенд + фронтенд)
  src/server/        Hono API, MikroORM модули, маршруты
  src/client/        React SPA (Tailwind CSS, TanStack Query)
  plugins/ozon/      Ozon интеграция (плагин)
  mpflow.config.ts   Конфигурация (БД, auth, плагины)
landing/             Лэндинг (статический HTML)
website/             Документация (Next.js 16 + Fumadocs)
brand/               Логотип, брендбук
ee/                  Лицензия EE
```

## Стиль кода

TypeScript, проверяется через `tsc`:

```bash
cd admin
npm run build:server    # Проверка серверного кода
npm run build:client    # Проверка клиентского кода
```

## Тесты

```bash
cd admin
npm test
```

Тесты используют vitest.

## Pull Requests

1. Форкните репо и создайте ветку: `git checkout -b feature/my-feature`
2. Внесите изменения
3. Проверьте сборку: `cd admin && npm run build`
4. Запустите тесты: `npm test`
5. Откройте PR в `main`

CI запускается автоматически: сборка клиента, сервера и плагинов.

## Миграции

Два механизма:

1. **Ручные миграции** — для core-модулей, файлы в `admin/src/server/migrations/`
2. **Auto-schema** — для плагинов. MikroORM автоматически создаёт таблицы и добавляет колонки из plugin entities при старте сервера (`safe: true` — только аддитивные изменения, без удалений)

Создать новую миграцию:

```bash
cd admin
npm run db:migrate
```

## Плагины

Плагины расширяют систему: свои entities, API-роуты, middleware, cron jobs, страницы в админке.

Смотрите плагин `ozon` как референс: `admin/plugins/ozon/`.

Подробная документация: [docs.mp-flow.ru/docs/developer/plugin-development](https://docs.mp-flow.ru/docs/developer/plugin-development)

## EE код

Файлы в `ee/` — под проприетарной лицензией (см. `ee/LICENSE`).
Использование EE-функций в продакшене требует активной подписки.

## Вопросы?

Откройте issue на GitHub: https://github.com/teploe-odealko/mp-flow/issues
