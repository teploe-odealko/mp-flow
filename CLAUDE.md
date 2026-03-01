# MPFlow

Открытая AI Agent First система управления маркетплейсами (сейчас Ozon FBO).

Open source — основные функции можно развернуть бесплатно. Есть облачная версия на mp-flow.ru.

## Язык

Все общение, документация и артефакты (спеки, доки, README) — на русском.

## Домены (прод)

| Домен | Назначение |
|-------|------------|
| mp-flow.ru | Лэндинг |
| admin.mp-flow.ru | Личный кабинет (Admin UI) |
| proxy.mp-flow.ru | Бэкенд API (тот же admin сервис) |
| docs.mp-flow.ru | Документация для пользователей и AI-агентов (Fumadocs) |
| auth.mp-flow.ru | Logto OIDC авторизация |

## Деплой

Dokploy: http://162.120.18.177:3000/
Compose ID: `BBVJSiccYtks2lqCdsxcB`
Сервер: 155.212.164.184
DNS: reg.ru, wildcard A-запись → 155.212.164.184

## GitHub

https://github.com/teploe-odealko/mp-flow (main branch)

## Структура

```
admin/           Бэкенд + фронтенд (Hono + React + Vite + MikroORM)
  src/server/    Hono API сервер, MikroORM модули, маршруты, workflows
  src/client/    React SPA (Tailwind CSS, TanStack Query, React Router)
  plugins/ozon/  Ozon интеграция (плагин)
landing/         Лэндинг (статический HTML)
website/         Документация (Next.js 16 + Fumadocs, static export)
brand/           Логотип, брендбук, иконки
ee/              Лицензия EE
```

## Tech Stack (admin/)

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
| Build server | tsup |
| Cron | node-cron |

## Креды и доступы

В `.env` (не коммитить).
