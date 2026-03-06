# MPFlow — Сценарий видео-демо (5 минут)

## Предпродакшн

**Что нужно подготовить:**
- Локальный запуск MPFlow с тестовыми данными
- Несколько товаров в каталоге
- История продаж за 30 дней
- Несколько поставщиков и заказов
- Подключение Claude Code через MCP
- Оборудование: хороший микрофон, экран 1920x1080+

**Монтаж:**
- Переходы: fade (200ms)
- Текст на экране: 2-3 сек на уникум
- Фоновая музыка: спокойная, tech-ориентированная
- Скорость кликов/анимаций: реальная (не ускоренная)

---

## Сцена 1: Открытие (10 сек)

### Visual
- Закрытый браузер на тёмном рабочем столе
- Фоновая музыка начинается (спокойная, интересная)

### Voice-over (ENG, потом вариант RU)
> "Meet MPFlow. An AI Agent First ERP for marketplace sellers."

### Action
- Клик по браузеру
- Заходим на mp-flow.ru

### Text на экране
- "MPFlow — AI Agent First ERP"

---

## Сцена 2: Лэндинг (10 сек)

### Visual
- mp-flow.ru открыта
- Скролим вниз медленно

### Voice-over
> "Built for Amazon FBA, Ozon, and other marketplaces. Manage inventory, procurement, finances, and AI agents — all in one place."

### Text
- "Inventory Management"
- "Cost Accounting"
- "P&L Analytics"
- "AI Agent Control"

### Action
- Скролим до кнопки "Cloud" или "Self-hosted"
- Клик на "Cloud" → redirects to admin.mp-flow.ru

---

## Сцена 3: Вход (5 сек)

### Visual
- Экран логина MPFlow

### Voice-over
> "Sign up in seconds."

### Action
- Заполняем email: demo@mpflow.ru (уже залогированы в dev режиме)
- Или просто показываем уже залогиненного пользователя

---

## Сцена 4: Главная — Каталог (30 сек)

### Visual
- Открывается /catalog
- Таблица с товарами (5-10 товаров)

### Voice-over
> "First, let's look at the catalog. Here you see all your products with their SKU, purchase prices, warehouse stock, and average cost per unit."

### Text на экране
- "Catalog Page"
- "Column: Average Cost (себестоимость)"

### Action
1. Скролим таблицу вправо показываем все колонки
2. Кликаем на один товар (например, "Wireless Headphones")
3. Открывается детальная страница товара

### На деталь товара показываем
- История партий (batch history)
- Себестоимость каждой партии
- Распределение затрат (логистика, таможня, упаковка)
- Остатки на складе

### Voice-over (continuing)
> "Each product has a detailed history showing which batches were purchased, their individual costs, and how overhead expenses were allocated. This is critical for accurate profitability calculation."

---

## Сцена 5: Закупки — ГЛАВНАЯ СЦЕНА ⭐⭐⭐ (90 сек)

### Visual
- Переходим на /procurement
- Видим красивую таблицу с timeline bars

### Voice-over
> "Now, let's look at procurement forecasting. This is where the magic happens."

### Text на экране
- "Procurement Forecast"

### Action 1: Объяснение (40 сек)
1. Скролим таблицу
2. Показываем одну row с timeline bar
3. Указываем на разные цвета

### Voice-over (explaining timeline)
> "The system analyzes your sales history over the last 30 days and calculates the daily sales rate for each product.
>
> The timeline bar shows:
> - How many days of stock you currently have
> - When that stock will run out (red zone)
> - Where your lead time ends (the dashed line here)
> - How many days of buffer stock you want to maintain (green zone)
>
> In this case, this product will be out of stock in 5 days. Since our supplier needs 14 days to deliver, we need to order TODAY."

### Text поверх экрана (sync с voice-over)
- "Daily sales rate: 2.5 units/day"
- "Current stock: 12 units = 4.8 days"
- "Lead time: 14 days"
- "Required buffer: 30 days"
- "Status: 🔴 URGENT — Order now!"

