import { Link } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  KeyRound,
  Pencil
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { PageHeader } from "@/components/ui/page-header";
import { useCollection } from "@/lib/use-collection";
import { date } from "@/lib/format";

export function SettingsOverviewPage() {
  const organization = useCollection<any>("organization");
  const policy = useCollection<any>("accountingPolicy");
  if (!organization) {
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
                { label: "Название", value: organization.displayName },
                { label: "Часовой пояс", value: organization.timezone ?? "—" }
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

        <Card>
          <CardHeader>
            <div>
              <CardTitle>MCP</CardTitle>
              <CardDescription>Ключи для Codex, Claude и других агентов</CardDescription>
            </div>
            <KeyRound size={20} className="text-[var(--color-muted-foreground)]" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DataList
              columns={2}
              items={[
                { label: "Endpoint", value: "/mcp" },
                { label: "Доступ", value: "Bearer-ключ" }
              ]}
            />
            <Button variant="ghost" size="sm" asChild className="self-start">
              <Link to="/settings/mcp">
                <KeyRound size={14} /> Управлять ключами
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
