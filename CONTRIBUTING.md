# Как внести вклад в MPFlow

Спасибо за интерес к проекту! Этот документ поможет начать.

## Настройка окружения

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow
cp .env.example .env
docker compose up --build
```

Откройте http://localhost:3000, войдите с `admin` / паролем из `.env`.

## Структура проекта

```
proxy/               Python бэкенд (FastAPI)
admin-ui/            Фронтенд SPA (vanilla JS, Tailwind CSS)
landing/             Лэндинг (статический HTML + Tailwind CDN)
website/             Документация (Next.js 16 + Fumadocs)
brand/               Логотип, брендбук
migrations/          PostgreSQL миграции (последовательные SQL файлы)
proxy/src/plugins/   Система плагинов
proxy/src/ee/        Premium-функции (см. ee/LICENSE)
ee/                  Лицензия EE
scripts/             Dev и CI скрипты
tests/admin/         Интеграционные тесты (Docker Postgres)
```

## Стиль кода

Python код проверяется [ruff](https://github.com/astral-sh/ruff):

```bash
ruff check proxy/
ruff format proxy/
```

Конфигурация в `proxy/pyproject.toml`: line-length 100, target Python 3.11.

## Тесты

```bash
# Интеграционные тесты (поднимают Docker Postgres)
PYTHONPATH=. pytest tests/admin/ -v
```

Тесты используют `asyncio_mode = "auto"`, декоратор `@pytest.mark.asyncio` не нужен.

## Pull Requests

1. Форкните репо и создайте ветку: `git checkout -b feature/my-feature`
2. Внесите изменения
3. Запустите линтер: `ruff check proxy/ && ruff format proxy/`
4. Запустите тесты: `PYTHONPATH=. pytest tests/admin/ -v`
5. Откройте PR в `main`

CI запускается автоматически: линтер, форматирование, тесты, проверка миграций.

## Миграции

- Файлы в `migrations/` с последовательной нумерацией (например, `027_my_feature.sql`)
- Используйте `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для идемпотентности
- Тестируйте на чистой базе: `docker compose down -v && docker compose up --build`
- Скрипт `scripts/init-db.sh` отслеживает применённые миграции в таблице `schema_migrations`

## Плагины

Плагины расширяют UI и API. Смотрите плагин `ali1688` как референс:

```
proxy/src/plugins/ali1688/   Бэкенд (manifest, routes, service)
admin-ui/plugins/ali1688/    Фронтенд (ESM модуль)
```

Плагины можно контрибьютить как встроенные (в этом репо) или как отдельные репозитории.

## EE код

Файлы в `proxy/src/ee/` и `ee/` — под проприетарной лицензией (см. `ee/LICENSE`).
Использование EE-функций в продакшене требует активной подписки.

Контрибьюшены в EE код приветствуются — открывая PR с изменениями EE файлов,
вы соглашаетесь с условиями `ee/LICENSE`.

## Вопросы?

Откройте issue на GitHub: https://github.com/teploe-odealko/mp-flow/issues