### Action 2: Создание заказа (50 сек)
1. Нажимаем кнопку "Create Order" для этого товара (или раскрываем rows с товарами которые требуют заказа)
2. Открывается modal "Create Procurement Order"
3. Видим:
   - Supplier name: (например, "Alibaba Supplier")
   - Items to order:
     - Product: "Wireless Headphones"
     - Quantity: 100 units
     - Unit cost: 20 USD
     - Total: 2000 USD
   - Shared costs (раскрыты):
     - Shipping: 300 USD (распределить по весу)
     - Customs: 150 USD (распределить поровну)
     - Packaging: 50 USD (по цене товара)

### Voice-over (creating order)
> "When you create an order, you can specify shared costs like shipping, customs, and packaging. The system will automatically allocate these to each product based on your chosen method."

### Text
- "Shared costs allocation"
- "by_weight" → shipping
- "equal" → customs
- "by_price" → packaging

### Action (финализация)
4. Нажимаем "Create Order"
5. Видим сообщение "Order created successfully"
6. Заказ появился в статусе "draft"

---

## Сцена 6: Финансы / Аналитика (60 сек)

### Visual
- Переходим на /analytics
- Видим 3 таба: PnL, Unit Economics, Stock Valuation

### Voice-over
> "Now let's look at the financial performance. This is where you see real profitability, not just top-line revenue."

### Text
- "Analytics Dashboard"

### Action 1: P&L Tab (35 сек)
1. P&L tab уже открыт (или кликаем на него)
2. Видим summary cards:
   - Total Sales: 45
   - Revenue: 45,000 ₽
   - Expenses: 28,500 ₽
   - Net Profit: 16,500 ₽ (с маржей 36.7%)

### Voice-over (P&L)
> "Here's your complete P&L statement. Revenue includes all sales. Expenses break down into:
> - Cost of Goods Sold (COGS) — your actual cost per unit
> - Marketplace fees — commission, FBA, logistics
> - Operating expenses — what you entered manually"

### Text при раскрытии P&L
```
INCOME
├─ Sales: 45,000 ₽
└─ Manual income: 0 ₽

EXPENSES
├─ COGS: 18,000 ₽ (40%)
├─ Marketplace Fees
│  ├─ Commission: 6,750 ₽ (15%)
│  ├─ FBA: 2,250 ₽ (5%)
│  └─ Logistics: 1,500 ₽ (3.3%)
└─ Manual expenses: 0 ₽

NET PROFIT: 16,500 ₽ (36.7%)
```

3. Раскрываем P&L accordion для подробностей

### Action 2: Unit Economics Tab (25 сек)
1. Кликаем на "Unit Economics" tab
2. Видим таблицу с товарами:
   - Product Name
   - Quantity Sold
   - Revenue
   - COGS
   - Fees
   - Profit
   - Margin %
   - **ROI**

### Voice-over (Unit Economics)
> "Unit Economics shows the profitability of each product individually. You can see ROI, which tells you how much profit you make on every ruble invested."

### Text
- "Unit Economics"
- Highlight ROI column: "ROI shows return per ruble invested"

### Action
- Сортируем по прибыли (descending)
- Видим какие товары лучше продаются

---

## Сцена 7: Ozon интеграция (45 сек)

### Visual
- Переходим на /plugins → Ozon

### Voice-over
> "This store is connected to Ozon. The system automatically syncs inventory, sales, and returns in real-time."

### Text
- "Ozon Integration"

### Action 1: Статус синхронизации (15 сек)
1. Видим зелёный статус: "Connected ✓"
2. Последняя синхронизация: "2 minutes ago"
3. Аккаунт: "seller_id_12345"

### Action 2: Остатки на складах (15 сек)
1. Переходим в /catalog, выбираем товар
2. Видим в Ozon enrichment:
   - Stock on Ozon Moscow: 45 units
   - Stock on Ozon SPB: 23 units
   - Stock on Ozon Ekb: 12 units
   - **Total FBO: 80 units** (зелёным цветом)

### Voice-over (inventory)
> "Your inventory is always up-to-date with Ozon's warehouse. When you sell a product, it automatically appears in the sales section."

