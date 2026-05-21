import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  PackageCheck,
  Plus,
  Save,
  Sparkles
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckLabel } from "@/components/ui/checkbox";
import { ProductThumb } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiGet, apiPatch, apiPost } from "@/api";
import { qty, rub } from "@/lib/format";

const today = () => new Date().toISOString().slice(0, 10);
const CURRENT_STOCK_STEPS = [
  { key: "start", label: "Канал Ozon", desc: "Подключение магазина" },
  { key: "mapping", label: "Сопоставление и цена", desc: "Карточки и себестоимость" },
  { key: "review", label: "Проверка и документы", desc: "Стартовый остаток" }
] as const;
const HISTORICAL_STEPS = [
  { key: "start", label: "Канал Ozon", desc: "Подключение магазина" },
  { key: "date", label: "Дата начала истории", desc: "Граница импорта" },
  { key: "mapping", label: "Сопоставление и цена", desc: "Карточки и себестоимость" },
  { key: "review", label: "Проверка и документы", desc: "Стартовый остаток" }
] as const;
type WizardStepKey = (typeof HISTORICAL_STEPS)[number]["key"];

export function BackfillWizardPage() {
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const modeFromSetup = searchParams.get("mode") === "historical_backfill" ? "historical_backfill" : searchParams.get("mode") === "current_stock_start" ? "current_stock_start" : undefined;
  const startFromSetup = searchParams.get("start") || undefined;
  const projectIdFromQuery = searchParams.get("projectId") || undefined;
  const inSetupNamespace = location.pathname.startsWith("/setup/existing-store");
  const setupContinuation = inSetupNamespace || searchParams.get("from") === "setup";
  const modeLocked = setupContinuation;
  const historyDateLocked = setupContinuation && Boolean(startFromSetup);
  const confirmedFromSetup = searchParams.get("confirmed") === "1";
  const returnTo = `${location.pathname}${location.search}`;
  const createChannelPath = `/integrations/channels/new?returnTo=${encodeURIComponent(returnTo)}`;
  const channels = (state.salesChannels ?? []).filter((channel: any) => channel.status !== "disabled");
  const selectedProducts = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const latestProject = (state.backfillProjects ?? []).slice().sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(projectIdFromQuery ?? latestProject?.id ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState(latestProject?.payload?.salesChannelId ? String(latestProject.payload.salesChannelId) : (channels[0]?.id ?? ""));
  const [mode, setMode] = useState<"current_stock_start" | "historical_backfill">(
    modeFromSetup ?? (latestProject?.payload?.mode === "historical_backfill" ? "historical_backfill" : "current_stock_start")
  );
  const [accountingStartDate, setAccountingStartDate] = useState(
    String(startFromSetup ?? latestProject?.payload?.accountingStartDate ?? state.accountingPolicy?.accountingStartDate ?? today())
  );
  const [confirmHistoricalRisk, setConfirmHistoricalRisk] = useState(Boolean(confirmedFromSetup || latestProject?.payload?.confirmHistoricalRisk));
  const [autoImportKey, setAutoImportKey] = useState("");
  const firstChannelId = channels[0]?.id ?? "";
  const steps = useMemo(() => {
    const sourceSteps = mode === "historical_backfill" && !historyDateLocked ? HISTORICAL_STEPS : CURRENT_STOCK_STEPS;
    return sourceSteps.map((stepDefinition) =>
      stepDefinition.key === "start" && modeLocked
        ? { ...stepDefinition, label: "Канал Ozon", desc: "Подключение магазина" }
        : stepDefinition
    );
  }, [historyDateLocked, mode, modeLocked]);
  const currentStep = steps[step]?.key ?? "start";
  const stepIndexByKey = (key: WizardStepKey) => steps.findIndex((candidate) => candidate.key === key);
  const goToStep = (key: WizardStepKey) => {
    const index = stepIndexByKey(key);
    if (index >= 0) setStep(index);
  };

  const projectMatchesSelection = (project: any) => {
    if (!project) return false;
    if (projectIdFromQuery && project.id === projectIdFromQuery) return true;
    if (!salesChannelId) return false;
    const payload = project.payload ?? {};
    if (payload.salesChannelId !== salesChannelId) return false;
    if (modeFromSetup && payload.mode !== mode) return false;
    if (modeFromSetup && mode === "historical_backfill" && payload.accountingStartDate !== accountingStartDate) return false;
    return true;
  };

  useEffect(() => {
    if (!salesChannelId && firstChannelId) setSalesChannelId(firstChannelId);
  }, [firstChannelId, salesChannelId]);

  useEffect(() => {
    if (step >= steps.length) setStep(Math.max(0, steps.length - 1));
  }, [step, steps.length]);

  const projectQuery = useQuery({
    queryKey: ["backfill-project", projectId],
    queryFn: () => apiGet<any>(`/api/onboarding/existing-store/projects/${projectId}`),
    enabled: Boolean(projectId)
  });
  const patchItem = useMutation({
    mutationFn: ({ itemId, payload, status }: { itemId: string; payload?: Record<string, unknown>; status?: string }) => {
      if (!projectId) throw new Error("Проект онбординга не найден");
      return apiPatch(`/api/onboarding/existing-store/projects/${projectId}/items/${itemId}`, { payload, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backfill-project", projectId] });
      queryClient.invalidateQueries();
    }
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("Проект онбординга не найден");
      return apiPost<any>(`/api/onboarding/existing-store/projects/${projectId}/create-opening-balances`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    }
  });

  const ensureProject = useMutation({
    mutationFn: async () => {
      const existingProject = projectId
        ? (projectQuery.data?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
        : undefined;
      if (projectMatchesSelection(existingProject)) return projectId as string;
      const project = await apiPost<any>("/api/onboarding/existing-store/projects", {
        name: `Старт учета ${channels.find((channel: any) => channel.id === salesChannelId)?.name ?? "магазина"}`,
        payload: {
          salesChannelId,
          mode,
          accountingStartDate: mode === "historical_backfill" ? accountingStartDate : (state.accountingPolicy?.accountingStartDate ?? today()),
          confirmHistoricalRisk
        }
      });
      setProjectId(project.id);
      return String(project.id);
    }
  });
  const importData = useMutation({
    mutationFn: async () => {
      const id = await ensureProject.mutateAsync();
      const syncRun = await apiPost<any>(`/api/integrations/channels/${salesChannelId}/sync-runs`, {
        streams: ["products", "stocks"],
        mode: "full"
      });
      if (syncRun.status !== "completed") {
        const errors = Array.isArray(syncRun.errors) ? syncRun.errors.filter(Boolean) : [];
        throw new Error(errors[0] ?? "Не удалось синхронизировать карточки и остатки Ozon");
      }
      await apiPost(`/api/onboarding/existing-store/projects/${id}/import`);
      const matched = await apiPost<any>(`/api/onboarding/existing-store/projects/${id}/match-products`);
      const project = await apiGet<any>(`/api/onboarding/existing-store/projects/${id}`);
      return { id, matched, project };
    },
    onSuccess: async ({ id, project }) => {
      await queryClient.invalidateQueries({ queryKey: ["backfill-project", id] });
      await queryClient.invalidateQueries();
      setProjectId(id);
      const importedItems = project?.items?.length ?? 0;
      if (importedItems > 0) goToStep("mapping");
    }
  });

  const currentData = projectQuery.data;
  const items = currentData?.items ?? [];
  const summary = currentData?.summary ?? latestProject?.payload?.summary ?? { mapped: 0, unmatched: 0, missingCost: 0, totalQty: 0, totalCost: 0, warnings: [] };
  const blockingIssues = useMemo(() => {
    return items.filter((item: any) => item.status === "needs_mapping" || item.status === "needs_cost");
  }, [items]);
  const selectedItem = items.find((item: any) => item.id === selectedItemId) ?? items[0];
  const oldRiskDays = Math.floor((Date.now() - new Date(accountingStartDate).getTime()) / 86_400_000);
  const hasOldDateRisk = oldRiskDays > 90 && mode === "historical_backfill";
  const selectedProject = projectId
    ? (currentData?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
    : undefined;
  const importKey = `${salesChannelId}|${mode}|${mode === "historical_backfill" ? accountingStartDate : "current"}`;
  const stepValid: Record<WizardStepKey, boolean> = {
    start: Boolean(salesChannelId && mode && !importData.isPending && (items.length > 0 || importData.isSuccess)),
    date: Boolean(accountingStartDate && (!hasOldDateRisk || confirmHistoricalRisk) && !importData.isPending && (items.length > 0 || importData.isSuccess)),
    mapping: items.length > 0 && Number(summary.unmatched ?? 0) === 0 && Number(summary.missingCost ?? 0) === 0,
    review: Boolean(projectId) && items.length > 0 && Number(summary.unmatched ?? 0) === 0 && Number(summary.missingCost ?? 0) === 0
  };

  useEffect(() => {
    if (!projectId) return;
    if (projectQuery.isLoading) return;
    const existingProject = currentData?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId);
    if (existingProject && !projectMatchesSelection(existingProject)) setProjectId(null);
  }, [projectId, projectQuery.isLoading, currentData?.project, state.backfillProjects, salesChannelId, mode, accountingStartDate]);

  useEffect(() => {
    const project = currentData?.project;
    if (!project || modeFromSetup) return;
    const payload = project.payload ?? {};
    if (payload.mode === "historical_backfill" || payload.mode === "current_stock_start") {
      setMode(payload.mode);
    }
    if (typeof payload.accountingStartDate === "string") setAccountingStartDate(payload.accountingStartDate);
    if (payload.salesChannelId) setSalesChannelId(String(payload.salesChannelId));
  }, [currentData?.project, modeFromSetup]);

  useEffect(() => {
    if (!salesChannelId) return;
    if (mode === "historical_backfill" && (!accountingStartDate || hasOldDateRisk && !confirmHistoricalRisk)) return;
    if (projectId && projectQuery.isLoading) return;
    if (items.length > 0 && projectMatchesSelection(selectedProject)) return;
    if (importData.isPending || ensureProject.isPending) return;
    if (autoImportKey === importKey) return;
    setAutoImportKey(importKey);
    importData.mutate();
  }, [
    salesChannelId,
    mode,
    accountingStartDate,
    confirmHistoricalRisk,
    hasOldDateRisk,
    projectId,
    projectQuery.isLoading,
    items.length,
    autoImportKey,
    importKey,
    importData.isPending,
    ensureProject.isPending,
    selectedProject
  ]);

  const downloadIssues = () => {
    const content = blockingIssues.map((item: any) => {
      const payload = item.payload ?? {};
      return [
        `Строка: ${item.id}`,
        `SKU: ${payload.externalSku ?? "—"}`,
        `Название: ${payload.externalName ?? "—"}`,
        `Проблема: ${statusLabel(item.status)}`
      ].join("\n");
    }).join("\n\n");
    const blob = new Blob([content || "Проблем не найдено"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `backfill-issues-${projectId ?? "project"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveAndExit = async () => {
    const id = await ensureProject.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: ["backfill-project", id] });
    navigate(setupContinuation ? "/settings" : "/inventory");
  };
  const setupReturnQuery = (() => {
    const params = new URLSearchParams();
    params.set("mode", "existing_store");
    params.set("estoreMode", mode);
    if (mode === "historical_backfill" && accountingStartDate) {
      params.set("start", accountingStartDate);
      if (confirmHistoricalRisk) params.set("confirmed", "1");
    }
    return params.toString();
  })();
  const goToSetupStep = (target: "org" | "mode" | "start") => {
    const params = new URLSearchParams(setupReturnQuery);
    if (target !== "org") params.set("step", target);
    navigate(`/setup?${params.toString()}`);
  };
  const pageTitle = setupContinuation ? "Первичная настройка учета" : "Старт работающего магазина";
  const pageSubtitle = setupContinuation
    ? "Подключите Ozon, загрузите карточки и остатки, сопоставьте товары и создайте стартовые документы."
    : "Импортируйте карточки и остатки из канала, заполните себестоимость и создайте стартовые документы без ручного пересоздания каталога.";
  const pageBreadcrumbs = setupContinuation
    ? [{ label: "Первичная настройка", to: `/setup?${setupReturnQuery}` }, { label: "Подключение Ozon" }]
    : [{ label: "Главная", to: "/" }, { label: "Старт работающего магазина" }];
  const setupRailPrefix = setupContinuation
    ? [
        {
          key: "org" as const,
          label: "Кабинет",
          desc: state.organization?.displayName ?? "Создан",
          onClick: () => goToSetupStep("org")
        },
        {
          key: "mode" as const,
          label: "Сценарий",
          desc: mode === "historical_backfill" ? "С историей продаж" : "С текущих остатков",
          onClick: () => goToSetupStep("mode")
        },
        ...(historyDateLocked
          ? [
              {
                key: "start" as const,
                label: "Дата истории",
                desc: accountingStartDate,
                onClick: () => goToSetupStep("start")
              }
            ]
          : [])
      ]
    : [];
  const stepNumberOffset = setupRailPrefix.length;

  return (
    <div className={`mx-auto flex flex-col gap-5 ${setupContinuation ? "max-w-[88rem]" : "max-w-7xl"}`}>
      <PageHeader
        breadcrumbs={pageBreadcrumbs}
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to={setupContinuation ? `/setup${historyDateLocked ? `?${setupReturnQuery}&step=start` : `?${setupReturnQuery}&step=mode`}` : "/inventory"}>
                <ArrowLeft size={14} /> Назад
              </Link>
            </Button>
            <Button variant="secondary" onClick={saveAndExit} disabled={ensureProject.isPending}><Save size={14} /> Сохранить и выйти</Button>
          </>
        }
      />

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-stretch gap-2">
            {setupRailPrefix.map((prefixStep, idx) => (
              <button
                key={prefixStep.key}
                type="button"
                onClick={prefixStep.onClick}
                className="group flex flex-1 min-w-[160px] items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-success-soft)]/70"
                title="Вернуться к этому шагу настройки"
              >
                <div className="size-7 rounded-full grid place-items-center text-xs font-semibold shrink-0 bg-[var(--color-success)] text-white">
                  <CheckCircle2 size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Шаг {idx + 1}</div>
                  <div className="text-sm font-medium leading-snug truncate">{prefixStep.label}</div>
                </div>
              </button>
            ))}
            {steps.map((stepDefinition, index) => {
              const previousStep = steps[index - 1];
              const isDone = index < step;
              const isActive = index === step;
              const canOpen = index <= step || index === 0 || Boolean(previousStep && stepValid[previousStep.key]);
              return (
                <button
                  key={stepDefinition.key}
                  type="button"
                  onClick={() => {
                    if (canOpen) setStep(index);
                  }}
                  disabled={!canOpen}
                  className={[
                    "flex flex-1 min-w-[160px] items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors",
                    isActive && "border-[var(--color-primary)] bg-[var(--color-primary-soft)]",
                    isDone && "border-[var(--color-success)] bg-[var(--color-success-soft)]",
                    !isActive && !isDone && canOpen && "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]",
                    !canOpen && "border-[var(--color-border)] cursor-not-allowed opacity-55"
                  ].filter(Boolean).join(" ")}
                >
                  <div
                    className={[
                      "size-7 rounded-full grid place-items-center text-xs font-semibold shrink-0",
                      isDone
                        ? "bg-[var(--color-success)] text-white"
                        : isActive
                        ? "bg-[var(--color-primary)] text-white"
                        : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border-strong)]"
                    ].filter(Boolean).join(" ")}
                  >
                    {isDone ? <CheckCircle2 size={14} /> : stepNumberOffset + index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Шаг {stepNumberOffset + index + 1}</div>
                    <div className={`text-sm font-medium leading-snug truncate ${isActive ? "text-[var(--color-primary)]" : ""}`}>{stepDefinition.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {(hasOldDateRisk || (summary.unmatched ?? 0) > 0 || (summary.missingCost ?? 0) > 0 || (summary.warnings ?? []).length > 0) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium inline-flex items-center gap-2"><AlertTriangle size={14} className="text-[var(--color-warning)]" /> Что блокирует запуск:</span>
          {hasOldDateRisk && <span>дата истории далеко в прошлом</span>}
          {(summary.unmatched ?? 0) > 0 && <span>не сопоставлено карточек: {summary.unmatched}</span>}
          {(summary.missingCost ?? 0) > 0 && <span>без себестоимости: {summary.missingCost}</span>}
          {(summary.warnings ?? []).map((warning: string) => <span key={warning}>{warning}</span>)}
        </div>
      )}

      <div className="flex flex-col gap-5">
          {currentStep === "start" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{modeLocked ? "Канал Ozon" : "Канал и режим старта"}</CardTitle>
                  <CardDescription>{modeLocked ? "Подключите канал Ozon. Карточки и остатки загрузятся автоматически." : "Выберите канал Ozon и сценарий запуска. Карточки и остатки загрузятся автоматически."}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 py-5 md:grid-cols-2">
                <div className="md:col-span-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <Field label="Канал продаж" required>
                    <Select value={salesChannelId} onChange={(event) => setSalesChannelId(event.target.value)}>
                      <option value="">Выберите канал</option>
                      {channels.map((channel: any) => (
                        <option key={channel.id} value={channel.id}>{channel.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Button asChild variant={channels.length > 0 ? "secondary" : "primary"}>
                    <Link to={createChannelPath}>
                      <Plus size={14} /> Подключить канал
                    </Link>
                  </Button>
                </div>
                {channels.length === 0 && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4 text-sm leading-relaxed">
                    Для работающего магазина нужен канал Ozon: он даст карточки, остатки и последующие синхронизации. После создания канала вы вернётесь сюда и сможете продолжить мастер.
                  </div>
                )}
                {modeLocked ? (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed">
                    <div className="font-semibold">Режим уже выбран: {mode === "historical_backfill" ? "с историей продаж" : "с текущих остатков"}</div>
                    <div className="mt-1 text-[var(--color-muted-foreground)]">
                      {mode === "historical_backfill"
                        ? `История будет подтягиваться с ${accountingStartDate}.`
                        : "Дата не требуется: после подключения канала мастер загрузит текущие карточки и остатки."}
                    </div>
                  </div>
                ) : (
                  <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                    <ModeCard
                      active={mode === "current_stock_start"}
                      title="С текущих остатков"
                      desc="Берём текущие карточки и остатки. Отдельная дата не нужна: это снимок магазина на сейчас."
                      onClick={() => setMode("current_stock_start")}
                    />
                    <ModeCard
                      active={mode === "historical_backfill"}
                      title="С историей"
                      desc="Укажите дату, с которой нужно подтянуть прошлые события и построить исторические отчёты."
                      onClick={() => setMode("historical_backfill")}
                    />
                  </div>
                )}
                {salesChannelId && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed">
                    {importData.isPending || ensureProject.isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <PackageCheck size={14} /> Загружаем карточки и остатки из выбранного канала...
                      </span>
                    ) : items.length > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-[var(--color-success)]" /> Данные загружены. Можно переходить к сопоставлению товаров.
                      </span>
                    ) : importData.isSuccess ? (
                      <div className="flex flex-wrap items-center gap-2 text-[var(--color-warning)]">
                        <span className="inline-flex items-center gap-2">
                          <AlertTriangle size={14} /> По выбранному каналу не нашли карточки и остатки. Откройте канал и запустите синхронизацию карточек и остатков.
                        </span>
                        <Button variant="secondary" size="sm" asChild>
                          <Link to={`/integrations/channels/${salesChannelId}/sync`}>Открыть синхронизацию</Link>
                        </Button>
                      </div>
                    ) : importData.isError ? (
                      <span className="inline-flex items-center gap-2 text-[var(--color-danger)]">
                        <AlertTriangle size={14} /> Не удалось загрузить данные автоматически. Проверьте доступы канала.
                      </span>
                    ) : (
                      <span>После выбора канала мастер сам создаст проект и подтянет карточки с остатками.</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {currentStep === "date" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Дата начала истории</CardTitle>
                  <CardDescription>С этой даты мастер будет подтягивать прошлые события канала. Для старта с текущих остатков этот шаг не нужен.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 py-5 md:grid-cols-2">
                <Field label="Дата начала истории" required>
                  <Input type="date" value={accountingStartDate} onChange={(event) => setAccountingStartDate(event.target.value)} />
                </Field>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-sm">
                  <div className="font-medium">Что произойдет после выбора даты</div>
                  <ul className="mt-3 space-y-2 text-[var(--color-muted-foreground)] leading-relaxed">
                    <li>Мастер подтянет события канала начиная с {accountingStartDate || "выбранной даты"}.</li>
                    <li>Себестоимость можно будет применить к историческим продажам.</li>
                    <li>Чем дальше дата в прошлом, тем выше риск неполных данных от маркетплейса.</li>
                  </ul>
                </div>
                {hasOldDateRisk && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={16} className="mt-0.5 text-[var(--color-warning)] shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium">Дата начала истории далеко в прошлом</div>
                        <p className="mt-1 text-sm text-[var(--color-foreground)]/80">
                          Вы выбрали дату примерно {oldRiskDays} дней назад. Без исторического backfill отчеты после этой даты могут быть неполными.
                        </p>
                        <CheckLabel
                          className="mt-3"
                          checked={confirmHistoricalRisk}
                          onCheckedChange={(checked) => setConfirmHistoricalRisk(Boolean(checked))}
                          label="Я понимаю риск неполных отчетов и хочу продолжить с историей"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {currentStep === "mapping" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Сопоставление товаров и себестоимость</CardTitle>
                  <CardDescription>Для каждой карточки выберите внутренний товар (или создайте новый) и укажите себестоимость остатка за штуку.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Kpi tone="warning" label="Нужно сопоставить" value={summary.unmatched ?? 0} />
                  <Kpi tone="warning" label="Без себестоимости" value={summary.missingCost ?? 0} />
                  <Kpi tone="success" label="Готово к созданию" value={Math.max(0, (summary.mapped ?? 0) - (summary.missingCost ?? 0))} />
                  <Kpi tone="primary" label="Оценка стоимости" value={rub(summary.totalCost ?? 0)} hint={`${qty(summary.totalQty ?? 0)} в ${items.length} строках`} />
                </div>
                <BackfillItemsTable
                  items={items}
                  selectedItemId={selectedItem?.id}
                  selectedProducts={selectedProducts}
                  warehouses={warehouses}
                  onSelect={setSelectedItemId}
                  patchItem={patchItem}
                  maxRows={12}
                  emptyAction={<ImportFromOzonAction importData={importData} salesChannelId={salesChannelId} />}
                />
              </CardContent>
            </Card>
          )}

          {currentStep === "review" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Проверка и создание документов</CardTitle>
                  <CardDescription>Проверьте строки, блокирующие проблемы и создайте стартовые документы по складам.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <Kpi tone="success" label="Готовых строк" value={items.filter((item: any) => item.status === "ready" || item.status === "applied").length} />
                  <Kpi tone="warning" label="Блокеры" value={(summary.unmatched ?? 0) + (summary.missingCost ?? 0)} />
                  <Kpi tone="primary" label="Количество" value={qty(summary.totalQty ?? 0)} />
                  <Kpi tone="info" label="Стоимость" value={rub(summary.totalCost ?? 0)} />
                </div>
                {blockingIssues.length > 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4">
                    <div className="font-medium">Есть блокирующие строки</div>
                    <div className="mt-1 text-sm text-[var(--color-foreground)]/75">
                      Сначала сопоставьте товары и заполните себестоимость. Стартовые документы создаются только когда блокеров нет.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 flex items-center gap-3">
                    <CheckCircle2 size={16} className="text-[var(--color-success)]" />
                    <div className="text-sm">Блокеров нет. Можно создавать стартовые документы.</div>
                  </div>
                )}
                <BackfillItemsTable
                  items={items}
                  selectedItemId={selectedItem?.id}
                  selectedProducts={selectedProducts}
                  warehouses={warehouses}
                  onSelect={setSelectedItemId}
                  patchItem={patchItem}
                  maxRows={items.length || 12}
                  emptyAction={<ImportFromOzonAction importData={importData} salesChannelId={salesChannelId} />}
                />
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                  <div className="font-medium">Что произойдет после создания документов</div>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted-foreground)] leading-relaxed">
                    <li>Появятся документы `Стартовый остаток товаров` на дату {accountingStartDate || "старта"}.</li>
                    <li>Для каждой строки будут созданы партии FIFO с начальной себестоимостью.</li>
                    <li>Проводка: Дт 41.* / Кт 80.01.</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={downloadIssues}>
                    <Download size={14} /> Скачать список ошибок
                  </Button>
                  <Button onClick={() => apply.mutate()} disabled={blockingIssues.length > 0 || apply.isPending}>
                    <PackageCheck size={14} /> Создать стартовые остатки
                  </Button>
                </div>
                {apply.data?.created?.length > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 space-y-3">
                    <div className="font-medium">Документы созданы</div>
                    {apply.data.created.map((entry: any) => (
                      <div key={entry.document.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{entry.document.number}</div>
                          <div className="text-xs text-[var(--color-muted-foreground)]">{entry.document.title}</div>
                        </div>
                        <Button variant="secondary" asChild><Link to={`/documents/${entry.document.id}`}>Открыть документ</Link></Button>
                      </div>
                    ))}
                    <Button variant="secondary" asChild><Link to="/inventory">Перейти в складской обзор</Link></Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>Назад</Button>
            {step < steps.length - 1 ? (
              <Button
                onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
                disabled={!stepValid[currentStep]}
              >
                Продолжить <ArrowRight size={14} />
              </Button>
            ) : null}
          </div>
        </div>
    </div>
  );
}

function ModeCard({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-[var(--radius-md)] border p-4 transition-colors",
        active ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]"
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span className={[
          "mt-0.5 size-4 shrink-0 rounded-full border-2",
          active ? "border-[var(--color-primary)] bg-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30" : "border-[var(--color-border-strong)]"
        ].join(" ")} />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">{desc}</p>
        </div>
      </div>
    </button>
  );
}

function ImportFromOzonAction({
  importData,
  salesChannelId
}: {
  importData: { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean };
  salesChannelId: string;
}) {
  if (!salesChannelId) {
    return (
      <div className="text-xs text-[var(--color-warning)]">
        Сначала подключите канал Ozon на шаге «Канал Ozon».
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={() => importData.mutate()} disabled={importData.isPending}>
        {importData.isPending ? (
          <>
            <PackageCheck size={14} /> Загружаем с Ozon…
          </>
        ) : (
          <>
            <Download size={14} /> Загрузить с Ozon
          </>
        )}
      </Button>
      {importData.isError && (
        <p className="text-xs text-[var(--color-danger)]">Не удалось загрузить данные. Проверьте доступы канала.</p>
      )}
      {importData.isSuccess && !importData.isPending && (
        <div className="flex max-w-md flex-col items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <p>Импорт выполнен, но карточек не нашли. Откройте канал и запустите синхронизацию карточек и остатков.</p>
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/integrations/channels/${salesChannelId}/sync`}>Открыть синхронизацию</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function BackfillItemsTable({
  items,
  selectedItemId,
  selectedProducts,
  warehouses,
  onSelect,
  patchItem,
  maxRows,
  emptyAction
}: {
  items: any[];
  selectedItemId?: string;
  selectedProducts: any[];
  warehouses: any[];
  onSelect(itemId: string): void;
  patchItem: { mutate(input: { itemId: string; payload?: Record<string, unknown>; status?: string }): void };
  maxRows: number;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Карточки ещё не загружены"
        description="Нажмите «Загрузить с Ozon», чтобы выгрузить карточки и текущие остатки. Загрузка может занять до минуты."
        action={emptyAction}
      />
    );
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <Table>
        <THead>
          <TR>
            <TH>Карточка Ozon</TH>
            <TH>Внутренний товар</TH>
            <TH numeric>Остаток</TH>
            <TH>Склад</TH>
            <TH numeric>Себест./шт</TH>
            <TH numeric>Итого</TH>
            <TH>Статус</TH>
          </TR>
        </THead>
        <TBody>
          {items.slice(0, maxRows).map((item: any) => {
            const payload = item.payload ?? {};
            const warehouse = warehouses.find((candidate: any) => candidate.id === payload.warehouseId);
            return (
              <TR key={item.id} interactive selected={item.id === selectedItemId} onClick={() => onSelect(item.id)}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <ProductThumb product={{ sku: payload.externalSku, name: payload.externalName, imageUrl: payload.imageUrl }} size={36} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate max-w-[280px]">{payload.externalName ?? "—"}</div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)]">{payload.externalSku ?? "—"}</div>
                    </div>
                  </div>
                </TD>
                <TD>
                  <Select
                    value={String(payload.productId ?? "")}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => patchItem.mutate({ itemId: item.id, payload: { productId: event.target.value || undefined } })}
                    className="min-w-[180px]"
                  >
                    <option value="">— не сопоставлен —</option>
                    {selectedProducts.map((product: any) => (
                      <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                    ))}
                  </Select>
                </TD>
                <TD numeric>{qty(Number(payload.observedQty ?? 0))}</TD>
                <TD muted>{warehouse?.name ?? "—"}</TD>
                <TD numeric>
                  <Input
                    key={`${item.id}:${payload.unitCostRub ?? ""}`}
                    type="text"
                    inputMode="decimal"
                    defaultValue={payload.unitCostRub == null ? "" : String(payload.unitCostRub)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      const parsed = parseCostRub(next);
                      if (parsed === undefined) {
                        event.target.value = payload.unitCostRub == null ? "" : String(payload.unitCostRub);
                        return;
                      }
                      patchItem.mutate({ itemId: item.id, payload: { unitCostRub: parsed } });
                    }}
                    className="w-28 justify-end text-right"
                  />
                </TD>
                <TD numeric>{rub(Number(payload.totalCostRub ?? Number(payload.unitCostRub ?? 0) * Number(payload.observedQty ?? 0)))}</TD>
                <TD><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

function statusTone(status: string): "success" | "warning" | "neutral" | "info" {
  if (status === "ready" || status === "applied" || status === "created") return "success";
  if (status === "needs_mapping" || status === "needs_cost") return "warning";
  return "info";
}

function statusLabel(status: string) {
  if (status === "needs_mapping") return "Нужно сопоставить";
  if (status === "needs_cost") return "Нужна себестоимость";
  if (status === "ready") return "Готово";
  if (status === "applied" || status === "created") return "Документы созданы";
  if (status === "matched") return "Сопоставлено";
  return "Черновик";
}

function parseCostRub(value: string) {
  if (!value) return null;
  const normalized = value.replace(",", ".").replace(/\s+/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
