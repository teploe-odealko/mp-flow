# MPFlow

Open source ERP для продавцов на маркетплейсах. Управление каталогом, закупками, складом (FIFO), ценами, акциями и финансами в одном месте.

**[mp-flow.ru](https://mp-flow.ru)** · **[Документация](https://docs.mp-flow.ru)** · **[API](https://proxy.mp-flow.ru/docs)**

## Быстрый старт

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow
cp .env.example .env
docker compose up -d
```

Откройте **http://localhost:3000** и войдите с логином `admin` / паролем из `.env` (`ADMIN_BOOTSTRAP_PASSWORD`).

> **Важно:** перед публикацией в интернет измените `ADMIN_BOOTSTRAP_PASSWORD` и `HMAC_SECRET` в `.env` на случайные значения.

## Возможности

- **Каталог** — карточки товаров с SKU, размерами, ценами, данными поставщиков
- **Закупки** — заказы поставщикам с распределением общих затрат (логистика, таможня)
- **FIFO учёт** — партионный складской учёт с точной себестоимостью каждой единицы
- **Юнит-экономика** — PnL по товару, ДДС, отчёты с реальной себестоимостью FIFO
- **Ценообразование** — калькулятор прибыли с учётом всех комиссий Ozon, массовое обновление цен
- **Управление акциями** — массовое включение/выключение с защитой минимальной маржи
- **Логистика** — SKU-матрица, поставки на Ozon, планирование закупок
- **AI Agent (MCP)** — 54+ инструментов для Claude, ChatGPT и других MCP-клиентов
- **Плагины** — расширяемая архитектура (см. ali1688 плагин)

## Облако

Не хотите разворачивать самостоятельно? Используйте облачную версию:

**[admin.mp-flow.ru](https://admin.mp-flow.ru)** — готово к работе, автообновления, бэкапы.

## Архитектура

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Admin UI   │────>│   Proxy     │────>│  PostgreSQL   │
│ (port 3000) │     │ (port 8000) │     │  (port 5432)  │
└─────────────┘     └─────────────┘     └──────────────┘
   nginx SPA         FastAPI + MCP        Данные
```

- **Admin UI** — SPA на vanilla JS + Tailwind CSS, проксирует запросы к Proxy
- **Proxy** — FastAPI с Admin API, MCP сервер (54+ инструментов), система плагинов
- **PostgreSQL** — все данные, миграции применяются автоматически при запуске

## Интеграции

Настраиваются через `.env`:

| Интеграция | Переменные | Описание |
|------------|-----------|----------|
| **Ozon Seller API** | `OZON_CLIENT_ID`, `OZON_API_KEY` | Синхронизация товаров, остатков, продаж, возвратов |
| **1688 Поставщики** | `TMAPI_API_TOKEN` | Импорт данных поставщиков (цены, фото, SKU) |
| **AI** | `ANTHROPIC_API_KEY` | AI-функции в MCP сервере |
| **SSO (Logto)** | `LOGTO_ENDPOINT`, `LOGTO_API_RESOURCE` | OIDC/OAuth2 авторизация |

## MCP сервер

54+ инструментов для AI-агентов через [Model Context Protocol](https://modelcontextprotocol.io/):

```json
{
  "mcpServers": {
    "mpflow": {
      "url": "https://proxy.mp-flow.ru/mcp",
      "headers": { "Authorization": "Bearer mpk_..." }
    }
  }
}
```

Поддерживаются: Claude Desktop, Claude Code, ChatGPT, Cursor, Manus, любой MCP-клиент.

## Разработка

```bash
cd proxy && pip install -r requirements.txt
uvicorn proxy.src.main:app --reload --port 8000

# Линтер
ruff check proxy/ && ruff format proxy/

# Тесты
PYTHONPATH=. pytest tests/admin/ -v
```

Подробнее — [CONTRIBUTING.md](CONTRIBUTING.md).

## Обновление

```bash
git pull
docker compose up --build -d
```

Миграции применяются автоматически при старте контейнера.

## Лицензия

Основной код — [AGPL-3.0](LICENSE).

Enterprise-функции в `proxy/src/ee/` — отдельная лицензия, см. [ee/LICENSE](ee/LICENSE).