### Action 3: Последние продажи (15 сек)
1. Переходим на /sales
2. Видим список продаж с источником "Ozon"
3. Для каждой продажи:
   - Product name
   - Quantity
   - Price
   - Commission
   - Status (в пути / доставлена)
   - Date

### Voice-over (sales)
> "Ozon sales appear here automatically. You see the actual price paid, marketplace commission, and delivery status."

---

## Сцена 8: AI Управление — ВПЕЧАТЛЯЮЩАЯ СЦЕНА ⭐⭐⭐⭐⭐ (60 сек)

### Visual
- Закрываем браузер с MPFlow
- Открываем Terminal / Claude Code window

### Voice-over
> "The real power of MPFlow is AI Agent control. Connect it to Claude Code, Cursor, or any MCP-compatible tool."

### Text
- "AI Agent Control via MCP"

### Action 1: Подключение MCP (15 сек)
1. Показываем команду (в Terminal или в Claude Code UI):
   ```
   MCP Server: http://localhost:3000/api/mcp
   Tools: 54
   ```
2. Видим список инструментов:
   - list_products
   - get_product
   - get_procurement_forecast
   - create_procurement_order
   - list_sales
   - get_finance_summary
   - get_analytics
   - ozon_api (и сотни методов Ozon Seller API)
   - И еще 45+ инструментов...

### Voice-over
> "When connected, the AI agent gets access to 54+ tools to manage your entire marketplace business."

### Action 2: Пример запроса к AI (45 сек)

**Option A: Simple text example (если нет реального Claude Code)**
```
User: "Which products need price adjustment? Show me those with margin < 15%"

Claude AI:
→ Calls: get_analytics(report='unit-economics')
→ Returns: [
    {
      product: "Budget Headphones",
      margin: 8.5%,
      roi: 12%,
      profit_potential: "Increase price by 20%"
    },
    {
      product: "USB Cable",
      margin: 12.3%,
      roi: 18%,
      profit_potential: "Increase price by 15%"
    }
  ]

Claude AI: "I found 2 products with low margins.
Budget Headphones at 8.5% margin can increase price by 20% without losing sales.
USB Cable at 12.3% needs a 15% price increase."

User: "Do it. Increase prices on Ozon."

Claude AI:
→ Calls: ozon_api(
    path: '/v3/product/prices',
    body: {
      products: [
        { sku: 'budget-headphones', price: 1200 },
        { sku: 'usb-cable', price: 150 }
      ]
    }
  )
→ Returns: { success: true, updated: 2 }

Claude AI: "Done. Prices updated on Ozon."
```

**Option B: Live demo (если есть реальное подключение)**
1. Открываем Claude Code / Cursor
2. Видно что МРFlow подключен через MCP
3. Пишем промпт: "Analyze my business. Which products are most profitable?"
4. Claude Code вызывает API через MCP
5. Видим результаты в реальном времени
6. Спрашиваем: "Create a procurement order for the fast-movers"
7. Claude Code создаёт заказ через API

### Voice-over
> "You can manage your entire business with natural language. 'Show me products with low margin', 'Create orders for fast-selling items', 'Update prices based on competition' — the AI handles it all."

### Text при демо
- "MCP: Model Context Protocol"
- "Natural language → AI decides which tool to call → Automatic execution"
- "All changes are logged in MPFlow"

---

## Сцена 9: Финалка (15 сек)

### Visual
- Back to browser
- mp-flow.ru на фоне

### Voice-over
> "MPFlow is open source. You can self-host it for free, or use the cloud version from just 300 rubles per month."

### Text на экране
- Self-hosted: Free (Docker Compose)
- Cloud: 300 ₽/month (14 days free trial)
- Open Source: github.com/teploe-odealko/mp-flow
- Docs: docs.mp-flow.ru

### Action
- Показываем QR code на GitHub repo или mp-flow.ru

### Voice-over (closing)
> "Whether you sell on Ozon, Wildberries, or Amazon FBA, MPFlow helps you track profitability accurately and scale with AI. Get started today."

### Text (последний кадр)
```
MPFlow
AI Agent First ERP for Marketplace Sellers

🌐 mp-flow.ru
☁️ admin.mp-flow.ru (14 days free)
📖 docs.mp-flow.ru
🔧 github.com/teploe-odealko/mp-flow

Questions? 💬 GitHub Discussions
```

