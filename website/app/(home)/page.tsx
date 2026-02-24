import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary px-4 py-1.5 text-sm text-fd-muted-foreground mb-6">
        Open Source ERP for Ozon FBO
      </div>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
        OpenMPFlow
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
        ERP-система для продавцов на Ozon. Каталог, закупки, FIFO-учёт,
        аналитика, плагины, MCP-интеграция с AI.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground shadow-sm transition-colors hover:bg-fd-primary/90"
        >
          Get Started
        </Link>
        <Link
          href="/docs/guides/plugin-development"
          className="inline-flex items-center justify-center rounded-lg border border-fd-border px-6 py-3 text-sm font-medium text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent"
        >
          Build a Plugin
        </Link>
      </div>
      <div className="mt-16 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-xl border border-fd-border bg-fd-card p-6 text-left">
          <h3 className="font-semibold">One Command Setup</h3>
          <p className="mt-2 text-sm text-fd-muted-foreground">
            <code className="text-xs">docker compose up</code> — PostgreSQL,
            API, Admin UI готовы за минуту.
          </p>
        </div>
        <div className="rounded-xl border border-fd-border bg-fd-card p-6 text-left">
          <h3 className="font-semibold">Plugin System</h3>
          <p className="mt-2 text-sm text-fd-muted-foreground">
            VS Code-style плагины. Frontend (ESM) + Backend (Python). Schema
            isolation.
          </p>
        </div>
        <div className="rounded-xl border border-fd-border bg-fd-card p-6 text-left">
          <h3 className="font-semibold">MCP Integration</h3>
          <p className="mt-2 text-sm text-fd-muted-foreground">
            54 MCP tools. Подключите Claude, ChatGPT или любой AI-клиент.
          </p>
        </div>
      </div>
    </main>
  );
}
