# MPFlow

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![CI](https://github.com/teploe-odealko/mp-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/teploe-odealko/mp-flow/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://github.com/teploe-odealko/mp-flow/pkgs/container/mp-flow%2Fadmin)

AI Agent First ERP для продавцов на маркетплейсах. Каталог, закупки, склад, продажи, финансы — в одном месте. Подключайте AI-агентов через MCP для управления магазином.

**[mp-flow.ru](https://mp-flow.ru)** · **[Документация](https://docs.mp-flow.ru)** · **[Облако](https://admin.mp-flow.ru)**

## Быстрый старт

```bash
curl -O https://raw.githubusercontent.com/teploe-odealko/mp-flow/main/docker-compose.yml

cat > .env << 'EOF'
DB_PASSWORD=ваш_пароль
COOKIE_SECRET=$(openssl rand -base64 32)
EOF

docker compose up -d
```

Откройте **http://localhost:3000** — админка готова к работе.

> **Важно:** `COOKIE_SECRET` обязателен. Сгенерируйте случайное значение: `openssl rand -base64 32`.

## Возможности

- **Каталог** — карточки товаров с SKU, размерами, ценами, данными поставщиков
- **Закупки** — заказы поставщикам с распределением общих затрат (логистика, таможня)
- **Складской учёт** — партионный учёт с точной себестоимостью каждой единицы
- **Юнит-экономика** — PnL по товару с реальной себестоимостью
- **Продажи** — синхронизация с Ozon (отправления, возвраты, комиссии)
- **Финансы** — транзакции, ДДС, отчёты
- **Аналитика** — сводные отчёты по продажам и складу
- **AI-агенты** — MCP-сервер для подключения Claude Code, Cursor, Codex и других AI-клиентов
- **Плагины** — расширяемая архитектура с convention-based auto-discovery

## Облако

Не хотите разворачивать самостоятельно? Используйте облачную версию:

**[admin.mp-flow.ru](https://admin.mp-flow.ru)** — готово к работе, автообновления, бэкапы.

## Архитектура

```
┌───────────────────────────────────┐
│        Браузер / AI-агент         │
│   http://localhost:3000           │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│   MPFlow Admin (Node.js)          │
│   - Hono API (:3000)             │
│   - React SPA (встроена)         │
│   - MCP-сервер (/mcp)           │
│   - Плагины (auto-discovery)    │
├───────────────────────────────────┤
│   Core-модули:                    │
│   - master-card (каталог)        │
│   - supplier-order (закупки)     │
│   - finance (транзакции)         │
│   - sale (продажи)               │
├───────────────────────────────────┤
│   Плагины (convention-based):    │
│   - entities → auto-schema       │
│   - services → DI (awilix)      │
│   - routes, middleware, nav      │
│   - mcpTools, mcpResources      │
└──────────┬────────────────────────┘
           │
┌──────────▼──────┐
│   PostgreSQL    │
│   :5432         │
└─────────────────┘
```

- **Admin** — Hono API + React SPA в одном Node.js процессе. MikroORM для БД, awilix для DI.
- **MCP-сервер** — Streamable HTTP транспорт на `/mcp`. AI-агенты управляют магазином через tools и resources.
- **PostgreSQL** — все данные. Миграции + auto-schema применяются при запуске.
- **Плагины** — свои entities, routes, middleware, MCP tools. Таблицы создаются автоматически.

## Tech Stack

| Слой | Технология |
|------|-----------|
| HTTP | Hono 4 |
| ORM | MikroORM 6 + PostgreSQL 17 |
| DI | awilix |
| Сессии | iron-session (encrypted cookies) |
| Auth | Logto OIDC |
| Frontend | React 19 + Vite 6 + Tailwind CSS 3 |
| Data fetching | TanStack Query 5 |
| Router | React Router 7 |
| AI | MCP (Model Context Protocol) |

## Интеграции

| Интеграция | Описание |
|------------|----------|
| **Ozon Seller API** | Синхронизация товаров, остатков, продаж (плагин `ozon`) |
| **1688.com** | Поиск поставщиков, импорт товаров (плагин `ali1688`) |
| **AI Фото-студия** | Генерация фото товаров через AI (плагин `photo-studio`) |
| **Logto OIDC** | SSO авторизация |

Интеграции подключаются как плагины. Три плагина из коробки, другие можно создать самостоятельно.

## Разработка

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow/admin
npm install
```

Запустить PostgreSQL и dev-сервер:

```bash
docker run -d --name mpflow-pg -e POSTGRES_USER=mpflow -e POSTGRES_PASSWORD=mpflow -e POSTGRES_DB=mpflow -p 5432:5432 postgres:17-alpine

npm run dev
```

Админка: `http://localhost:5173` (клиент) с прокси на API `http://localhost:3000`.

Подробнее — [CONTRIBUTING.md](CONTRIBUTING.md) и [документация](https://docs.mp-flow.ru/docs/developer).

## Обновление

```bash
docker compose pull
docker compose up -d
```

Миграции и auto-schema применяются автоматически при старте.

## Версионирование

Проект использует [Semantic Versioning](https://semver.org/). Текущие релизы — pre-1.0 (API может меняться).

Changelog: [CHANGELOG.md](CHANGELOG.md)

## Лицензия

Основной код — [AGPL-3.0](LICENSE).

Enterprise-функции в `ee/` — отдельная лицензия, см. [ee/LICENSE](ee/LICENSE).
