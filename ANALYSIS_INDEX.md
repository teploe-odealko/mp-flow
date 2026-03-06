# MPFlow — Индекс анализа

Полный анализ проекта MPFlow структурирован в следующих файлах:

## 📋 Основные документы анализа

### 1. **ANALYSIS_SUMMARY.md** — Начните отсюда! 📌
Итоговое резюме на 2k слов:
- Суть продукта в одном предложении
- Что показать в видео (ранжировано)
- Функциональность по страницам
- Целевая аудитория
- Ключевые выводы
- **Идеально для**: быстрого ознакомления (5 минут чтения)

### 2. **QUICK_OVERVIEW.md** — Для презентации 🎯
Краткий обзор на 1k слов:
- 5 главных фич
- Tech Stack таблица
- Как использовать (облако / self-hosted / dev)
- Key Messages для разных аудиторий
- Elevator pitch (30 сек)
- **Идеально для**: презентаций инвесторам (2-3 минуты чтения)

### 3. **PROJECT_ANALYSIS.md** — Полный анализ 📚
Детальный анализ на 5k слов с 10 разделами:
1. Что такое MPFlow
2. Функциональность UI (10 страниц подробно)
3. Визуальная архитектура (дизайн, компоненты, навигация)
4. Ozon-плагин (синхронизация, AI-управление, обогащение)
5. AI Agent First парадигма
6. Workflows доступные пользователям
7. Архитектура (краткий обзор)
8. Впечатляющие фичи для видео
9. Key Messages
10. Ссылки и точки входа
- **Идеально для**: понимания всех функций продукта (30 минут чтения)

### 4. **TECHNICAL_ARCHITECTURE.md** — Для разработчиков 🔧
Технический анализ на 4k слов:
- Высокоуровневая архитектура (диаграммы)
- Frontend архитектура (React, Vite, Tailwind)
- Backend архитектура (Hono, MikroORM, awilix)
- Database Layer (MikroORM entities, relationships)
- MCP Server Integration
- Plugin System (convention-based discovery)
- Authentication & Authorization
- Key Workflows (с примерами)
- API Response Format
- Performance & Testing
- Deployment
- Summary
- **Идеально для**: разработчиков (45 минут чтения)

### 5. **VIDEO_DEMO_SCRIPT.md** — Для съёмки видео 🎬
Полный сценарий видео-демо на 3k слов:
- 9 сцен с timing, visual, voice-over, actions
- Скрипт для каждой сцены (англ + русс)
- Post-production checklist
- YouTube description template
- Альтернативные версии (TikTok / LinkedIn / GitHub)
- **Идеально для**: создания видео-демо (прямое использование)

---

## 🗂️ Структура проекта (что где находится)

### Frontend (`admin/src/client/`)
```
pages/
├── catalog/         → товары (1. Каталог)
├── warehouse/       → остатки (2. Склад)
├── procurement/     → прогноз (3. Закупки) ⭐
├── suppliers/       → заказы (4. Поставщики)
├── sales/           → продажи (5. Продажи)
├── finance/         → ДДС (6. Финансы)
├── analytics/       → P&L (7. Аналитика) ⭐
├── plugins/         → управление
├── settings/        → настройки
└── billing/         → подписка
```

### Backend (`admin/src/server/`)
```
routes/             → API endpoints (GET, POST, PUT, DELETE)
modules/            → бизнес-логика (сервисы + entities)
workflows/          → сложные операции (поступление, продажа)
mcp/                → AI Agent интеграция (MCP сервер)
core/               → фреймворк (DI, ORM, auth)
migrations/         → миграции БД
```

### Плагины (`admin/plugins/`)
```
ozon/               → Ozon FBO интеграция (синхронизация + API)
ali1688/            → Ali1688 интеграция (поиск поставщиков)
photo-studio/       → AI генерация фото товаров
```

### Documentation (`website/content/docs/`)
```
user/
├── plugins/         → для пользователей плагинов
└── ai-agents/       → как подключить AI
developer/
├── self-hosting.md  → как поднять свой сервер
├── plugin-development/ → как делать плагины
└── api/             → API документация
```

