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
| docs.mp-flow.ru | Документация для пользователей и разработчиков (Fumadocs) |
| auth.mp-flow.ru | Logto OIDC авторизация |

## Деплой

Dokploy: http://162.120.18.177:3000/
Compose ID: `BBVJSiccYtks2lqCdsxcB`
Сервер: 155.212.164.184
DNS: reg.ru, wildcard A-запись → 155.212.164.184

## GitHub

https://github.com/teploe-odealko/mp-flow (main branch, autoDeploy: true)

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
| Build server | tsc (tsconfig.server.json) |

## Ключевые паттерны (admin/)

- **Request-scoped EM**: каждый HTTP-запрос получает `orm.em.fork()`, сервисы создаются per-request через awilix scope
- **Auto-schema для плагинов**: plugin entities собираются перед ORM init, `SchemaGenerator.updateSchema({ safe: true })` автоматически создаёт таблицы/колонки
- **Плагины**: `definePlugin()` в `plugins/*/plugin.ts` — entities, services, routes, middleware, adminNav
- **COOKIE_SECRET обязателен**: сервер не стартует без этой env-переменной

## Креды и доступы

В `.env` (не коммитить).


mp-flow/docker-compose.prod.yml - файл для деплоя на нашу продовую облачную платную версию
docker-compose.yml - файл для развертывания селф-хостед версии


## Плагины

Самое важное при реализации ядра и плагинов - ядро не должно знать конкретные реализации плагинов. Все взаимодейсвтие должно происходить через различные точки расширения 


## Принципы тестирования

При внесении изменений сначала тестируем все локально. Должно быть развернуто локальное окружение с сервисом, с локальной бд. Сначала делаем авто тесты, юнит и интеграционные, а потом тестируем через браузер - можно как угодно сначала подготовить бд, записать любые значения, которые нужны для тестов, напрямую и дальше проверить функциональность явно нажимая и прокликивая новвые функции


# git

Все изменения нужно сразу коммитить. То есть перед тем как остановиться работать и ждать ответа пользвователя, если была сделана осмысленная законченная работа, то нужно сделать commit