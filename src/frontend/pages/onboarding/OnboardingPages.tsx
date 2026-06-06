import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  PackageCheck,
  Plus,
  Save
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
import { useCollection } from "@/lib/use-collection";
import { apiGet, apiPatch, apiPost } from "@/api";
import { qty, rub } from "@/lib/format";

const today = () => new Date().toISOString().slice(0, 10);
const CURRENT_STOCK_STEPS = [
  { key: "start", label: "Канал Ozon", desc: "Подключение магазина" },
  { key: "mapping", label: "Товары и документы", desc: "Себестоимость и старт" }
] as const;
const HISTORICAL_STEPS = [
  { key: "start", label: "Канал Ozon", desc: "Подключение магазина" },
  { key: "date", label: "Дата начала истории", desc: "Граница импорта" },
  { key: "mapping", label: "Товары и документы", desc: "Себестоимость и старт" }
] as const;
type WizardStepKey = (typeof HISTORICAL_STEPS)[number]["key"];
type InventoryStartMode = "opening_balance" | "documented_flow";

function inventoryStartModeFromPayload(payload?: Record<string, unknown> | null): InventoryStartMode {
  return payload?.inventoryStartMode === "documented_flow" || payload?.startInventoryMode === "documented_flow"
    ? "documented_flow"
    : "opening_balance";
}

