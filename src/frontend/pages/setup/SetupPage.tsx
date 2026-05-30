import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FileText,
  PackageCheck,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { apiPut } from "@/api";
import { useAppState } from "@/lib/use-app-state";

const TIMEZONES = [
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" }
];

export function SetupPage() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isEditing = Boolean(state.organization);
  const [displayName, setDisplayName] = useState(state.organization?.displayName ?? "");
  const [timezone, setTimezone] = useState(state.organization?.timezone ?? "Europe/Moscow");
  const [accountingStartDate, setAccountingStartDate] = useState(
    state.accountingPolicy?.accountingStartDate || defaultStartDate()
  );
  const [inventoryStartMode, setInventoryStartMode] = useState<"opening_balance" | "documented_flow">("opening_balance");

  useEffect(() => {
    if (state.organization?.displayName) setDisplayName(state.organization.displayName);
  }, [state.organization?.displayName]);
  useEffect(() => {
    if (state.accountingPolicy?.accountingStartDate) {
      setAccountingStartDate(state.accountingPolicy.accountingStartDate);
    }
  }, [state.accountingPolicy?.accountingStartDate]);

  const orgValid = displayName.trim().length > 0;
  const startValid = Boolean(accountingStartDate);
  const canSubmit = orgValid && startValid;

  const setupMutation = useMutation({
    mutationFn: () =>
      apiPut("/api/setup", {
        displayName: displayName.trim(),
        timezone,
        accountingStartDate
      }),
	    onSuccess: () => {
	      queryClient.invalidateQueries();
	      if (isEditing) {
	        navigate("/settings");
	        return;
	      }
	      const params = new URLSearchParams({
	        from: "setup",
	        mode: "historical_backfill",
	        inventoryStartMode,
	        start: accountingStartDate
	      });
	      navigate(`/setup/existing-store?${params.toString()}`);
	    }
	  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5">
      <PageHeader
        title={isEditing ? "Параметры кабинета" : "Настройка кабинета"}
        subtitle="Название организации и дата старта учёта — этого достаточно, чтобы начать."
        breadcrumbs={[{ label: "Настройки", to: "/settings" }, { label: isEditing ? "Параметры кабинета" : "Настройка кабинета" }]}
      />

      <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Организация</CardTitle>
                <CardDescription>Учётный контур, который станет источником учётной правды</CardDescription>
              </div>
              <Building2 size={22} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Название организации" required>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ИП Иванов И. И." />
              </Field>
              <Field label="Часовой пояс">
                <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Валюта учёта">
                <Input value="RUB · ₽" disabled readOnly />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Старт учёта</CardTitle>
                <CardDescription>Дата старта задаёт границу: раньше неё документы вводить нельзя</CardDescription>
              </div>
              <CalendarDays size={22} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Дата старта учёта" required>
	                <Input
	                  type="date"
	                  value={accountingStartDate}
	                  onChange={(e) => setAccountingStartDate(e.target.value)}
	                  invalid={!accountingStartDate}
	                />
	              </Field>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
	                {inventoryStartMode === "documented_flow"
	                  ? "Эта дата останется границей учёта. Стартовые партии и складские проводки мастер не создаёт."
	                  : "На эту дату будет создана стартовая партия. Продажи и возвраты после неё мастер подтянет из Ozon и проведёт по введённой себестоимости."}
              </div>
              {!accountingStartDate && (
                <div className="md:col-span-2 text-[11px] text-[var(--color-danger)]">
	                  Укажите дату старта учёта
	                </div>
	              )}
	            </CardContent>
	          </Card>

          {!isEditing && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Как завести остатки канала</CardTitle>
                  <CardDescription>Выберите, что мастер сделает после подключения Ozon</CardDescription>
                </div>
                <PackageCheck size={22} className="text-[var(--color-muted-foreground)]" />
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setInventoryStartMode("opening_balance")}
                  aria-pressed={inventoryStartMode === "opening_balance"}
                  className={[
                    "rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
                    inventoryStartMode === "opening_balance"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                      : "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]"
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <PackageCheck size={16} className={inventoryStartMode === "opening_balance" ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"} />
                    Быстрый старт по себестоимости
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                    MPFlow загрузит текущие остатки, попросит себестоимость и создаст стартовые партии для учёта.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryStartMode("documented_flow")}
                  aria-pressed={inventoryStartMode === "documented_flow"}
                  className={[
                    "rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
                    inventoryStartMode === "documented_flow"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                      : "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]"
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <FileText size={16} className={inventoryStartMode === "documented_flow" ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"} />
                    Заполню поставки и перемещения
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                    MPFlow сопоставит карточки, но не попросит себестоимость и не создаст складские проводки.
                  </span>
                </button>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" asChild>
              <Link to={isEditing ? "/settings" : "/"}>
                <ArrowLeft size={14} /> {isEditing ? "К настройкам" : "На главную"}
              </Link>
            </Button>
            <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending || !canSubmit}>
              {setupMutation.isPending
                ? "Сохраняем…"
                : isEditing
                  ? <>Сохранить изменения <Sparkles size={14} /></>
                  : <>Создать кабинет <Sparkles size={14} /></>}
            </Button>
          </div>

          {setupMutation.isError && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
              {(setupMutation.error as Error).message}
            </div>
          )}
      </div>
    </div>
  );
}

function defaultStartDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
