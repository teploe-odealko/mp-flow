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
| proxy.mp-flow.ru | Бэкенд API |
| proxy.mp-flow.ru/docs | Документация API (Scalar) |
| docs.mp-flow.ru | Документация для пользователей и AI-агентов (Fumadocs) |
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
proxy/           Python бэкенд (FastAPI + MCP сервер)
admin-ui/        Фронтенд SPA (vanilla JS, Tailwind CSS)
landing/         Лэндинг (статический HTML)
website/         Документация (Next.js 16 + Fumadocs, static export)
brand/           Логотип, брендбук, иконки
migrations/      PostgreSQL миграции
proxy/src/plugins/  Система плагинов
proxy/src/ee/    Premium-функции (см. ee/LICENSE)
ee/              Лицензия EE
scripts/         Dev и CI скрипты
tests/admin/     Интеграционные тесты
```

## Креды и доступы

В `.env` (не коммитить).