---

## Timing summary

| Сцена | Время | Content |
|-------|-------|---------|
| 1. Открытие | 10 сек | Intro |
| 2. Лэндинг | 10 сек | What is MPFlow |
| 3. Вход | 5 сек | Login |
| 4. Каталог | 30 сек | Products overview |
| 5. Закупки | 90 сек | ⭐ Forecasting + order creation |
| 6. Финансы | 60 сек | P&L + Unit Economics |
| 7. Ozon | 45 сек | Real-time integration |
| 8. AI | 60 сек | ⭐⭐ Agent control |
| 9. Финалка | 15 сек | Call-to-action |
| **ИТОГО** | **~325 сек** | **~5.5 минут** |

---

## Ключевые моменты для видеомонтажа

### Что выделить:
1. ✨ Timeline bar в закупках (красная/жёлтая/зелёная визуализация)
2. ✨ Один клик → заказ поставщику
3. ✨ P&L раскрывается с деталями
4. ✨ ROI по каждому товару
5. ✨ AI говорит команду → система выполняет
6. ✨ Синхронизация в реальном времени

### Переходы:
- Fade между сценами (200ms)
- Zoom на важные элементы UI (при объяснении)
- Slow reveal на таблицах (при скролле)

### Текст на экране:
- Белый текст на тёмном фоне (для читаемости)
- Шрифт: Inter, 24pt для заголовков
- Highlight важные цифры (красный/зелёный)

### Фоновая музыка:
- Спокойная электроника (Cyberpunk/Tech vibe)
- Низкий BPM (120-140 BPM)
- Примеры: Lo-fi, Ambient Tech, Synthwave

### Voice-over:
- Чистый англ/русс (хорошая дикция)
- Медленный темп ( 120-140 слов/мин)
- Энтузиастичный тон (но не overdone)

---

## Post-production checklist

- [ ] Color correction (dark theme consistency)
- [ ] Audio levels (-6dB for bg music, -3dB for voice)
- [ ] Add captions (English + Russian)
- [ ] Add graphics:
  - [ ] Timeline bar legend
  - [ ] P&L structure diagram
  - [ ] AI workflow diagram
- [ ] Add YouTube chapters
- [ ] Thumbnail with key visual
- [ ] Description with links

---

## YouTube Description Template

```
MPFlow — AI Agent First ERP for Marketplace Sellers
https://mp-flow.ru

Manage your Ozon, Wildberries, or Amazon FBA inventory with accurate profitability tracking.

📊 Features:
• Accurate cost accounting by batch
• Automated procurement forecasting
• Real-time P&L and unit economics
• Automatic Ozon synchronization
• AI agent control via MCP protocol

☁️ Try Cloud Version (14 days free):
https://admin.mp-flow.ru

💻 Self-host for Free:
https://docs.mp-flow.ru/docs/developer/self-hosting

🔧 Open Source:
https://github.com/teploe-odealko/mp-flow

📖 Documentation:
https://docs.mp-flow.ru

---
Timestamps:
0:00 Intro
0:10 What is MPFlow
0:20 Login
0:25 Catalog Overview
0:55 Procurement Forecasting ⭐
2:25 Financial Analytics
3:25 Ozon Integration
4:10 AI Agent Control ⭐
5:10 Summary & Call-to-Action
```

---

## Альтернативные версии для разных платформ

### TikTok / Shorts (60 сек, максимум впечатлений)
- Только сцены 5 (Закупки) + 8 (AI)
- Быстрые переходы
- Большой текст на экране
- Call-to-action в конце

### LinkedIn (2-3 мин, для B2B)
- Сцены 1, 2, 4, 6, 9
- Фокус на финансовой прибыльности
- Professional tone
- CTA: "Try today"

### GitHub (5+ мин, для разработчиков)
- Все сцены + дополнительно:
  - Plugin architecture
  - MCP resource listing
  - Self-hosting demo
- Technical details
- CTA: "Contribute to the project"

---

**Итого: готовый сценарий на ~5 минут видео с максимальным впечатлением и информацией**
