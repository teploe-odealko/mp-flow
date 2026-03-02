export default [
  {
    pageId: "warehouse",
    columnKey: "stock_total",
    pluginLabel: "Ozon",
    description: "Остатки со складов Ozon FBO (present), без учёта зарезервированных. Данные из раздела [Управление остатками](https://seller.ozon.ru/app/fbo-stocks/stocks-management) личного кабинета Ozon.",
  },
  {
    pageId: "warehouse",
    columnKey: "sold_total",
    pluginLabel: "Ozon",
    description: "Доставленные заказы из [FBO-отправлений](https://seller.ozon.ru/app/postings/fbo) минус [возвраты](https://seller.ozon.ru/app/returns/supply/common) после успешной доставки.",
  },
  {
    pageId: "warehouse",
    columnKey: "delivering_total",
    pluginLabel: "Ozon",
    description: "Сумма [FBO-отправлений](https://seller.ozon.ru/app/postings/fbo) в статусах «Ожидает сборки», «Готов к отгрузке» и «Доставляется».",
  },
  {
    pageId: "catalog",
    columnKey: "stock",
    pluginLabel: "Ozon",
    description: "Для привязанных товаров отображается остаток FBO из раздела [Управление остатками](https://seller.ozon.ru/app/fbo-stocks/stocks-management).",
  },
]
