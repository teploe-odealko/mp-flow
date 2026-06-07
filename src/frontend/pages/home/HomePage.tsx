import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Box,
  CheckCircle2,
  Circle,
  FileText,
  Sparkles,
  Truck,
  Warehouse
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/page-header";
import { apiGet } from "@/api";
import { rub } from "@/lib/format";

export function HomePage() {
  const dashboardQuery = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<any>("/api/dashboard") });
  if (dashboardQuery.isLoading) {
    return <div className="text-sm text-[var(--color-muted-foreground)]">Загрузка…</div>;
  }
  if (!dashboardQuery.data?.configured) {
    return <HomeBeforeSetup />;
  }
  return <HomeDashboard dashboard={dashboardQuery.data} />;
}

function HomeBeforeSetup() {
  const checklist = [
    {
      title: "Кабинет",
      text: "Укажите название кабинета и часовой пояс."
    },
    {
      title: "Сценарий запуска",
      text: "Выберите учёт с нуля или старт работающего магазина."
    },
    {
      title: "Точка старта",
      text: "Для нового магазина укажите дату старта, для работающего магазина подготовьте подключение Ozon."
    },
    {
      title: "Стартовые данные",
      text: "Занесите закупки с нуля или загрузите карточки, остатки и себестоимость из рабочего магазина."
    }
  ];

  const features = [
    { icon: <Box size={20} />, title: "Товары", text: "Создавайте товары, импортируйте их из маркетплейсов и отслеживайте остатки." },
    { icon: <Warehouse size={20} />, title: "Стартовые остатки", text: "Загрузите остатки на дату старта, чтобы начать учёт с реальными данными." },
    { icon: <Truck size={20} />, title: "Поставки", text: "Заказы, оплаты, приёмки и расчёт себестоимости." },
    { icon: <BarChart3 size={20} />, title: "Отчёты", text: "Прибыль, баланс, остатки и денежные средства." }
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Начните учёт магазина"
        subtitle="Чтобы начать, создайте кабинет и выберите, с какой точки запускать учёт. Это занимает 2-3 минуты."
        badge={<Badge tone="primary">Первичная настройка</Badge>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Чеклист настройки</CardTitle>
              <CardDescription>Один маршрут: кабинет, сценарий и стартовые данные</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {checklist.map((item, i) => (
                <li
                  key={item.title}
                  className="flex items-start gap-3 px-3 py-3 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors"
                >
                  <div className="size-7 rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)] flex items-center justify-center text-xs font-semibold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{item.title}</div>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{item.text}</p>
                  </div>
                  <Badge tone="neutral">Не настроено</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center gap-2">
              <Button asChild size="lg">
                <Link to="/setup">
                  Перейти к настройке <ArrowRight size={16} />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Что появится после настройки</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="size-9 rounded-[var(--radius-md)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)] flex items-center justify-center shrink-0">
                    {f.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">{f.text}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-[var(--color-primary-soft)] border-[oklch(0.88_0.06_258)]">
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[var(--color-primary)]">
                <Sparkles size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Важно</span>
              </div>
              <p className="text-xs text-[var(--color-foreground)]/80 leading-relaxed">
                Для работающего магазина сначала подключите канал Ozon, затем заполните стартовые остатки и себестоимость.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HomeDashboard({ dashboard }: { dashboard: any }) {
  const productsCount = dashboard.counters?.products ?? 0;
  const documentsCount = dashboard.counters?.documents ?? 0;
  const openLots = dashboard.counters?.inventoryLots ?? 0;
  const salesCount = dashboard.counters?.sales ?? 0;
  const purchaseOrdersCount = dashboard.counters?.purchaseOrders ?? 0;
  const totalCost = dashboard.inventoryCostRub ?? 0;
  const recentDocs = dashboard.recentDocuments ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Рабочий стол"
        subtitle="Сводка по документам, остаткам, продажам и контролю"
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="primary" icon={<Box size={18} />} label="Товары" value={productsCount} />
        <Kpi tone="info" icon={<FileText size={18} />} label="Документы" value={documentsCount} />
        <Kpi tone="success" icon={<Warehouse size={18} />} label="Открытые партии" value={openLots} />
        <Kpi tone="neutral" icon={<BarChart3 size={18} />} label="Продажи" value={salesCount} />
        <Kpi tone="neutral" icon={<Sparkles size={18} />} label="Себестоимость" value={rub(totalCost)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Последние документы</CardTitle>
              <CardDescription>Свежий учётный поток</CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/documents">
                Все документы <ArrowRight size={14} />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {recentDocs.length === 0 && (
                <li className="px-5 py-6 text-sm text-[var(--color-muted-foreground)] text-center">
                  Документов пока нет
                </li>
              )}
              {recentDocs.map((doc: any) => (
                <li key={doc.id}>
                  <Link
                    to={`/documents/${doc.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-muted)] transition-colors"
                  >
                    <div className="size-9 rounded-[var(--radius-md)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)] flex items-center justify-center shrink-0">
                      <FileText size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{doc.title || doc.documentType}</div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)] numeric">
                        {doc.number} · {doc.accountingDate}
                      </div>
                    </div>
                    <div className="text-sm font-semibold numeric">{rub(doc.amountRub)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Следующие действия</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <NextAction
              done={productsCount > 0}
              title="Создать товар"
              text="Внутренние SKU — основа для остатков и закупок."
              to="/products/new"
            />
            <NextAction
              done={purchaseOrdersCount > 0}
              title="Создать поставку"
              text="Зафиксировать заказ и оплату."
              to="/procurement/purchase-orders/new"
            />
            <NextAction
              done={false}
              title="Подключить канал"
              text="Привяжите Ozon/WB или ручной канал."
              to="/integrations/channels/new"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NextAction({ done, title, text, to }: { done: boolean; title: string; text: string; to: string }) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 p-3 rounded-[var(--radius-md)] hover:bg-[var(--color-muted)] transition-colors"
    >
      {done ? (
        <CheckCircle2 size={18} className="text-[var(--color-success)] mt-0.5 shrink-0" />
      ) : (
        <Circle size={18} className="text-[var(--color-muted-foreground)] mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">{text}</p>
      </div>
    </Link>
  );
}
