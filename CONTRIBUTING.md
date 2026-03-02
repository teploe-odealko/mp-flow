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

## Git Flow

### Branches

- `main` — всегда deployable, автодеплой на прод
- Feature branches: `feat/xxx`, `fix/xxx` → PR в `main`

### Conventional Commits

Мы используем [Conventional Commits](https://www.conventionalcommits.org/). Это позволяет автоматически генерировать CHANGELOG при релизе.

| Префикс | Когда использовать | Пример |
|---------|-------------------|--------|
| `feat:` | Новая функциональность | `feat: добавить страницу аналитики` |
| `fix:` | Исправление бага | `fix: исправить подсчёт FIFO себестоимости` |
| `refactor:` | Рефакторинг без изменения поведения | `refactor: convention-based auto-discovery` |
| `docs:` | Только документация | `docs: обновить README` |
| `chore:` | Обслуживание (зависимости, CI) | `chore: обновить dependencies` |
| `test:` | Тесты | `test: добавить тесты для sync workflow` |
| `perf:` | Оптимизация производительности | `perf: кэшировать запросы к Ozon API` |

### Pull Requests

1. Форкните репо и создайте ветку: `git checkout -b feat/my-feature`
2. Внесите изменения
3. Проверьте сборку: `cd admin && npm run build`
4. Запустите тесты: `npm test`
5. Откройте PR в `main`

CI запускается автоматически: сборка клиента, сервера, плагинов и тесты.

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

Плагины расширяют систему: свои entities, API-роуты, middleware, страницы в админке. Convention-based auto-discovery — entities, services, routes обнаруживаются по структуре папок.

Смотрите плагин `ozon` как референс: `admin/plugins/ozon/`.

Подробная документация: [docs.mp-flow.ru/docs/developer/plugin-development](https://docs.mp-flow.ru/docs/developer/plugin-development)

## Версионирование и релизы

Проект следует [Semantic Versioning](https://semver.org/):

- **PATCH** (0.1.1): баг-фиксы
- **MINOR** (0.2.0): новые фичи
- **MAJOR** (1.0.0): breaking changes

Релизы создаются через `release-it`:

```bash
cd admin
npm run release          # Интерактивный релиз
npm run release -- --dry-run  # Предпросмотр без изменений
```

Скрипт автоматически:
1. Определяет тип бампа по conventional commits
2. Обновляет version в package.json
3. Генерирует CHANGELOG.md
4. Создаёт коммит и git tag
5. Пушит и создаёт GitHub Release

## EE код

Файлы в `ee/` — под проприетарной лицензией (см. `ee/LICENSE`).
Использование EE-функций в продакшене требует активной подписки.

## Вопросы?

Откройте issue на GitHub: https://github.com/teploe-odealko/mp-flow/issues
