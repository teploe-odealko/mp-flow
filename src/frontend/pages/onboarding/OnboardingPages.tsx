import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
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
import { useAppState } from "@/lib/use-app-state";
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

export function BackfillWizardPage() {
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useParams();
  const channelIdFromRoute = routeParams.id ? String(routeParams.id) : undefined;
  const searchParams = new URLSearchParams(location.search);
  const modeFromSetup = searchParams.get("mode") === "historical_backfill" ? "historical_backfill" : searchParams.get("mode") === "current_stock_start" ? "current_stock_start" : undefined;
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
  const [accountingStartDate, setAccountingStartDate] = useState(
    String(startFromSetup ?? latestProject?.payload?.accountingStartDate ?? state.accountingPolicy?.accountingStartDate ?? today())
  );
  const [autoImportKey, setAutoImportKey] = useState("");
  // Synchronous guard against StrictMode's double-invoked mount effect: React.StrictMode runs
  // the auto-import effect twice before the `autoImportKey` state update commits, so the state
  // check alone lets both invocations fire `importData.mutate()` — creating duplicate backfill
  // projects and double-counting observed stock. A ref updates immediately and blocks the second.
  const autoImportInFlightRef = useRef<string | null>(null);
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
    if (payload.mode !== mode) return false;
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
      const existingProject = projectId
        ? (projectQuery.data?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
        : undefined;
      if (projectMatchesSelection(existingProject)) return projectId as string;
      const project = await apiPost<any>("/api/onboarding/existing-store/projects", {
        name: `Старт учета ${channels.find((channel: any) => channel.id === salesChannelId)?.name ?? "магазина"}`,
        payload: {
          salesChannelId,
          mode,
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
  const selectedProject = projectId
    ? (currentData?.project ?? (state.backfillProjects ?? []).find((project: any) => project.id === projectId))
    : undefined;
  const importKey = `${salesChannelId}|${mode}|${mode === "historical_backfill" ? accountingStartDate : "current"}`;
  const stepValid: Record<WizardStepKey, boolean> = {
    start: Boolean(salesChannelId && mode && !importData.isPending && items.length > 0),
    date: Boolean(accountingStartDate && !importData.isPending && items.length > 0),
    mapping: items.length > 0 && readyCount > 0
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
    if (mode === "historical_backfill" && !accountingStartDate) return;
    if (projectId && projectQuery.isLoading) return;
    if (items.length > 0 && projectMatchesSelection(selectedProject)) return;
    if (importData.isPending || ensureProject.isPending) return;
    if (autoImportKey === importKey) return;
    // Ref gate fires synchronously, so StrictMode's second mount-effect invocation is blocked
    // even though the `autoImportKey` state update hasn't committed yet.
    if (autoImportInFlightRef.current === importKey) return;
    autoImportInFlightRef.current = importKey;
    setAutoImportKey(importKey);
    importData.mutate();
  }, [
    salesChannelId,
    mode,
    accountingStartDate,
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
    ? "Подключите Ozon, загрузите карточки, текущие остатки и историю продаж, затем задайте себестоимость для стартового учета."
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

      {((summary.unmatched ?? 0) > 0 || (summary.missingCost ?? 0) > 0 || (summary.warnings ?? []).length > 0) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium inline-flex items-center gap-2"><AlertTriangle size={14} className="text-[var(--color-warning)]" /> Что осталось заполнить (можно позже):</span>
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
                  <CardTitle>Канал Ozon</CardTitle>
                  <CardDescription>Выберите канал продаж.</CardDescription>
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
	                    Для работающего магазина нужен канал Ozon: он даст карточки, текущие остатки, продажи и последующие синхронизации. После создания канала вы вернётесь сюда и сможете продолжить мастер.
                  </div>
                )}
                {salesChannelId && (
                  <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 text-sm leading-relaxed">
	                    {importData.isPending || ensureProject.isPending ? (
	                      <span className="inline-flex items-center gap-2">
	                        <PackageCheck size={14} /> Загружаем карточки, остатки и историю продаж из выбранного канала...
	                      </span>
                    ) : items.length > 0 ? (
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
                        <AlertTriangle size={14} /> Не удалось загрузить данные автоматически. Проверьте доступы канала.
                      </span>
                    ) : (
	                      <span>После выбора канала мастер сам создаст проект и подтянет карточки, текущие остатки и историю продаж.</span>
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
	                  <CardDescription>Продажи и возвраты будут загружены с этой даты.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 py-5 md:grid-cols-2">
                <Field label="Дата начала истории" required>
                  <Input type="date" value={accountingStartDate} onChange={(event) => setAccountingStartDate(event.target.value)} />
                </Field>
              </CardContent>
            </Card>
          )}

          {currentStep === "mapping" && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Товары и стартовые документы</CardTitle>
                  <CardDescription>Сопоставьте карточки Ozon, укажите себестоимость и перенесите готовые строки в учёт.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Kpi tone="warning" label="Нужно сопоставить" value={summary.unmatched ?? 0} />
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
                        {blockingIssues.length > 0 ? `Готовых строк: ${readyCount}` : "Можно создавать документы"}
                      </div>
                      <div className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                        {blockingIssues.length > 0
                          ? "Готовые строки можно перенести в учёт сейчас, остальные останутся в мастере."
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
                          <PackageCheck size={14} /> {apply.isPending ? "Создаём…" : `Создать документы для готовых (${readyCount})`}
                        </Button>
                      ) : (
                        <Button onClick={() => apply.mutate(false)} disabled={apply.isPending}>
                          <PackageCheck size={14} /> {apply.isPending ? "Создаём…" : historicalBackfill ? "Создать стартовые партии и провести историю" : "Создать стартовые остатки"}
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
	                  maxRows={12}
	                  emptyAction={<ImportFromOzonAction importData={importData} salesChannelId={salesChannelId} />}
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
	          <p>Импорт выполнен, но карточек не нашли. Откройте канал и запустите синхронизацию карточек, остатков и истории.</p>
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
  maxRows: number;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return (
	      <EmptyState
	        title="Карточки ещё не загружены"
	        description="Нажмите «Загрузить с Ozon», чтобы выгрузить карточки, текущие остатки и историю продаж. Загрузка может занять до минуты."
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
        <div className="text-sm">Незавершённых строк нет — все карточки сопоставлены и с себестоимостью.</div>
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
	            <TH numeric>Себест./шт</TH>
	            <TH numeric>Итого</TH>
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
                <TD numeric>
                  <BackfillCostInput itemId={item.id} value={payload.unitCostRub} patchItem={patchItem} />
                </TD>
	                <TD numeric>{rub(Number(payload.totalCostRub ?? Number(payload.unitCostRub ?? 0) * openingQty))}</TD>
                <TD><Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge></TD>
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