### Landing (`landing/index.html`)
```
Статический HTML с информацией о продукте
Можно использовать как скелет для маркетинга
```

---

## 🎯 Как использовать этот анализ?

### Если у вас есть 5 минут:
→ Прочитайте **ANALYSIS_SUMMARY.md** (3-4 мин) + посмотрите QUICK_OVERVIEW.md (1-2 мин)

### Если у вас есть 30 минут:
→ Прочитайте **PROJECT_ANALYSIS.md** полностью

### Если у вас есть 1 час:
→ Прочитайте всё и посмотрите реальный код:
- `admin/src/client/pages/procurement/page.tsx` — визуализация прогноза
- `admin/src/client/pages/analytics/page.tsx` — P&L отчёт
- `admin/src/server/workflows/receive-order.ts` — как считается себестоимость

### Если вы разработчик:
→ Начните с **TECHNICAL_ARCHITECTURE.md**, потом смотрите код

### Если вы готовите видео:
→ Используйте **VIDEO_DEMO_SCRIPT.md** как готовый сценарий

### Если вы пишете статью / презентацию:
→ Используйте **QUICK_OVERVIEW.md** + **PROJECT_ANALYSIS.md** для примеров

---

## ✨ Ключевые выводы (TL;DR)

### Что это?
- Open Source ERP для продавцов на маркетплейцах
- Интегрирован с Ozon FBO
- Управляется через AI-агентов (MCP)

### Главные фичи?
1. ⭐⭐⭐⭐⭐ **Прогноз закупок** (визуально красиво, функционально полезно)
2. ⭐⭐⭐⭐⭐ **Управление через AI** (естественный язык, 54+ инструмента)
3. ⭐⭐⭐⭐⭐ **P&L + Unit Economics** (считает прибыль верно)
4. ⭐⭐⭐⭐ **Ozon синхронизация** (автоматическая)
5. ⭐⭐⭐ **Распределение затрат** (по цене, весу, поровну)

### Почему это будет успешно?
- Решает реальную проблему (продавцы не видят прибыль)
- Open Source (бесплатно для разработчиков)
- SaaS модель (300 ₽/мес в облаке)
- Тренд AI (управление через агентов)

### Что показать в видео?
- Закупки (90 сек, timeline bar, один клик на заказ)
- AI управление (60 сек, Claude Code через MCP)
- Аналитика (60 сек, P&L с деталями)

---

## 📚 Источники анализа

Все документы созданы на основе:
- ✅ Полного кода проекта (admin/, plugins/, website/)
- ✅ README.md, CONTRIBUTING.md, CLAUDE.md
- ✅ React компонентов (pages/, components/)
- ✅ API маршрутов (routes/)
- ✅ Бизнес-логики (workflows/, services/)
- ✅ MCP инструментов (mcp/tools.ts)
- ✅ Документации (website/content/docs/)

---

## 🚀 Рекомендуемый порядок чтения

```
1️⃣ ANALYSIS_SUMMARY.md (5 мин)
   ↓
2️⃣ QUICK_OVERVIEW.md (3 мин) или PROJECT_ANALYSIS.md (30 мин)
   ↓
3️⃣ VIDEO_DEMO_SCRIPT.md (если готовим видео) — 10 мин
   ↓
4️⃣ TECHNICAL_ARCHITECTURE.md (если интересуют технологии) — 45 мин
   ↓
5️⃣ Смотрим реальный код на GitHub
```

---

**Готово! Полный анализ MPFlow готов к использованию. 🎉**

Все документы находятся в `/mp-flow/`:
- ANALYSIS_SUMMARY.md
- QUICK_OVERVIEW.md
- PROJECT_ANALYSIS.md
- TECHNICAL_ARCHITECTURE.md
- VIDEO_DEMO_SCRIPT.md
- ANALYSIS_INDEX.md (этот файл)
