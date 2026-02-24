"""Scalar-powered interactive API documentation.

Replaces default Swagger UI with Scalar (modern, dark theme, "Try It" support).
Generates OpenAPI description and tag metadata for the admin ERP API.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["docs"])

OPENAPI_DESCRIPTION = """\
ERP API для продавцов на маркетплейсе Ozon.

## Аутентификация

Все запросы требуют Bearer token в заголовке `Authorization`:

```
Authorization: Bearer <token>
```

Получите токен через `POST /v1/admin/auth/login`.

Для MCP-подключений используйте API-ключ (`mpk_...`), \
созданный в разделе **API Keys**.

## Основные сущности

| Сущность | Описание |
|----------|----------|
| **Карточка** (master_card) | Товар / SKU |
| **Заказ поставщику** (supplier_order) | Закупка партии |
| **FIFO лот** (inventory_lot) | Партия на складе с себестоимостью |
| **Продажа** (card_sale) | Факт продажи с FIFO-списанием |
| **Финансовая операция** (finance_transaction) | Движение денег |

## Lifecycle

Закупка 1688 → Заказ поставщику → Оприходование (FIFO-лоты) → \
Отгрузка на Ozon → Продажа → FIFO-списание → Прибыль.
"""

OPENAPI_TAGS = [
    {
        "name": "Auth",
        "description": "Логин, логаут, информация о текущем пользователе.",
    },
    {
        "name": "Catalog",
        "description": "CRUD карточек товаров, поиск, импорт с 1688.com.",
    },
    {
        "name": "Orders",
        "description": "Заказы поставщикам: создание, редактирование, "
        "оприходование (→ FIFO-лоты), отмена оприходования.",
    },
    {
        "name": "Inventory",
        "description": "Складской учёт: обзор остатков, начальные остатки, корректировки.",
    },
    {
        "name": "Sales",
        "description": "Продажи: список и ручное создание с FIFO-списанием.",
    },
    {
        "name": "Finance",
        "description": "Финансовые операции: приход, расход, баланс.",
    },
    {
        "name": "Reports",
        "description": "Отчёты: ДДС (cash flow), P&L, Unit Economics по SKU, P&L Ozon.",
    },
    {
        "name": "Settings",
        "description": "Настройки аккаунта (ставка УСН и др.).",
    },
    {
        "name": "Integrations",
        "description": "Управление подключёнными аккаунтами Ozon "
        "(legacy single-account + multi-account).",
    },
    {
        "name": "Ozon Sync",
        "description": "Синхронизация данных из Ozon Seller API: "
        "продажи, финансы, возвраты, остатки, поставки, unit-economics.",
    },
    {
        "name": "Logistics",
        "description": "Логистика: SKU-матрица, поставки на Ozon, списания потерь и расхождений.",
    },
    {
        "name": "Demand",
        "description": "Планирование закупок: генерация плана, "
        "корректировка, подтверждение, параметры и кластерные цели.",
    },
    {
        "name": "Users",
        "description": "Управление пользователями (только для администраторов).",
    },
    {
        "name": "API Keys",
        "description": "Создание и управление API-ключами для MCP-подключений.",
    },
]


@router.get("/docs", response_class=HTMLResponse, include_in_schema=False)
async def scalar_docs() -> HTMLResponse:
    """Serve Scalar API reference UI."""
    return HTMLResponse(
        """\
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenMPFlow API</title>
</head>
<body>
  <script
    id="api-reference"
    data-url="/openapi.json"
    data-configuration='{
      "theme": "deepSpace",
      "authentication": {
        "preferredSecurityScheme": "BearerToken"
      }
    }'
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>"""
    )
