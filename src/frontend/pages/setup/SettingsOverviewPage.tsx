import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  PackageCheck,
  Pencil
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { PageHeader } from "@/components/ui/page-header";
import { useAppState } from "@/lib/use-app-state";
import { date } from "@/lib/format";

export function SettingsOverviewPage() {
  const { state } = useAppState();
  if (!state.organization) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Настройки" subtitle="Сначала создайте учётную базу" />
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3">
            <Building2 size={36} className="text-[var(--color-muted-foreground)]" />
            <p className="text-sm">Учётная база не создана</p>
            <Button asChild>
              <Link to="/setup">Перейти к настройке</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const policy = state.accountingPolicy;
  const channels = (state.salesChannels ?? []).filter((channel: any) => channel.status !== "disabled");
  const latestBackfillProject = (state.backfillProjects ?? [])
    .slice()
    .sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  const onboardingPath = latestBackfillProject ? `/setup/existing-store/${latestBackfillProject.id}/review` : "/setup/existing-store?from=setup&mode=current_stock_start";

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <PageHeader
        title="Настройки"
        subtitle="Параметры кабинета и быстрый возврат к стартовым сценариям."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Организация</CardTitle>
              <CardDescription>Реквизиты и часовой пояс</CardDescription>
            </div>
            <Building2 size={20} className="text-[var(--color-muted-foreground)]" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DataList
              columns={2}
              items={[
                { label: "Название", value: state.organization.displayName },
                { label: "Часовой пояс", value: state.organization.timezone ?? "—" }
              ]}
            />
            <Button variant="ghost" size="sm" asChild className="self-start">
              <Link to="/setup">
                <Pencil size={14} /> Изменить
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Старт учёта</CardTitle>
              <CardDescription>Дата начала и базовые системные настройки</CardDescription>
            </div>
            <CalendarDays size={20} className="text-[var(--color-muted-foreground)]" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DataList
              columns={2}
              items={[
                { label: "Старт учёта", value: date(policy?.accountingStartDate) },
                { label: "Валюта учёта", value: policy?.accountingCurrency ?? "RUB" },
                { label: "Метод себестоимости", value: String(policy?.costMethod ?? "fifo").toUpperCase() }
              ]}
            />
            <Button variant="ghost" size="sm" asChild className="self-start">
              <Link to="/setup">
                <Pencil size={14} /> Изменить старт
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Старт магазина</CardTitle>
              <CardDescription>Вернитесь к мастеру работающего магазина</CardDescription>
            </div>
            <PackageCheck size={20} className="text-[var(--color-muted-foreground)]" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DataList
              columns={3}
              items={[
                { label: "Каналы продаж", value: channels.length ? `${channels.length}` : "Нет подключённых" },
                { label: "Последний проект старта", value: latestBackfillProject?.name ?? "Не создан" },
                { label: "Статус", value: latestBackfillProject?.status ?? "Можно начать" }
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={onboardingPath}>
                  Продолжить старт магазина <ArrowRight size={14} />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
