# MPFlow

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![CI](https://github.com/teploe-odealko/mp-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/teploe-odealko/mp-flow/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://github.com/teploe-odealko/mp-flow/pkgs/container/mp-flow%2Fadmin)

AI Agent First ERP для продавцов на маркетплейсах. Пусть рутину делают AI-агенты — учёт партий, себестоимость, PnL, ДДС, закупки в 1 клик из коробки.

**[mp-flow.ru](https://mp-flow.ru)** · **[Документация](https://docs.mp-flow.ru)** · **[Облако](https://admin.mp-flow.ru)**

## Возможности

**AI-агент управляет магазином за вас** — подключите Claude Code, Codex, Cursor, Windsurf или любой MCP-клиент. 54+ инструментов: цены, остатки, аналитика, заказы и весь Ozon API. Попросите словами — агент сделает.

- **PnL и ДДС** — управленческие отчёты из коробки. Прибыль-убыток и движение денежных средств по каждому товару и за период
- **Закупки в 1 клик** — прогноз по скорости продаж, формирование заказа поставщику автоматически
- **Учёт партий** — себестоимость каждой партии с распределением затрат: закупка, логистика, таможня, упаковка
- **Продажи FBO** — автосинхронизация с Ozon: отправления, возвраты, комиссии, логистика
- **Юнит-экономика** — маржа и ROI по каждому SKU
- **Система плагинов** — расширяйте функциональность без изменения ядра

## Плагины

| Плагин | Описание |
|--------|----------|
| **Ozon FBO** | Синхронизация товаров, остатков, продаж, возвратов и финансов. AI-агент получает доступ к 400+ методам Ozon Seller API |
| **1688.com** | Привязка товаров к поставщикам на 1688.com. Цены в юанях, выгрузка заявки в XLSX |
| **Фото-студия** | AI-генерация продуктовых фото: ресерч → SVG-превью → готовые изображения для карточек |
| **Свой плагин** | Создайте под ваши задачи. [Документация →](https://docs.mp-flow.ru/docs/developer/plugin-development) |

## Облако

Не хотите разворачивать самостоятельно? Используйте облачную версию — без установки, автообновления, бэкапы:

**[admin.mp-flow.ru](https://admin.mp-flow.ru)** — 14 дней бесплатно, от 300 ₽/мес.

## Self-hosting

Все функции без ограничений на вашем сервере. Нужны Docker 24+ и Docker Compose v2 (минимум 2 ГБ RAM).

### Быстрый старт

```bash
curl -O https://raw.githubusercontent.com/teploe-odealko/mp-flow/main/docker-compose.yml

cat > .env << 'EOF'
DB_PASSWORD=ваш_надёжный_пароль
COOKIE_SECRET=вставьте_результат_команды_ниже
EOF

# Сгенерируйте COOKIE_SECRET:
openssl rand -base64 32

docker compose up -d
```

Откройте **http://localhost:3000** — готово.

> `COOKIE_SECRET` обязателен. Без него сервер не запустится.

### Переменные окружения

| Переменная | Обязательная | Описание |
|------------|:---:|----------|
| `DB_PASSWORD` | да | Пароль PostgreSQL |
| `COOKIE_SECRET` | да | Секрет для шифрования сессий (`openssl rand -base64 32`) |
| `PORT` | нет | Порт админки (по умолчанию 3000) |

### Обновление

```bash
docker compose pull
docker compose up -d
```

Миграции применяются автоматически при старте.

Подробнее — [документация по self-hosting](https://docs.mp-flow.ru/docs/developer/self-hosting).

## Разработка

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow/admin
npm install
```

Создайте `.env` в директории `admin/`:

```env
DATABASE_URL=postgresql://mpflow:mpflow@localhost:5432/mpflow
COOKIE_SECRET=dev-secret
```

Запустите PostgreSQL и dev-сервер:

```bash
docker run -d --name mpflow-pg \
  -e POSTGRES_USER=mpflow \
  -e POSTGRES_PASSWORD=mpflow \
  -e POSTGRES_DB=mpflow \
  -p 5432:5432 \
  postgres:17-alpine

npm run dev
```

Клиент: `http://localhost:5173` с прокси на API `http://localhost:3000`.

> В dev-режиме (без `LOGTO_ENDPOINT`) авторизация не требуется — автоматический вход как dev-пользователь.

Подробнее — [CONTRIBUTING.md](CONTRIBUTING.md) и [документация для разработчиков](https://docs.mp-flow.ru/docs/developer).

## Лицензия

Основной код — [AGPL-3.0](LICENSE).

Enterprise-функции в `ee/` — отдельная лицензия, см. [ee/LICENSE](ee/LICENSE).
