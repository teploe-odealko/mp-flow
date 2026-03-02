import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary px-4 py-1.5 text-sm text-fd-muted-foreground mb-6">
        <img src="/logo.png" alt="" width={16} height={16} className="rounded-sm" />
        Open Source ERP для маркетплейсов
      </div>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
        MPFlow
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
        FIFO складской учёт, юнит-экономика, закупки, продажи и интеграция с
        Ozon. Расширяемая архитектура на плагинах.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground shadow-sm transition-colors hover:bg-fd-primary/90"
        >
          Документация
        </Link>
        <Link
          href="https://admin.mp-flow.ru"
          className="inline-flex items-center justify-center rounded-lg border border-fd-border px-6 py-3 text-sm font-medium text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent"
        >
          Начать бесплатно
        </Link>
      </div>

      <div className="mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          title="Каталог и склад"
          description="FIFO учёт, партионная себестоимость, закупки с распределением затрат"
          href="/docs"
        />
        <Card
          title="Интеграция с Ozon"
          description="Синхронизация товаров, остатков, продаж, возвратов и финансовых транзакций"
          href="/docs"
        />
        <Card
          title="Юнит-экономика"
          description="PnL по товару с FIFO себестоимостью, комиссиями и логистикой Ozon"
          href="/docs"
        />
        <Card
          title="Облако mp-flow.ru"
          description="Начните за 2 минуты — без установки, автообновления, бэкапы"
          href="https://admin.mp-flow.ru"
        />
        <Card
          title="Self-hosting"
          description="Docker Compose, переменные окружения, обновления"
          href="/docs/developer/self-hosting"
        />
        <Card
          title="Плагины"
          description="Convention-based auto-discovery: entities, services, routes, middleware"
          href="/docs/developer/plugin-development"
        />
      </div>
    </main>
  );
}

function Card({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-fd-border bg-fd-card p-6 text-left transition-colors hover:border-fd-primary/50"
    >
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-fd-muted-foreground">{description}</p>
    </Link>
  );
}
