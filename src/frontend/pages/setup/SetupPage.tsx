import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  History,
  Layers,
  PackageCheck,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CheckLabel } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { apiPut } from "@/api";
import { useAppState } from "@/lib/use-app-state";
import { cn } from "@/lib/cn";

type StepKey = "org" | "mode" | "start" | "review";
type StartMode = "from_scratch" | "existing_store";
type ExistingStoreMode = "current_stock_start" | "historical_backfill";

const START_MODE_OPTIONS: Array<{ value: StartMode; title: string; desc: string; meta: string; icon: ReactNode }> = [
  {
    value: "from_scratch",
    title: "Учёт с нуля",
    desc: "Подходит новой организации или магазину с полной историей закупок и операций.",
    meta: "После создания откроем закупки",
    icon: <Building2 size={18} />
  },
  {
    value: "existing_store",
    title: "Уже работающий магазин",
    desc: "Подходит, когда есть Ozon, текущие остатки и нужно завести их себестоимость.",
    meta: "После создания откроем мастер остатков",
    icon: <PackageCheck size={18} />
  }
];

const EXISTING_STORE_MODE_OPTIONS: Array<{ value: ExistingStoreMode; title: string; desc: string; icon: ReactNode }> = [
  {
    value: "current_stock_start",
    title: "С текущего момента",
    desc: "Фиксируем остатки и себестоимость на дату старта, дальше учитываем новые события.",
    icon: <PackageCheck size={18} />
  },
  {
    value: "historical_backfill",
    title: "С историей продаж",
    desc: "Используем дату в прошлом и готовим импорт истории после настройки канала.",
    icon: <History size={18} />
  }
];

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
  const location = useLocation();
  const queryClient = useQueryClient();

  const initialSearchParams = new URLSearchParams(location.search);
  const queryStep = initialSearchParams.get("step");
  const queryMode = initialSearchParams.get("mode");
  const queryEstoreMode = initialSearchParams.get("estoreMode");
  const queryStart = initialSearchParams.get("start");
  const queryConfirmed = initialSearchParams.get("confirmed") === "1";
  const initialStep: StepKey = location.pathname.endsWith("/review")
    ? "review"
    : queryStep === "mode" || queryStep === "start" || queryStep === "review"
    ? queryStep
    : "org";
  const initialStartMode: StartMode = queryMode === "existing_store" ? "existing_store" : "from_scratch";
  const initialExistingStoreMode: ExistingStoreMode = queryEstoreMode === "historical_backfill" ? "historical_backfill" : "current_stock_start";

  const [step, setStep] = useState<StepKey>(initialStep);
  const [displayName, setDisplayName] = useState(state.organization?.displayName ?? "");
  const [timezone, setTimezone] = useState(state.organization?.timezone ?? "Europe/Moscow");
  const [startMode, setStartMode] = useState<StartMode>(initialStartMode);
  const [existingStoreMode, setExistingStoreMode] = useState<ExistingStoreMode>(initialExistingStoreMode);
  const [accountingStartDate, setAccountingStartDate] = useState(queryStart || state.accountingPolicy?.accountingStartDate || defaultStartDate());
  const [confirmHistorical, setConfirmHistorical] = useState(queryConfirmed);

  useEffect(() => {
    if (state.organization?.displayName) setDisplayName(state.organization.displayName);
  }, [state.organization?.displayName]);
  useEffect(() => {
    setStep((current) => {
      if (location.pathname.endsWith("/review")) return "review";
      const fromQuery = new URLSearchParams(location.search).get("step");
      if (fromQuery === "org" || fromQuery === "mode" || fromQuery === "start" || fromQuery === "review") {
        return fromQuery;
      }
      return current === "review" ? "start" : current;
    });
  }, [location.pathname, location.search]);

  const today = new Date();
  const startDateObj = useMemo(() => (accountingStartDate ? new Date(accountingStartDate) : null), [accountingStartDate]);
  const isHistorical = startDateObj
    ? startDateObj < new Date(today.getFullYear(), today.getMonth(), 1)
    : false;
  const isExistingStore = startMode === "existing_store";
  const isCurrentStockStart = isExistingStore && existingStoreMode === "current_stock_start";
  const effectiveAccountingStartDate = isCurrentStockStart ? (state.accountingPolicy?.accountingStartDate ?? todayDate()) : accountingStartDate;
  const steps = useMemo(() => {
    const baseSteps = [
      { key: "org" as const, title: "Кабинет", desc: "Название и часовой пояс" },
      { key: "mode" as const, title: "Сценарий", desc: "Как запускаем учёт" }
    ];
    if (isExistingStore) {
      return existingStoreMode === "historical_backfill"
        ? [...baseSteps, { key: "start" as const, title: "История", desc: "Дата начала истории" }]
        : baseSteps;
    }
    return [
      ...baseSteps,
      { key: "start" as const, title: "Старт учёта", desc: "Дата начала работы" },
      { key: "review" as const, title: "Проверка", desc: "Создаём учётную базу" }
    ];
  }, [existingStoreMode, isExistingStore]);
  useEffect(() => {
    if (steps.some((candidate) => candidate.key === step)) return;
    setStep(steps.at(-1)?.key ?? "org");
  }, [step, steps]);

  const orgValid = displayName.trim().length > 0;
  const startValid = isCurrentStockStart || (Boolean(accountingStartDate) && (!isHistorical || confirmHistorical));
  const previewPeriods = useMemo(() => buildPreviewPeriods(effectiveAccountingStartDate, 12), [effectiveAccountingStartDate]);
  const selectedStartMode = START_MODE_OPTIONS.find((option) => option.value === startMode) ?? START_MODE_OPTIONS[0];
  const selectedExistingStoreMode = EXISTING_STORE_MODE_OPTIONS.find((option) => option.value === existingStoreMode) ?? EXISTING_STORE_MODE_OPTIONS[0];
  const nextPath = startMode === "existing_store"
    ? `/setup/existing-store?from=setup&mode=${existingStoreMode}${existingStoreMode === "historical_backfill" ? `&start=${accountingStartDate}${confirmHistorical ? "&confirmed=1" : ""}` : ""}`
    : "/procurement";
  const reviewBlocked = !orgValid || !startValid;

  const setupMutation = useMutation({
    mutationFn: () =>
      apiPut("/api/setup", {
        displayName: displayName.trim(),
        timezone,
        accountingStartDate: effectiveAccountingStartDate,
        confirmHistoricalStart: confirmHistorical
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate(nextPath);
    }
  });

  const stepIndex = steps.findIndex((s) => s.key === step);
  const isLastStep = stepIndex === steps.length - 1;

  function isStepComplete(key: StepKey) {
    if (key === "org") return orgValid;
    if (key === "mode") return orgValid;
    if (key === "start") return startValid;
    return orgValid && startValid;
  }

  function canEnterStep(targetIndex: number) {
    if (targetIndex <= stepIndex) return true;
    return steps.slice(0, targetIndex).every((candidate) => isStepComplete(candidate.key));
  }

  const buildSetupUrl = (target: StepKey) => {
    const params = new URLSearchParams();
    if (target !== "org") params.set("step", target);
    if (startMode === "existing_store") {
      params.set("mode", startMode);
      params.set("estoreMode", existingStoreMode);
      if (existingStoreMode === "historical_backfill" && accountingStartDate) {
        params.set("start", accountingStartDate);
        if (confirmHistorical) params.set("confirmed", "1");
      }
    }
    const search = params.toString();
    const pathname = target === "review" ? "/setup/review" : "/setup";
    return search ? `${pathname}?${search}` : pathname;
  };

  function goNext() {
    if (step === "org" && !orgValid) return;
    if (step === "start" && !startValid) return;
    const next = steps[stepIndex + 1];
    if (!next) {
      if (isExistingStore) setupMutation.mutate();
      return;
    }
    setStep(next.key);
    navigate(buildSetupUrl(next.key), { replace: true });
  }

  function goPrev() {
    const prev = steps[stepIndex - 1];
    if (!prev) return;
    setStep(prev.key);
    navigate(buildSetupUrl(prev.key), { replace: true });
  }

  function goToStep(target: StepKey) {
    setStep(target);
    navigate(buildSetupUrl(target), { replace: true });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Первичная настройка учета"
        subtitle="Создаём кабинет и выбираем, с какой точки начинать управленческий учёт"
        breadcrumbs={[{ label: "Настройки", to: "/settings" }, { label: "Первичная настройка" }]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_300px] gap-5">
        {/* Wizard rail */}
        <Card className="h-fit sticky top-20">
          <CardContent className="flex flex-col gap-2 px-2 py-2">
            {steps.map((s, i) => {
              const isActive = s.key === step;
              const isDone = i < stepIndex;
              const isAvailable = canEnterStep(i);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    if (isAvailable) goToStep(s.key);
                  }}
                  disabled={!isAvailable}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-[var(--radius-md)] text-left transition-colors",
                    isActive && "bg-[var(--color-primary-soft)]",
                    !isActive && isAvailable && "hover:bg-[var(--color-muted)]",
                    !isAvailable && "cursor-not-allowed opacity-55"
                  )}
                >
                  <div
                    className={cn(
                      "size-7 rounded-full grid place-items-center text-xs font-semibold shrink-0",
                      isDone
                        ? "bg-[var(--color-success)] text-white"
                        : isActive
                        ? "bg-[var(--color-primary)] text-white"
                        : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border-strong)]"
                    )}
                  >
                    {isDone ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className={cn("text-sm font-semibold", isActive && "text-[var(--color-primary)]")}>
                      {s.title}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)]">{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Main panel */}
        <div className="flex flex-col gap-5">
          {step === "org" && (
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
          )}

          {step === "mode" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Сценарий запуска</CardTitle>
                  <CardDescription>Выберите ближайшую реальную ситуацию магазина</CardDescription>
                </div>
                <PackageCheck size={22} className="text-[var(--color-muted-foreground)]" />
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {START_MODE_OPTIONS.map((option) => (
                    <ChoiceCard
                      key={option.value}
                      active={startMode === option.value}
                      icon={option.icon}
                      title={option.title}
                      desc={option.desc}
                      meta={option.meta}
                      onClick={() => setStartMode(option.value)}
                    />
                  ))}
                </div>

                {startMode === "existing_store" && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                    <div className="text-sm font-semibold">Как завести работающий магазин</div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {EXISTING_STORE_MODE_OPTIONS.map((option) => (
                        <ChoiceCard
                          key={option.value}
                          active={existingStoreMode === option.value}
                          icon={option.icon}
                          title={option.title}
                          desc={option.desc}
                          onClick={() => setExistingStoreMode(option.value)}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {step === "start" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{isExistingStore ? (existingStoreMode === "historical_backfill" ? "Дата начала истории" : "Подключение магазина") : "Старт учёта"}</CardTitle>
                  <CardDescription>
                    {isExistingStore
                      ? existingStoreMode === "historical_backfill"
                        ? "Дата нужна только если нужно подтянуть прошлые продажи и построить исторические отчёты"
                        : "Для текущих остатков дата не вводится: мастер сделает снимок магазина после подключения канала"
                      : "Дата старта задаёт границу, с которой вы начинаете вводить документы"}
                  </CardDescription>
                </div>
                {isCurrentStockStart ? <PackageCheck size={22} className="text-[var(--color-muted-foreground)]" /> : <CalendarDays size={22} className="text-[var(--color-muted-foreground)]" />}
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isCurrentStockStart ? (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                    <div className="text-sm font-semibold">Что потребуется дальше</div>
                    <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted-foreground)] leading-relaxed">
                      <li>Подключить канал Ozon и дать доступы API.</li>
                      <li>Дождаться автоматической загрузки карточек и текущих остатков.</li>
                      <li>Для каждой карточки выбрать существующий товар или создать новый, затем указать себестоимость остатка.</li>
                    </ul>
                    <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-sm">
                      Дату вводить не нужно: стартовый остаток будет зафиксирован как текущий снимок магазина.
                    </div>
                  </div>
                ) : (
                  <>
                    <Field label={isExistingStore ? "Дата начала истории" : "Дата старта учета"} required>
                      <Input
                        type="date"
                        value={accountingStartDate}
                        onChange={(e) => {
                          setAccountingStartDate(e.target.value);
                          setConfirmHistorical(false);
                        }}
                        invalid={!accountingStartDate}
                      />
                    </Field>
                    {!accountingStartDate && (
                      <div className="md:col-span-2 text-[11px] text-[var(--color-danger)]">
                        Укажите дату, прежде чем переходить к проверке
                      </div>
                    )}
                    {isHistorical && (
                      <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[oklch(0.85_0.1_70)] bg-[var(--color-warning-soft)] p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle size={18} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{isExistingStore ? "Дата истории далеко в прошлом" : "Старая дата старта"}</p>
                            <p className="text-xs text-[var(--color-foreground)]/75 mt-1 leading-relaxed">
                              {isExistingStore
                                ? "Чем дальше дата в прошлом, тем выше риск, что маркетплейс вернет неполную историю операций."
                                : "Операции после этой даты нужно будет ввести вручную. Иначе отчёты за промежуток будут неполными."}
                            </p>
                            <div className="mt-3">
                              <CheckLabel
                                checked={confirmHistorical}
                                onCheckedChange={setConfirmHistorical}
                                label={isExistingStore ? "Я понимаю риск неполной истории и хочу продолжить" : "Я понимаю, что отчёты до сегодняшнего дня будут неполными без ввода истории"}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {step === "review" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Проверка и создание</CardTitle>
                  <CardDescription>Будут созданы кабинет и базовые настройки учёта. Дальше откроется следующий рабочий шаг.</CardDescription>
                </div>
                <Layers size={22} className="text-[var(--color-muted-foreground)]" />
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reviewBlocked && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm">
                    Вернитесь к предыдущим шагам и заполните обязательные поля. Для исторической даты нужно явно подтвердить риск неполной истории.
                  </div>
                )}
                <ReviewRow label="Организация" value={displayName || "—"} />
                <ReviewRow label="Часовой пояс" value={timezoneLabel(timezone)} />
                <ReviewRow label="Сценарий запуска" value={selectedStartMode.title} hint={selectedStartMode.meta} />
                {startMode === "existing_store" && (
                  <ReviewRow label="Режим магазина" value={selectedExistingStoreMode.title} />
                )}
                {isCurrentStockStart ? (
                  <ReviewRow label="Следующий шаг" value="Подключить Ozon и загрузить текущие остатки" />
                ) : (
                  <ReviewRow
                    label={isExistingStore ? "Дата начала истории" : "Старт учёта"}
                    value={accountingStartDate}
                    hint={isHistorical ? "Историческая дата" : "В пределах месяца"}
                  />
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {step !== "org" ? (
                <Button variant="ghost" onClick={goPrev}>
                  <ArrowLeft size={14} /> Назад
                </Button>
              ) : (
                <Button variant="ghost" asChild>
                  <Link to="/">
                    <ArrowLeft size={14} /> На главную
                  </Link>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isLastStep ? (
                <Button
                  onClick={goNext}
                  disabled={
                    (step === "org" && !orgValid) ||
                    (step === "start" && !startValid)
                  }
                >
                  {step === "start" ? "Проверить настройки" : "Далее"} <ArrowRight size={14} />
                </Button>
              ) : step !== "review" ? (
                <Button
                  onClick={goNext}
                  disabled={setupMutation.isPending || (step === "org" && !orgValid) || (step === "start" && !startValid)}
                >
                  {setupMutation.isPending ? "Создаем…" : <>Создать кабинет и перейти к Ozon <Sparkles size={14} /></>}
                </Button>
              ) : (
                <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending || reviewBlocked}>
                  {setupMutation.isPending
                    ? "Создаем…"
                    : isExistingStore
                      ? <>Создать кабинет и подключить Ozon <Sparkles size={14} /></>
                      : <>Создать учетную базу <Sparkles size={14} /></>}
                </Button>
              )}
            </div>
          </div>

          {setupMutation.isError && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
              {(setupMutation.error as Error).message}
            </div>
          )}
        </div>

        <aside className="hidden xl:flex xl:flex-col xl:gap-5">
          <Card className="h-fit sticky top-20">
            <CardHeader>
              <div>
                <CardTitle>Что готовим</CardTitle>
                <CardDescription>Заполненные шаги</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <SummaryItem label="Организация" value={displayName || "—"} />
              <SummaryItem label="Часовой пояс" value={timezoneLabel(timezone)} />
              {step !== "org" && <SummaryItem label="Сценарий" value={selectedStartMode.title} />}
              {step !== "org" && startMode === "existing_store" && (
                <SummaryItem label="Режим магазина" value={selectedExistingStoreMode.title} />
              )}
              {(step === "start" || step === "review") && (
                <SummaryItem
                  label={isCurrentStockStart ? "Следующий шаг" : isExistingStore ? "Дата истории" : "Старт учёта"}
                  value={isCurrentStockStart ? "Канал Ozon" : (accountingStartDate || "—")}
                />
              )}
              {step === "review" && !isCurrentStockStart && (
                <SummaryItem label="Рабочий диапазон" value={previewPeriods.length > 0 ? `${previewPeriods[0]} — ${previewPeriods.at(-1)}` : "—"} />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ChoiceCard({
  active,
  icon,
  title,
  desc,
  meta,
  compact,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  desc: string;
  meta?: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-[var(--radius-md)] border transition-colors",
        compact ? "p-3" : "p-4",
        active ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] border",
            active
              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)]"
          )}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted-foreground)]">{desc}</span>
          {meta && <Badge tone="neutral" size="sm" className="mt-2">{meta}</Badge>}
        </span>
      </div>
    </button>
  );
}

function ReviewRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] font-semibold">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
      {hint && <Badge tone="neutral" size="sm" className="mt-1.5">{hint}</Badge>}
    </div>
  );
}

function defaultStartDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function timezoneLabel(value: string): string {
  return TIMEZONES.find((tz) => tz.value === value)?.label ?? value;
}

function buildPreviewPeriods(startDate: string, count: number) {
  if (!startDate) return [];
  const [year, month] = startDate.split("-").map(Number);
  if (!year || !month) return [];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1 + index, 1);
    return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  });
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] font-semibold">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