export function BackfillWizardPage() {
  const state = { salesChannels: useCollection<any[]>("salesChannels") ?? [], products: useCollection<any[]>("products") ?? [], warehouses: useCollection<any[]>("warehouses") ?? [], backfillProjects: useCollection<any[]>("backfillProjects") ?? [], accountingPolicy: useCollection<any>("accountingPolicy"), organization: useCollection<any>("organization") };
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useParams();
  const channelIdFromRoute = routeParams.id ? String(routeParams.id) : undefined;
  const searchParams = new URLSearchParams(location.search);
  const modeFromSetup = searchParams.get("mode") === "historical_backfill" ? "historical_backfill" : searchParams.get("mode") === "current_stock_start" ? "current_stock_start" : undefined;
  const inventoryStartModeFromSetup: InventoryStartMode | undefined = searchParams.get("inventoryStartMode") === "documented_flow" ? "documented_flow" : searchParams.get("inventoryStartMode") === "opening_balance" ? "opening_balance" : undefined;
  const startFromSetup = searchParams.get("start") || undefined;
  const projectIdFromQuery = searchParams.get("projectId") || undefined;
  const inSetupNamespace = location.pathname.startsWith("/setup/existing-store");
  const setupContinuation = inSetupNamespace || searchParams.get("from") === "setup";
  const modeLocked = setupContinuation;
  const historyDateLocked = setupContinuation && Boolean(startFromSetup);
  const returnTo = `${location.pathname}${location.search}`;
  const createChannelPath = `/integrations/channels/new?returnTo=${encodeURIComponent(returnTo)}`;
  const channels = (state.salesChannels ?? []).filter((channel: any) => channel.status !== "disabled");
  const selectedProducts = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const latestProject = (state.backfillProjects ?? []).slice().sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(projectIdFromQuery ?? latestProject?.id ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState(channelIdFromRoute ?? (latestProject?.payload?.salesChannelId ? String(latestProject.payload.salesChannelId) : (channels[0]?.id ?? "")));
  const [mode, setMode] = useState<"current_stock_start" | "historical_backfill">(
    modeFromSetup ?? (latestProject?.payload?.mode === "current_stock_start" ? "current_stock_start" : "historical_backfill")
  );
  const [inventoryStartMode, setInventoryStartMode] = useState<InventoryStartMode | null>(
    inventoryStartModeFromSetup ?? (latestProject ? inventoryStartModeFromPayload(latestProject.payload) : null)
  );
  const [accountingStartDate, setAccountingStartDate] = useState(
    String(startFromSetup ?? latestProject?.payload?.accountingStartDate ?? state.accountingPolicy?.accountingStartDate ?? today())
  );
  const firstChannelId = channels[0]?.id ?? "";
  const steps = useMemo(() => {
    const sourceSteps = mode === "historical_backfill" && !historyDateLocked ? HISTORICAL_STEPS : CURRENT_STOCK_STEPS;
    return sourceSteps.map((stepDefinition) =>
      stepDefinition.key === "start" && modeLocked
        ? { ...stepDefinition, label: "Канал Ozon", desc: "Подключение магазина" }
        : stepDefinition.key === "mapping" && inventoryStartMode === "documented_flow"
          ? { ...stepDefinition, label: "Товары", desc: "Сопоставление" }
          : stepDefinition
    );
  }, [historyDateLocked, inventoryStartMode, mode, modeLocked]);
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
    if (!inventoryStartMode) return false;
    const payload = project.payload ?? {};
    if (payload.salesChannelId !== salesChannelId) return false;
    if (payload.mode !== mode) return false;
    if (inventoryStartModeFromPayload(payload) !== inventoryStartMode) return false;
    if (mode === "historical_backfill" && payload.accountingStartDate !== accountingStartDate) return false;
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
    mutationFn: (allowPartial?: boolean) => {
      if (!projectId) throw new Error("Проект онбординга не найден");
      return apiPost<any>(`/api/onboarding/existing-store/projects/${projectId}/create-opening-balances`, { allowPartial: Boolean(allowPartial) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    }
  });

  const createInternal = useMutation({
    mutationFn: (externalProductId: string) =>
      apiPost<any>(`/api/external-products/${externalProductId}/create-internal-product`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backfill-project", projectId] });
      queryClient.invalidateQueries();
    }
  });
  const createAllUnmatched = useMutation({
    mutationFn: async (targets: string[]) => {
      for (const externalProductId of targets) {
        await apiPost(`/api/external-products/${externalProductId}/create-internal-product`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backfill-project", projectId] });
      queryClient.invalidateQueries();
    }
  });
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const ensureProject = useMutation({
    mutationFn: async () => {
      if (!salesChannelId) throw new Error("Выберите канал Ozon");
      if (!inventoryStartMode) throw new Error("Выберите способ заведения остатков");
      const existingProject = projectId
        ? (projectQuery.data?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
        : undefined;
      if (projectMatchesSelection(existingProject)) return projectId as string;
      const project = await apiPost<any>("/api/onboarding/existing-store/projects", {
        name: `Старт учета ${channels.find((channel: any) => channel.id === salesChannelId)?.name ?? "магазина"}`,
        payload: {
          salesChannelId,
          mode,
          inventoryStartMode,
          accountingStartDate: mode === "historical_backfill" ? accountingStartDate : (state.accountingPolicy?.accountingStartDate ?? today())
        }
      });
      setProjectId(project.id);
      return String(project.id);
    }
  });
  const importData = useMutation({
    mutationFn: async () => {
      const id = await ensureProject.mutateAsync();
      const historicalMode = mode === "historical_backfill";
      const syncRun = await apiPost<any>(`/api/integrations/channels/${salesChannelId}/sync-runs`, {
        streams: historicalMode ? ["products", "stocks", "sales", "returns", "finance_events"] : ["products", "stocks"],
        mode: historicalMode ? "backfill" : "full",
        since: historicalMode ? accountingStartDate : undefined,
        // Используем тот же sync-run, что и страница канала. Отличие только в том, что
        // внутренние товары не привязываются автоматически и история не проводится до
        // финального шага, где уже есть стартовые партии и себестоимость.
        autoLinkProducts: false,
        autoProcess: false
      });
      if (syncRun.status !== "completed") {
        const errors = Array.isArray(syncRun.errors) ? syncRun.errors.filter(Boolean) : [];
        throw new Error(errors[0] ?? "Не удалось синхронизировать карточки, остатки и историю Ozon");
      }
      await apiPost(`/api/onboarding/existing-store/projects/${id}/import`, { syncRunId: syncRun.id });
      // Auto-match disabled: cards are imported as "needs_mapping" and the user maps them
      // (or bulk-creates internal products) manually on the next step.
      const project = await apiGet<any>(`/api/onboarding/existing-store/projects/${id}`);
      return { id, project };
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
  const unmatchedExternalIds = useMemo(() => {
    return items
      .filter((item: any) => item.status === "needs_mapping" && item.payload?.externalProductId)
      .map((item: any) => String(item.payload.externalProductId));
  }, [items]);
  const readyCount = useMemo(() => items.filter((item: any) => item.status === "ready").length, [items]);
  const selectedItem = items.find((item: any) => item.id === selectedItemId) ?? items[0];
  const historicalBackfill = mode === "historical_backfill";
  const documentedFlow = inventoryStartMode === "documented_flow";
  const selectedProject = projectId
    ? (currentData?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
    : undefined;
  const hasImportedItems = items.length > 0 && projectMatchesSelection(selectedProject);
  const importInProgress = importData.isPending || ensureProject.isPending;
  const hasDateStep = stepIndexByKey("date") >= 0;
  const canImportFromOzon = Boolean(
    salesChannelId &&
    inventoryStartMode &&
    (mode !== "historical_backfill" || accountingStartDate) &&
    !importInProgress
  );
  const stepValid: Record<WizardStepKey, boolean> = {
    start: Boolean(salesChannelId && inventoryStartMode && !importInProgress && (hasDateStep || hasImportedItems)),
    date: Boolean(accountingStartDate && !importInProgress && hasImportedItems),
    mapping: hasImportedItems && readyCount > 0
  };

  useEffect(() => {
    if (!projectId) return;
    if (projectQuery.isLoading) return;
    const existingProject = currentData?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId);
    if (existingProject && !projectMatchesSelection(existingProject)) setProjectId(null);
  }, [projectId, projectQuery.isLoading, currentData?.project, state.backfillProjects, salesChannelId, mode, inventoryStartMode, accountingStartDate]);

  useEffect(() => {
    const project = currentData?.project;
    if (!project || modeFromSetup) return;
    const payload = project.payload ?? {};
    if (payload.mode === "historical_backfill" || payload.mode === "current_stock_start") {
      setMode(payload.mode);
    }
    if (!inventoryStartModeFromSetup) setInventoryStartMode(inventoryStartModeFromPayload(payload));
    if (typeof payload.accountingStartDate === "string") setAccountingStartDate(payload.accountingStartDate);
    if (payload.salesChannelId) setSalesChannelId(String(payload.salesChannelId));
  }, [currentData?.project, modeFromSetup, inventoryStartModeFromSetup]);

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

  const standaloneReturnPath = channelIdFromRoute ? `/integrations/channels/${channelIdFromRoute}` : "/inventory";
  const saveAndExit = async () => {
    const id = await ensureProject.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: ["backfill-project", id] });
    navigate(setupContinuation ? "/settings" : standaloneReturnPath);
  };
  const setupReturnQuery = (() => {
    const params = new URLSearchParams();
    params.set("mode", "existing_store");
    params.set("estoreMode", mode);
    if (inventoryStartMode) params.set("inventoryStartMode", inventoryStartMode);
    if (mode === "historical_backfill" && accountingStartDate) {
      params.set("start", accountingStartDate);
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
    ? !inventoryStartMode
      ? "Подключите Ozon и выберите, как завести остатки этого канала."
      : documentedFlow
      ? "Подключите Ozon, загрузите карточки и остатки, затем сопоставьте товары. Себестоимость и складские проводки мастер не создаёт."
      : "Подключите Ozon, загрузите карточки, текущие остатки и историю продаж, затем задайте себестоимость для стартового учета."
    : !inventoryStartMode
      ? "Выберите канал и сценарий старта: быстрый старт по себестоимости или сопоставление без складских проводок."
      : documentedFlow
      ? "Импортируйте карточки и остатки из канала, сопоставьте их с каталогом и продолжайте вводить поставки, перемещения и закрывающие документы отдельно."
      : "Импортируйте карточки, текущие остатки и историю продаж из канала, заполните себестоимость и создайте стартовые документы без ручного пересоздания каталога.";
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
	              <Link to={setupContinuation ? `/setup${historyDateLocked ? `?${setupReturnQuery}&step=start` : `?${setupReturnQuery}`}` : standaloneReturnPath}>
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

      {((summary.unmatched ?? 0) > 0 || (!documentedFlow && (summary.missingCost ?? 0) > 0) || (summary.warnings ?? []).length > 0) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium inline-flex items-center gap-2"><AlertTriangle size={14} className="text-[var(--color-warning)]" /> Что осталось заполнить (можно позже):</span>
          {(summary.unmatched ?? 0) > 0 && <span>не сопоставлено карточек: {summary.unmatched}</span>}
          {!documentedFlow && (summary.missingCost ?? 0) > 0 && <span>без себестоимости: {summary.missingCost}</span>}
          {(summary.warnings ?? []).map((warning: string) => <span key={warning}>{warning}</span>)}
        </div>
      )}

      <div className="flex flex-col gap-5">
          {currentStep === "start" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Канал Ozon</CardTitle>
                  <CardDescription>Выберите канал и способ старта учёта для этого канала.</CardDescription>
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
                <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                  <InventoryStartModeOption
                    mode="opening_balance"
                    selected={inventoryStartMode === "opening_balance"}
                    icon={<PackageCheck size={16} />}
                    title="Быстрый старт по себестоимости"
                    description="Мастер попросит себестоимость, создаст стартовые остатки и при историческом старте проведёт продажи по этим партиям."
                    onSelect={(selectedMode) => setInventoryStartMode(selectedMode)}
                  />
                  <InventoryStartModeOption
                    mode="documented_flow"
                    selected={inventoryStartMode === "documented_flow"}
                    icon={<FileText size={16} />}
                    title="Заполню поставки и перемещения"
                    description="Мастер только сопоставит карточки. Себестоимость, стартовые партии и складские проводки на этом шаге не создаются."
                    onSelect={(selectedMode) => setInventoryStartMode(selectedMode)}
                  />
                </div>
                {channels.length === 0 && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4 text-sm leading-relaxed">
	                    Для работающего магазина нужен канал Ozon: он даст карточки, текущие остатки, продажи и последующие синхронизации. После создания канала вы вернётесь сюда и сможете продолжить мастер.
                  </div>
                )}
                {salesChannelId && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        {importInProgress ? (
                          <span className="inline-flex items-center gap-2">
                            <PackageCheck size={14} /> Загружаем карточки, остатки и историю продаж из выбранного канала...
                          </span>
                        ) : hasImportedItems ? (
                          <span className="inline-flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-[var(--color-success)]" /> Данные загружены. Можно переходить к сопоставлению товаров.
                          </span>
                        ) : importData.isSuccess ? (
                          <div className="flex flex-wrap items-center gap-2 text-[var(--color-warning)]">
                            <span className="inline-flex items-center gap-2">
                              <AlertTriangle size={14} /> По выбранному каналу не нашли карточки и остатки. Откройте канал и запустите синхронизацию карточек, остатков и истории.
                            </span>
                            <Button variant="secondary" size="sm" asChild>
                              <Link to={`/integrations/channels/${salesChannelId}/sync`}>Открыть синхронизацию</Link>
                            </Button>
                          </div>
                        ) : importData.isError ? (
                          <span className="inline-flex items-center gap-2 text-[var(--color-danger)]">
                            <AlertTriangle size={14} /> Не удалось загрузить данные. Проверьте доступы канала.
                          </span>
                        ) : !inventoryStartMode ? (
                          <span>
                            Выберите сценарий старта. После этого мастер загрузит карточки и остатки без скрытого автозапуска.
                          </span>
                        ) : (
                          <span>
                            Нажмите загрузку, чтобы создать проект и подтянуть карточки, текущие остатки и историю продаж.
                            {documentedFlow ? " Складские проводки и себестоимость в этом сценарии не создаются." : ""}
                          </span>
                        )}
                      </div>
                      <Button onClick={() => importData.mutate()} disabled={!canImportFromOzon}>
                        {importInProgress ? (
                          <>
                            <PackageCheck size={14} /> Загружаем…
                          </>
                        ) : (
                          <>
                            <Download size={14} /> {hasImportedItems ? "Обновить данные Ozon" : "Загрузить данные Ozon"}
                          </>
                        )}
                      </Button>
                    </div>
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
	                  <CardDescription>Продажи и возвраты будут загружены с этой даты.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 py-5 md:grid-cols-2">
                <Field label="Дата начала истории" required>
                  <Input type="date" value={accountingStartDate} onChange={(event) => setAccountingStartDate(event.target.value)} />
                </Field>
                <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[220px] flex-1">
                      {importInProgress ? (
                        <span className="inline-flex items-center gap-2">
                          <PackageCheck size={14} /> Загружаем карточки, остатки и историю продаж с выбранной даты...
                        </span>
                      ) : hasImportedItems ? (
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-[var(--color-success)]" /> Данные загружены. Можно переходить к сопоставлению товаров.
                        </span>
                      ) : importData.isError ? (
                        <span className="inline-flex items-center gap-2 text-[var(--color-danger)]">
                          <AlertTriangle size={14} /> Не удалось загрузить данные. Проверьте доступы канала.
                        </span>
                      ) : (
                        <span>
                          Нажмите загрузку после выбора даты. До этого мастер не создаёт проект и не выбирает сценарий вместо пользователя.
                        </span>
                      )}
                    </div>
                    <Button onClick={() => importData.mutate()} disabled={!canImportFromOzon}>
                      {importInProgress ? (
                        <>
                          <PackageCheck size={14} /> Загружаем…
                        </>
                      ) : (
                        <>
                          <Download size={14} /> {hasImportedItems ? "Обновить данные Ozon" : "Загрузить данные Ozon"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {currentStep === "mapping" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{documentedFlow ? "Товары и документы" : "Товары и стартовые документы"}</CardTitle>
                  <CardDescription>
                    {documentedFlow
                      ? "Сопоставьте карточки Ozon с товарами. Поставки, перемещения и закрывающие документы вводятся отдельно."
                      : "Сопоставьте карточки Ozon, укажите себестоимость и перенесите готовые строки в учёт."}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Kpi tone="warning" label="Нужно сопоставить" value={summary.unmatched ?? 0} />
                  {documentedFlow ? (
                    <>
                      <Kpi tone="success" label="Сопоставлено" value={summary.mapped ?? 0} />
                      <Kpi
                        tone="primary"
                        label={historicalBackfill ? "Старт по документам" : "Остаток Ozon"}
                        value={qty(summary.totalQty ?? 0)}
                        hint={historicalBackfill ? `${qty(summary.totalCurrentQty ?? 0)} сейчас` : `${items.length} строк`}
                      />
                      <Kpi
                        tone="info"
                        label="История продаж"
                        value={qty(summary.totalHistoricalSalesQty ?? 0)}
                        hint={summary.totalHistoricalReturnsQty ? `возвратов ${qty(summary.totalHistoricalReturnsQty ?? 0)}` : "без проводок"}
                      />
                    </>
                  ) : (
                    <>
                      <Kpi tone="warning" label="Без себестоимости" value={summary.missingCost ?? 0} />
	                      <Kpi tone="success" label="Готово к созданию" value={summary.mapped ?? 0} />
	                      <Kpi
	                        tone="primary"
	                        label={historicalBackfill ? "Старт к учету" : "Оценка стоимости"}
	                        value={rub(summary.totalCost ?? 0)}
	                        hint={historicalBackfill
	                          ? `${qty(summary.totalQty ?? 0)} старт, ${qty(summary.totalCurrentQty ?? 0)} сейчас`
	                          : `${qty(summary.totalQty ?? 0)} в ${items.length} строках`}
	                      />
                    </>
                  )}
                </div>
                {items.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {(summary.unmatched ?? 0) > 0 ? (
                      <Button
                        variant="secondary"
                        onClick={() => createAllUnmatched.mutate(unmatchedExternalIds)}
                        disabled={createAllUnmatched.isPending || unmatchedExternalIds.length === 0}
                      >
                        <Plus size={14} /> {createAllUnmatched.isPending ? "Создаём карточки…" : `Создать товары для несопоставленных (${unmatchedExternalIds.length})`}
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--color-muted-foreground)]">Все карточки сопоставлены с товарами.</span>
                    )}
                    <CheckLabel
                      checked={onlyExceptions}
                      onCheckedChange={setOnlyExceptions}
                      label="Показать только незавершённые"
                    />
                  </div>
                )}
                {items.length > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {blockingIssues.length > 0 ? `Готовых строк: ${readyCount}` : documentedFlow ? "Можно завершить сопоставление" : "Можно создавать документы"}
                      </div>
                      <div className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                        {blockingIssues.length > 0
                          ? documentedFlow
                            ? "Сопоставленные строки можно зафиксировать сейчас, остальные останутся в мастере."
                            : "Готовые строки можно перенести в учёт сейчас, остальные останутся в мастере."
                          : documentedFlow
                            ? "Себестоимость, стартовые партии и складские проводки созданы не будут."
                            : historicalBackfill
                              ? "Будут созданы стартовые партии и проведена история продаж."
                              : "Будут созданы стартовые остатки по заполненным строкам."}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {blockingIssues.length > 0 && (
                        <Button variant="secondary" onClick={downloadIssues}>
                          <Download size={14} /> Проблемные строки
                        </Button>
                      )}
                      {blockingIssues.length > 0 ? (
                        <Button onClick={() => apply.mutate(true)} disabled={readyCount === 0 || apply.isPending}>
                          <PackageCheck size={14} /> {apply.isPending ? "Сохраняем…" : documentedFlow ? `Зафиксировать сопоставленные (${readyCount})` : `Создать документы для готовых (${readyCount})`}
                        </Button>
                      ) : (
                        <Button onClick={() => apply.mutate(false)} disabled={apply.isPending}>
                          <PackageCheck size={14} /> {apply.isPending ? "Сохраняем…" : documentedFlow ? "Завершить без складских проводок" : historicalBackfill ? "Создать стартовые партии и провести историю" : "Создать стартовые остатки"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {apply.data?.created?.length > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 space-y-3">
                    <div className="font-medium">Документы созданы</div>
                    {apply.data?.deferred > 0 && (
                      <div className="text-sm text-[var(--color-foreground)]/75">
                        Отложено строк без сопоставления или себестоимости: {apply.data.deferred}. Вернитесь к мастеру, чтобы завершить их позже — уже созданные документы не пересоздаются.
                      </div>
                    )}
                    {apply.data?.historyProcessing && (
                      <div className="text-sm text-[var(--color-foreground)]/75">
                        История проведена: продаж {apply.data.historyProcessing.salesPosted}, возвратов {apply.data.historyProcessing.returnsPosted}, финансовых операций {apply.data.historyProcessing.financePosted}. Требуют внимания: {apply.data.historyProcessing.needsAttention}.
                      </div>
                    )}
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
                {apply.data?.skippedOpeningBalances && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 space-y-2">
                    <div className="font-medium">Сопоставление сохранено</div>
                    <div className="text-sm text-[var(--color-foreground)]/75">
                      Стартовые остатки, себестоимость и складские проводки не создавались. Дальше можно вводить поставки, перемещения и закрывающие документы.
                    </div>
                    {apply.data?.deferred > 0 && (
                      <div className="text-sm text-[var(--color-foreground)]/75">
                        Осталось сопоставить карточек: {apply.data.deferred}. Они сохранены в мастере.
                      </div>
                    )}
                  </div>
                )}
                <BackfillItemsTable
                  items={items}
                  selectedItemId={selectedItem?.id}
                  selectedProducts={selectedProducts}
                  warehouses={warehouses}
                  onSelect={setSelectedItemId}
                  patchItem={patchItem}
	                  createInternal={createInternal}
	                  onlyExceptions={onlyExceptions}
	                  historicalMode={historicalBackfill}
	                  documentedFlow={documentedFlow}
	                  maxRows={12}
	                  emptyAction={<ImportFromOzonAction importData={importData} salesChannelId={salesChannelId} documentedFlow={documentedFlow} />}
                />
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

function InventoryStartModeOption({
  mode,
  selected,
  icon,
  title,
  description,
  onSelect
}: {
  mode: InventoryStartMode;
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onSelect(mode: InventoryStartMode): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={[
        "rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
          : "border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]"
      ].join(" ")}
      aria-pressed={selected}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className={selected ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"}>{icon}</span>
        {title}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted-foreground)]">{description}</span>
    </button>
  );
}

function ImportFromOzonAction({
  importData,
  salesChannelId,
  documentedFlow
}: {
  importData: { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean };
  salesChannelId: string;
  documentedFlow?: boolean;
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
	          <p>
	            Импорт выполнен, но карточек не нашли. Откройте канал и запустите синхронизацию карточек, остатков и истории.
	            {documentedFlow ? " Складские проводки не будут созданы автоматически." : ""}
	          </p>
	          <Button variant="secondary" size="sm" asChild>
	            <Link to={`/integrations/channels/${salesChannelId}/sync`}>Открыть синхронизацию</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

const EXCEPTION_RANK: Record<string, number> = { needs_mapping: 0, needs_cost: 1 };

function BackfillItemsTable({
  items,
  selectedItemId,
  selectedProducts,
  warehouses,
  onSelect,
  patchItem,
  createInternal,
  onlyExceptions,
  historicalMode,
  documentedFlow,
  maxRows,
  emptyAction
}: {
  items: any[];
  selectedItemId?: string;
  selectedProducts: any[];
  warehouses: any[];
  onSelect(itemId: string): void;
  patchItem: { mutate(input: { itemId: string; payload?: Record<string, unknown>; status?: string }): void };
  createInternal?: { mutate(externalProductId: string): void; isPending: boolean };
  onlyExceptions?: boolean;
  historicalMode?: boolean;
  documentedFlow?: boolean;
  maxRows: number;
  emptyAction?: ReactNode;
}) {
  if (items.length === 0) {
    return (
	      <EmptyState
	        title="Карточки ещё не загружены"
	        description={documentedFlow
	          ? "Нажмите «Загрузить с Ozon», чтобы выгрузить карточки и остатки без создания складских проводок. Загрузка может занять до минуты."
	          : "Нажмите «Загрузить с Ozon», чтобы выгрузить карточки, текущие остатки и историю продаж. Загрузка может занять до минуты."}
	        action={emptyAction}
	      />
    );
  }
  const ordered = [...items].sort((left, right) => {
    const leftRank = EXCEPTION_RANK[left.status] ?? 2;
    const rightRank = EXCEPTION_RANK[right.status] ?? 2;
    return leftRank - rightRank;
  });
  const visible = (onlyExceptions
    ? ordered.filter((item) => item.status === "needs_mapping" || item.status === "needs_cost")
    : ordered
  ).slice(0, maxRows);
  const hiddenCount = items.length - visible.length;
  if (visible.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 flex items-center gap-3">
        <CheckCircle2 size={16} className="text-[var(--color-success)]" />
        <div className="text-sm">
          {documentedFlow
            ? "Незавершённых строк нет — все карточки сопоставлены."
            : "Незавершённых строк нет — все карточки сопоставлены и с себестоимостью."}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <Table>
	        <THead>
	          <TR>
	            <TH>Карточка Ozon</TH>
	            <TH>Внутренний товар</TH>
	            <TH numeric>{historicalMode ? "Старт" : "Остаток"}</TH>
	            {historicalMode && <TH numeric>Сейчас</TH>}
	            <TH>Склад</TH>
	            {!documentedFlow && <TH numeric>Себест./шт</TH>}
	            {!documentedFlow && <TH numeric>Итого</TH>}
            <TH>Статус</TH>
          </TR>
        </THead>
        <TBody>
	          {visible.map((item: any) => {
	            const payload = item.payload ?? {};
	            const warehouse = warehouses.find((candidate: any) => candidate.id === payload.warehouseId);
	            const openingQty = Number(payload.openingQty ?? payload.observedQty ?? 0);
	            const observedQty = Number(payload.observedQty ?? 0);
	            const salesQty = Number(payload.historicalSalesQty ?? 0);
	            const returnsQty = Number(payload.historicalReturnsQty ?? 0);
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
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__create__") {
                        if (createInternal && payload.externalProductId) createInternal.mutate(String(payload.externalProductId));
                        return;
                      }
                      patchItem.mutate({ itemId: item.id, payload: { productId: value || undefined } });
                    }}
                    className="min-w-[180px]"
                  >
                    <option value="">— не сопоставлен —</option>
                    {createInternal && payload.externalProductId && (
                      <option value="__create__">＋ Создать товар из карточки</option>
                    )}
                    {selectedProducts.map((product: any) => (
                      <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                    ))}
                  </Select>
                </TD>
	                <TD numeric>
	                  <div className="font-semibold">{qty(openingQty)}</div>
	                  {historicalMode && (
	                    <div className="text-[11px] text-[var(--color-muted-foreground)]">
	                      +{qty(salesQty)} продаж{returnsQty > 0 ? `, -${qty(returnsQty)} возвратов` : ""}
	                    </div>
	                  )}
	                </TD>
	                {historicalMode && <TD numeric>{qty(observedQty)}</TD>}
	                <TD muted>{warehouse?.name ?? "—"}</TD>
                {!documentedFlow && (
                  <TD numeric>
                    <BackfillCostInput itemId={item.id} value={payload.unitCostRub} patchItem={patchItem} />
                  </TD>
                )}
	                {!documentedFlow && <TD numeric>{rub(Number(payload.totalCostRub ?? Number(payload.unitCostRub ?? 0) * openingQty))}</TD>}
                <TD><Badge tone={statusTone(item.status)}>{statusLabel(item.status, documentedFlow)}</Badge></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {hiddenCount > 0 && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
          {onlyExceptions ? `Скрыто готовых строк: ${hiddenCount}` : `Показаны первые ${visible.length} из ${items.length} строк`}
        </div>
      )}
    </div>
  );
}

function BackfillCostInput({
  itemId,
  value,
  patchItem
}: {
  itemId: string;
  value: unknown;
  patchItem: { mutate(input: { itemId: string; payload?: Record<string, unknown>; status?: string }): void };
}) {
  const externalValue = value == null ? "" : String(value);
  const [draft, setDraft] = useState(externalValue);
  const lastCommittedRef = useRef(externalValue);

  useEffect(() => {
    setDraft(externalValue);
    lastCommittedRef.current = externalValue;
  }, [externalValue]);

  const commitParsed = (parsed: number | null) => {
    const normalized = parsed === null ? "" : String(parsed);
    if (normalized === lastCommittedRef.current) return;
    lastCommittedRef.current = normalized;
    patchItem.mutate({ itemId, payload: { unitCostRub: parsed } });
  };

  const commitDraft = () => {
    const parsed = parseCostRub(draft.trim());
    if (parsed === undefined) {
      setDraft(externalValue);
      return;
    }
    commitParsed(parsed);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className="w-28 justify-end text-right"
    />
  );
}

function statusTone(status: string): "success" | "warning" | "neutral" | "info" {
  if (status === "ready" || status === "applied" || status === "created") return "success";
  if (status === "needs_mapping" || status === "needs_cost") return "warning";
  return "info";
}

function statusLabel(status: string, documentedFlow?: boolean) {
  if (status === "needs_mapping") return "Нужно сопоставить";
  if (status === "needs_cost") return "Нужна себестоимость";
  if (status === "ready") return documentedFlow ? "Сопоставлено" : "Готово";
  if (status === "applied" || status === "created") return documentedFlow ? "Сопоставление сохранено" : "Документы созданы";
  if (status === "matched") return "Сопоставлено";
  return "Черновик";
}

function parseCostRub(value: string) {
  if (!value) return null;
  const normalized = value.replace(",", ".").replace(/\s+/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
