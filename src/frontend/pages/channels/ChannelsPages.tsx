import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Inbox,
  KeyRound,
  Loader2,
  PlugZap,
  Plus,
  Power,
  RefreshCcw,
  RotateCcw,
  Save,
  Trash2,
  Shield
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CheckLabel } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Kpi } from "@/components/ui/kpi";
import { Pagination } from "@/components/ui/pagination";
import { apiDelete, apiGet, apiPost } from "@/api";
import { channelTypeLabel, eventKindLabel, eventStatusLabel, observedLocationStatusLabel } from "@/lib/i18n";
import { rub, date, dateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { paginateRows } from "@/lib/pagination";
import { channelFinanceSaleAllocations, channelFinanceSourceOperationCode, channelFinanceSourceOperationName } from "../../../shared/channel-finance";
import {
  CHANNELS_WORKSPACE_QUERY_KEY,
  SYNC_INBOX_WORKSPACE_QUERY_KEY,
  channelDetailQueryKey,
  channelFinanceWorkspaceQueryKey,
  channelSyncRunsQueryKey,
  financeEventWorkspaceQueryKey,
  invalidateChannelArea
} from "./channel-queries";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  needs_setup: "warning",
  error: "danger",
  disabled: "neutral"
};
const STATUS_LABEL: Record<string, string> = {
  active: "Подключён",
  needs_setup: "Нужны учётные данные",
  error: "Ошибка доступа",
  disabled: "Отключён"
};

const STREAM_DEFS: Array<{ code: string; label: string; hint: string; pluginCap?: string }> = [
  { code: "products", label: "Карточки", hint: "Список товаров" },
  { code: "stocks", label: "Остатки", hint: "Наблюдаемые остатки", pluginCap: "observed_stock" },
  { code: "sales", label: "Продажи", hint: "Заказы и отправления" },
  { code: "returns", label: "Возвраты", hint: "Возвраты от покупателей" },
  { code: "finance_events", label: "Комиссии и логистика", hint: "Финансовые операции" },
  { code: "payouts", label: "Выплаты", hint: "Поступления и сверка выплат маркетплейса" }
];

interface ChannelsWorkspacePayload {
  channels: any[];
  plugins: any[];
  warehouses: any[];
}

interface ChannelDetailPayload {
  channel: any;
  syncRuns: any[];
}

interface SyncInboxWorkspacePayload {
  channels: any[];
  externalProducts: any[];
  products: any[];
  documents: any[];
  events: any[];
  observedStocks: any[];
}

interface ChannelFinanceWorkspacePayload {
  channel: any;
  events: any[];
  sales: any[];
  salesReturns: any[];
  payouts: any[];
  documents: any[];
  externalEvents: any[];
}

interface FinanceEventWorkspacePayload {
  event: any;
  channel: any;
  sales: any[];
  salesReturns: any[];
  payouts: any[];
  documents: any[];
  externalEvent: any | null;
}

export function ChannelsWorkspace() {
  const workspaceQuery = useQuery({
    queryKey: CHANNELS_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<ChannelsWorkspacePayload>("/api/channels/workspace")
  });
  const channels = workspaceQuery.data?.channels ?? [];
  const plugins = workspaceQuery.data?.plugins ?? [];
  const warehouses = workspaceQuery.data?.warehouses ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Каналы продаж"
        subtitle="Плагины маркетплейсов и ручные каналы. Канал хранит точку продаж, учётные данные API и историю синхронизаций."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to="/integrations/inbox"><Inbox size={14} /> Очередь событий</Link></Button>
            <Button asChild><Link to="/integrations/channels/new"><Plus size={14} /> Подключить канал</Link></Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Подключённые каналы</CardTitle>
            <CardDescription>Нажмите на строку, чтобы открыть карточку канала и запустить синхронизацию</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {channels.length === 0 ? (
            <EmptyState
              icon={<PlugZap size={20} />}
              title="Каналов пока нет"
              description="Подключите плагин маркетплейса или добавьте ручной канал, чтобы начать загрузку карточек, продаж и финансов."
              action={<Button asChild><Link to="/integrations/channels/new">Подключить канал</Link></Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Канал</TH>
                  <TH>Тип</TH>
                  <TH>Статус</TH>
                  <TH>Точка продаж</TH>
                  <TH>Последняя проверка</TH>
                  <TH>Потоки</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {channels.map((c: any) => {
                  const wh = warehouses.find((w: any) => w.id === c.salesPointWarehouseId);
                  const plugin = plugins.find((p: any) => p.id === c.pluginId);
                  return (
                    <TR key={c.id} interactive>
                      <TD>
                        <Link to={`/integrations/channels/${c.id}`} className="font-medium hover:text-[var(--color-primary)]">
                          {c.name}
                        </Link>
                        {plugin && <div className="text-[11px] text-[var(--color-muted-foreground)]">{plugin.displayName}</div>}
                      </TD>
                      <TD muted><Badge tone="neutral">{channelTypeLabel[c.channelType]}</Badge></TD>
                      <TD>
                        <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                        {c.lastError && <div className="text-[10px] text-[var(--color-danger)] mt-1 max-w-[260px] truncate" title={c.lastError}>{c.lastError}</div>}
                      </TD>
                      <TD muted>{wh?.name ?? "—"}</TD>
                      <TD muted className="text-xs numeric">{c.lastCheckedAt ? dateTime(c.lastCheckedAt) : "—"}</TD>
                      <TD>
                        {(c.enabledStreams ?? []).length === 0 ? (
                          <span className="text-xs text-[var(--color-muted-foreground)]">Все доступные</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.enabledStreams.slice(0, 3).map((s: string) => (
                              <Badge key={s} tone="neutral" size="sm">{s}</Badge>
                            ))}
                            {c.enabledStreams.length > 3 && <Badge tone="neutral" size="sm">+{c.enabledStreams.length - 3}</Badge>}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" asChild>
                            <Link to={`/integrations/channels/${c.id}`}>Открыть <ArrowRight size={13} /></Link>
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

const STEPS = [
  { key: "channel", label: "Канал" },
  { key: "credentials", label: "Доступ" },
  { key: "streams", label: "Потоки" }
] as const;

export function ChannelFormPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  const [step, setStep] = useState<(typeof STEPS)[number]["key"]>("channel");
  const [name, setName] = useState("Ozon FBO");

  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [validationOk, setValidationOk] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [streams, setStreams] = useState<string[]>(["products", "stocks", "sales", "returns", "finance_events", "payouts"]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const validate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; message?: string }>("/api/integrations/channels/validate", {
      pluginCode: "ozon", online: true, credentials: { clientId, apiKey }
    }),
    onSuccess: (data) => {
      if (data.ok) { setValidationOk(true); setValidationError(null); }
      else { setValidationOk(false); setValidationError(data.message ?? "Не удалось подтвердить доступ"); }
    },
    onError: (err) => { setValidationOk(false); setValidationError((err as Error).message); }
  });

  const submit = useMutation({
    mutationFn: async () => {
      const channel = await apiPost<any>("/api/integrations/channels", {
        name,
        channelType: "marketplace",
        pluginCode: "ozon",
        enabledStreams: streams
      });
      if (clientId && apiKey) {
        await apiPost(`/api/integrations/channels/${channel.id}/credentials`, {
          credentials: { clientId, apiKey }
        });
      }
      return channel;
    },
    onSuccess: (channel) => {
      invalidateChannelArea(queryClient, channel.id);
      navigate(returnTo ?? `/integrations/channels/${channel.id}/onboarding`);
    }
  });

  function toggleStream(code: string) {
    setStreams((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  }

  function next() {
    if (step === "channel") return setStep("credentials");
    if (step === "credentials") return setStep("streams");
    submit.mutate();
  }

  const canNextChannel = name.trim().length > 0;
  const canNextCreds = validationOk;

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: "Новый канал" }]}
        title="Подключение канала"
        subtitle="Подключите Ozon API, чтобы загружать карточки, остатки, продажи и финансы."
        actions={<Button variant="ghost" asChild><Link to={returnTo ?? "/channels"}><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <Card>
        <CardContent className="px-3 py-3">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 flex-1">
                <div
                  className={cn(
                    "size-7 rounded-full grid place-items-center text-xs font-semibold",
                    i < stepIndex ? "bg-[var(--color-success)] text-white" : i === stepIndex ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border-strong)]"
                  )}
                >
                  {i < stepIndex ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <span className={cn("text-sm font-medium", i === stepIndex && "text-[var(--color-primary)]")}>{s.label}</span>
                {i < STEPS.length - 1 && <div className={cn("flex-1 h-px", i < stepIndex ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]")} />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {step === "channel" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Канал Ozon</CardTitle>
              <CardDescription>Название будет видно в списках, синхронизациях и отчётах</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="max-w-xl">
            <Field label="Название" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ozon FBO основной" />
            </Field>
          </CardContent>
        </Card>
      )}

      {step === "credentials" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><KeyRound size={16} /> Учётные данные API</CardTitle>
              <CardDescription>Возьмите Client-Id и Api-Key в Ozon Seller → Настройки → API ключи. Можно использовать ключ только для чтения.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Client-Id" required>
              <Input value={clientId} onChange={(e) => { setClientId(e.target.value); setValidationOk(false); }} placeholder="3379092" />
            </Field>
            <Field label="Api-Key" required>
              <Input
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setValidationOk(false); }}
                type="password"
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <div className="md:col-span-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => validate.mutate()} disabled={validate.isPending || !clientId || !apiKey}>
                {validate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} Проверить доступ
              </Button>
              {validationOk && (
                <Badge tone="success">
                  <CheckCircle2 size={12} /> Доступ подтверждён
                </Badge>
              )}
              {validationError && (
                <Badge tone="danger" className="max-w-md truncate" title={validationError}>
                  <AlertTriangle size={12} /> {validationError}
                </Badge>
              )}
            </div>
            <div className="md:col-span-2 rounded-[var(--radius-md)] bg-[var(--color-muted)]/40 border border-[var(--color-border)] p-3 text-xs text-[var(--color-muted-foreground)] leading-relaxed">
              <Shield size={12} className="inline mr-1" />
              Учётные данные шифруются на сервере. Frontend никогда не получает их обратно.
              Удалить можно из карточки канала на вкладке «Учётные данные».
            </div>
          </CardContent>
        </Card>
      )}

      {step === "streams" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Потоки данных</CardTitle>
              <CardDescription>Что плагин будет загружать в синхронизациях. Можно изменить позже на карточке канала.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {STREAM_DEFS.map((s) => {
              const checked = streams.includes(s.code);
              return (
                <label
                  key={s.code}
                  className={cn(
                    "flex items-start gap-2 p-3 rounded-[var(--radius-md)] border cursor-pointer",
                    checked ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)]"
                  )}
                >
                  <CheckLabel label="" checked={checked} onCheckedChange={() => toggleStream(s.code)} />
                  <div>
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">{s.hint}</div>
                  </div>
                </label>
              );
            })}
            <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-soft)] p-3 text-xs leading-relaxed flex items-start gap-2">
              <ArrowRight size={14} className="text-[var(--color-primary)] mt-0.5 shrink-0" />
              <span>
                Сразу после подключения откроется перенос в учёт: загрузим карточки и остатки, поможем сопоставить товары и заполнить себестоимость, затем создадим стартовые остатки.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => stepIndex > 0 && setStep(STEPS[stepIndex - 1].key)} disabled={stepIndex === 0}>
          <ArrowLeft size={14} /> Назад
        </Button>
        <Button
          onClick={next}
          disabled={
            (step === "channel" && !canNextChannel) ||
            (step === "credentials" && !canNextCreds) ||
            submit.isPending
          }
        >
          {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : (step === "streams" ? <><Save size={14} /> Подключить и перенести в учёт</> : <>Далее <ArrowRight size={14} /></>)}
        </Button>
      </div>
    </div>
  );
}

export function ChannelSyncPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const channelQuery = useQuery({
    queryKey: channelDetailQueryKey(id),
    queryFn: () => apiGet<ChannelDetailPayload>(`/api/integrations/channels/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id)
  });
  const channel = channelQuery.data?.channel;
  const runsQuery = useQuery({
    queryKey: channelSyncRunsQueryKey(id),
    queryFn: () => apiGet<any[]>(`/api/integrations/channels/${encodeURIComponent(id ?? "")}/sync-runs`),
    enabled: Boolean(id)
  });
  const runs = (runsQuery.data ?? [])
    .slice()
    .sort((left: any, right: any) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
  const [mode, setMode] = useState<"incremental" | "full" | "backfill">("incremental");
  const [since, setSince] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().slice(0, 10);
  });
  const [streams, setStreams] = useState<string[]>(channel?.enabledStreams?.length ? channel.enabledStreams : STREAM_DEFS.map((stream) => stream.code));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);

  useEffect(() => {
    if (channel?.enabledStreams?.length) {
      setStreams(channel.enabledStreams);
    }
  }, [channel?.id, channel?.enabledStreams]);

  useEffect(() => {
    if (!selectedRunId && runs[0]?.id) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const selectedRun = runs.find((candidate: any) => candidate.id === selectedRunId) ?? runs[0];
  const selectedRunSummary = selectedRun?.summary ?? {
    processed: Object.values(selectedRun?.stats ?? {}).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0),
    created: 0,
    updated: 0,
    skipped: 0,
    errors: selectedRun?.errors?.length ?? 0,
    durationMs: 0
  };

  const sync = useMutation({
    mutationFn: () => apiPost<any>(`/api/integrations/channels/${id}/sync-runs`, {
      mode,
      streams,
      since: mode === "full" ? undefined : since
    }),
    onSuccess: (run) => {
      invalidateChannelArea(queryClient, id);
      setSelectedRunId(run.id);
    }
  });
  const repeat = useMutation({
    mutationFn: (run: any) => apiPost<any>(`/api/integrations/channels/${id}/sync-runs`, {
      mode: run.mode ?? "incremental",
      streams: run.streams,
      since: run.mode === "full" ? undefined : run.since
    }),
    onSuccess: (run) => {
      invalidateChannelArea(queryClient, id);
      setSelectedRunId(run.id);
    }
  });
  const cancel = useMutation({
    mutationFn: (runId: string) => apiPost(`/api/integrations/sync-runs/${runId}/cancel`),
    onSuccess: () => invalidateChannelArea(queryClient, id)
  });

  function toggleStream(code: string) {
    setStreams((prev) => prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]);
  }

  if (channelQuery.isPending) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Синхронизация канала" subtitle="Загружаем канал" breadcrumbs={[{ label: "Каналы", to: "/channels" }]} />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Синхронизация канала" subtitle="Канал не найден" breadcrumbs={[{ label: "Каналы", to: "/channels" }]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Синхронизации · ${channel.name}`}
        subtitle="Безопасный слой загрузки: сначала raw events и observed stock, потом материализация в учетные документы."
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: channel.name, to: `/integrations/channels/${channel.id}` }, { label: "Синхронизации" }]}
        badge={<Badge tone={STATUS_TONE[channel.status] ?? "neutral"}>{STATUS_LABEL[channel.status] ?? channel.status}</Badge>}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to={`/integrations/channels/${channel.id}`}>Карточка канала</Link></Button>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || streams.length === 0}>
              {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Запустить обновление
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 py-4">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Режим">
              <Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="incremental">Инкрементально</option>
                <option value="full">Полная</option>
                <option value="backfill">Исторический период</option>
              </Select>
            </Field>
            {mode !== "full" && (
              <Field label={mode === "backfill" ? "История с даты" : "Забирать с даты"}>
                <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {STREAM_DEFS.map((stream) => {
              const checked = streams.includes(stream.code);
              return (
                <label
                  key={stream.code}
                  className={cn(
                    "flex items-start gap-2 p-3 rounded-[var(--radius-md)] border cursor-pointer",
                    checked ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)]"
                  )}
                >
                  <CheckLabel label="" checked={checked} onCheckedChange={() => toggleStream(stream.code)} />
                  <div>
                    <div className="text-sm font-medium">{stream.label}</div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">{stream.hint}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Журнал синхронизаций</CardTitle>
              <CardDescription>История запусков по каналу. Повторный запуск не должен дублировать raw facts.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {runs.length === 0 ? (
              <EmptyState icon={<RefreshCcw size={20} />} title="Запусков еще не было" description="Запустите обновление, чтобы увидеть историю загрузок и ошибки потоков." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Статус</TH>
                    <TH>Старт</TH>
                    <TH>Режим</TH>
                    <TH>Потоки</TH>
                    <TH numeric>Обработано</TH>
                    <TH numeric>Создано</TH>
                    <TH numeric>Пропущено</TH>
                    <TH numeric>Ошибки</TH>
                    <TH numeric>Длительность</TH>
                  </TR>
                </THead>
                <TBody>
                  {runs.map((run: any) => {
                    const summary = run.summary ?? {
                      processed: Object.values(run.stats ?? {}).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0),
                      created: 0,
                      updated: 0,
                      skipped: 0,
                      errors: run.errors?.length ?? 0,
                      durationMs: 0
                    };
                    return (
                      <TR key={run.id} interactive selected={run.id === selectedRun?.id} onClick={() => setSelectedRunId(run.id)}>
                        <TD><Badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : run.status === "cancelled" ? "warning" : "neutral"}>{syncStatusLabel(run.status)}</Badge></TD>
                        <TD muted className="numeric text-xs">{dateTime(run.startedAt)}</TD>
                        <TD><Badge tone="neutral" size="sm">{run.mode ?? "incremental"}</Badge></TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {(run.streams ?? []).map((stream: string) => <Badge key={stream} tone="neutral" size="sm">{streamLabel(stream)}</Badge>)}
                          </div>
                        </TD>
                        <TD numeric className="font-semibold">{summary.processed}</TD>
                        <TD numeric>{summary.created}</TD>
                        <TD numeric>{summary.skipped}</TD>
                        <TD numeric className={summary.errors > 0 ? "text-[var(--color-danger)] font-semibold" : ""}>{summary.errors}</TD>
                        <TD numeric muted>{formatDuration(summary.durationMs)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Детали запуска</CardTitle>
              <CardDescription>{selectedRun ? `run ${selectedRun.id}` : "Выберите запуск в таблице"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!selectedRun ? (
              <EmptyState icon={<RefreshCcw size={20} />} title="Запуск не выбран" />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <Info label="Статус" value={<Badge tone={selectedRun.status === "completed" ? "success" : selectedRun.status === "failed" ? "danger" : selectedRun.status === "cancelled" ? "warning" : "neutral"}>{syncStatusLabel(selectedRun.status)}</Badge>} />
                  <Info label="Режим" value={selectedRun.mode ?? "incremental"} />
                  <Info label="Старт" value={dateTime(selectedRun.startedAt)} />
                  <Info label="Финиш" value={selectedRun.finishedAt ? dateTime(selectedRun.finishedAt) : "—"} />
                  <Info label="Период" value={selectedRun.since ?? "—"} />
                  <Info label="Обработано" value={selectedRunSummary.processed} />
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
                  <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Потоки</div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {(selectedRun.streamRuns ?? []).map((streamRun: any) => (
                      <div key={streamRun.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{streamLabel(streamRun.streamCode)}</div>
                          <Badge tone={streamRun.status === "completed" ? "success" : streamRun.status === "failed" ? "danger" : streamRun.status === "cancelled" ? "warning" : "neutral"} size="sm">
                            {syncStatusLabel(streamRun.status)}
                          </Badge>
                        </div>
                        <div className="text-xs text-[var(--color-muted-foreground)] mt-1">
                          Обработано {streamRun.processedCount} · создано {streamRun.createdCount} · пропущено {streamRun.skippedCount} · ошибок {streamRun.errorCount}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {(selectedRun.errors ?? []).length > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-danger)] mb-1">Ошибки</div>
                    <ul className="text-sm list-disc pl-4 space-y-1">
                      {(selectedRun.errors ?? []).map((error: string, index: number) => <li key={`${selectedRun.id}-${index}`}>{error}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2">
                  {selectedRun.status === "running" ? (
                    <Button variant="secondary" onClick={() => cancel.mutate(selectedRun.id)} disabled={cancel.isPending}>
                      <Power size={14} /> Остановить
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => repeat.mutate(selectedRun)} disabled={repeat.isPending}>
                      {repeat.isPending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Повторить
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SyncInboxPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspaceQuery = useQuery({
    queryKey: SYNC_INBOX_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<SyncInboxWorkspacePayload>("/api/integrations/inbox/workspace")
  });
  const events = workspaceQuery.data?.events ?? [];
  const observed = workspaceQuery.data?.observedStocks ?? [];
  const channels = workspaceQuery.data?.channels ?? [];
  const externalProducts = workspaceQuery.data?.externalProducts ?? [];
  const products = workspaceQuery.data?.products ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const [channelId, setChannelId] = useState("");
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const [mapping, setMapping] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events[0]?.id ?? null);
  const [ignoreReason, setIgnoreReason] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [observedPage, setObservedPage] = useState(1);
  const [observedPageSize, setObservedPageSize] = useState(25);

  const reprocess = useMutation({
    mutationFn: (eventId: string) => apiPost(`/api/integrations/events/${eventId}/reprocess`),
    onSuccess: () => invalidateChannelArea(queryClient)
  });
  const ignore = useMutation({
    mutationFn: (eventId: string) => apiPost(`/api/integrations/events/${eventId}/ignore`, { reason: ignoreReason }),
    onSuccess: () => {
      invalidateChannelArea(queryClient);
      setIgnoreReason("");
    }
  });
  const materialize = useMutation({
    mutationFn: (selectedEvent: any) => {
      if (selectedEvent.eventType === "sale") return apiPost(`/api/integrations/events/${selectedEvent.id}/materialize-sale`);
      if (selectedEvent.eventType === "sale_accrual") return apiPost(`/api/integrations/events/${selectedEvent.id}/materialize-sale-accrual`);
      if (selectedEvent.eventType === "return") return apiPost(`/api/integrations/events/${selectedEvent.id}/materialize-return`);
      if (selectedEvent.eventType === "fee") return apiPost(`/api/integrations/events/${selectedEvent.id}/materialize-fee`);
      throw new Error("Для этого типа события нет прямой материализации");
    },
    onSuccess: () => invalidateChannelArea(queryClient)
  });

  const enriched = useMemo(() => {
    return events
      .slice()
      .sort((left: any, right: any) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .map((event: any) => {
        const payload = event.normalizedPayload ?? {};
        const externalProduct = externalProducts.find((candidate: any) => candidate.id === event.externalProductId)
          ?? externalProducts.find((candidate: any) => candidate.channelId === event.channelId && candidate.externalSku === String((payload as any).sku ?? ""));
        const product = products.find((candidate: any) => candidate.id === event.productId)
          ?? products.find((candidate: any) => candidate.id === externalProduct?.productId);
        const document = documents.find((candidate: any) => candidate.id === event.materializedDocumentId);
        return { event, payload, externalProduct, product, document, channel: channels.find((candidate: any) => candidate.id === event.channelId) };
      })
      .filter((row: any) => {
        if (channelId && row.event.channelId !== channelId) return false;
        if (eventType && row.event.eventType !== eventType) return false;
        if (status && row.event.status !== status) return false;
        if (mapping === "linked" && !row.product) return false;
        if (mapping === "unmatched" && row.product) return false;
        if (dateFrom && String(row.event.occurredAt).slice(0, 10) < dateFrom) return false;
        if (search) {
          const haystack = `${row.event.externalId} ${row.externalProduct?.externalSku ?? ""} ${row.externalProduct?.externalName ?? ""} ${row.product?.name ?? ""} ${row.event.reason ?? ""}`.toLowerCase();
          if (!haystack.includes(search.toLowerCase())) return false;
        }
        return true;
      });
  }, [events, externalProducts, products, documents, channels, channelId, eventType, status, mapping, dateFrom, search]);

  useEffect(() => {
    setPage(1);
  }, [channelId, eventType, status, mapping, search, dateFrom]);

  const pagedEvents = useMemo(() => paginateRows<any>(enriched, page, pageSize), [enriched, page, pageSize]);
  const observedRows = useMemo(() => observed.slice().reverse(), [observed]);
  const pagedObserved = useMemo(() => paginateRows<any>(observedRows, observedPage, observedPageSize), [observedRows, observedPage, observedPageSize]);
  const selected = pagedEvents.find((row: any) => row.event.id === selectedEventId) ?? pagedEvents[0];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Очередь внешних событий"
        subtitle="Буфер между плагином и учётом — событие можно обработать, игнорировать или связать с внутренним товаром"
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: "Очередь" }]}
      />
      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="w-48">
            <option value="">Все каналы</option>
            {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </Select>
          <Select value={eventType} onChange={(e) => setEventType(e.target.value)} className="w-40">
            <option value="">Все типы</option>
            <option value="sale">Продажа</option>
            <option value="return">Возврат</option>
            <option value="fee">Финансы</option>
            <option value="payout">Выплата</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">Все статусы</option>
            {Object.entries(eventStatusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <Select value={mapping} onChange={(e) => setMapping(e.target.value)} className="w-44">
            <option value="">Любое сопоставление</option>
            <option value="linked">Есть товар</option>
            <option value="unmatched">Нет привязки</option>
          </Select>
          <Input className="max-w-[240px]" placeholder="Поиск по SKU, документу или причине" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input className="w-[160px]" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>События интеграций</CardTitle></CardHeader>
          <CardContent className="p-0">
            {enriched.length === 0 ? (
              <EmptyState icon={<Inbox size={20} />} title="Событий по фильтрам нет" description="Запустите синхронизацию или измените фильтры." />
            ) : (
              <Table>
                <THead><TR><TH>Время</TH><TH>Канал</TH><TH>Тип</TH><TH>Внешний ID</TH><TH>Товар</TH><TH>Статус</TH><TH>Причина</TH><TH>Документ</TH></TR></THead>
                <TBody>
                  {pagedEvents.map((row: any) => (
                    <TR key={row.event.id} interactive selected={row.event.id === selected?.event.id} onClick={() => setSelectedEventId(row.event.id)}>
                      <TD muted className="numeric text-xs">{dateTime(row.event.occurredAt)}</TD>
                      <TD>{row.channel?.name ?? "—"}</TD>
                      <TD><Badge tone="neutral">{eventTypeLabel(row.event.eventType)}</Badge></TD>
                      <TD muted className="numeric font-mono text-xs">{row.event.externalId}</TD>
                      <TD>{row.product?.name ?? row.externalProduct?.externalName ?? "—"}</TD>
                      <TD><Badge tone={eventStatusTone(row.event.status)}>{eventStatusLabel[row.event.status] ?? row.event.status}</Badge></TD>
                      <TD muted className="text-xs">{row.event.reason ?? "—"}</TD>
                      <TD>
                        {row.document ? <Link className="text-[var(--color-primary)] hover:underline numeric text-xs" to={`/documents/${row.document.id}`}>{row.document.number}</Link> : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {enriched.length > 0 && (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={enriched.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Детали события</CardTitle>
              <CardDescription>{selected ? selected.event.externalId : "Выберите событие"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!selected ? (
              <EmptyState icon={<Inbox size={20} />} title="Событие не выбрано" />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 text-sm">
                  <Info label="Статус" value={<Badge tone={eventStatusTone(selected.event.status)}>{eventStatusLabel[selected.event.status] ?? selected.event.status}</Badge>} />
                  <Info label="Тип" value={eventTypeLabel(selected.event.eventType)} />
                  <Info label="Канал" value={selected.channel?.name ?? "—"} />
                  <Info label="Время" value={dateTime(selected.event.occurredAt)} />
                  <Info label="Внешний SKU" value={selected.externalProduct?.externalSku ?? "—"} />
                  <Info label="Внутренний товар" value={selected.product?.name ?? "—"} />
                </div>
                {selected.event.reason && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">Причина</div>
                    {selected.event.reason}
                  </div>
                )}
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Сводка payload</div>
                  <div className="text-xs space-y-1">
                    {"postingNumber" in selected.payload && <div>Posting: {String(selected.payload.postingNumber ?? "—")}</div>}
                    {"operationTypeName" in selected.payload && <div>Операция: {String(selected.payload.operationTypeName ?? "—")}</div>}
                    {"amountRub" in selected.payload && <div>Сумма: {rub(Number(selected.payload.amountRub ?? 0))}</div>}
                    {Array.isArray(selected.payload.lines) && <div>Строк: {selected.payload.lines.length}</div>}
                  </div>
                </div>
                {selected.document && (
                  <Button variant="secondary" asChild>
                    <Link to={`/documents/${selected.document.id}`}>Открыть связанный документ</Link>
                  </Button>
                )}
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" onClick={() => reprocess.mutate(selected.event.id)} disabled={reprocess.isPending}>
                    <RotateCcw size={14} /> Повторить обработку
                  </Button>
                  {selected.externalProduct?.id && (
                    <Button variant="secondary" onClick={() => navigate(`/products/channel-mapping?externalProductId=${selected.externalProduct.id}`)}>
                      Открыть сопоставление товара
                    </Button>
                  )}
                  {["sale", "sale_accrual", "return", "fee"].includes(selected.event.eventType) && selected.event.status !== "processed" && (
                    <Button onClick={() => materialize.mutate(selected.event)} disabled={materialize.isPending}>
                      Создать документ
                    </Button>
                  )}
                  <Field label="Причина игнорирования">
                    <Input value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} placeholder="Почему это событие можно не учитывать" />
                  </Field>
                  <Button variant="ghost" onClick={() => ignore.mutate(selected.event.id)} disabled={ignore.isPending || ignoreReason.trim().length < 3}>
                    Игнорировать
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Наблюдаемые остатки</CardTitle></CardHeader>
        <CardContent className="p-0">
          {observed.length === 0 ? (
            <EmptyState icon={<Inbox size={20} />} title="Остатков канала пока нет" description="Появятся после синхронизации потоком «Остатки»" />
          ) : (
            <Table>
              <THead><TR><TH>Канал</TH><TH>Внешний товар</TH><TH numeric>Кол-во</TH><TH>Дата</TH><TH>Локация</TH></TR></THead>
              <TBody>
                {pagedObserved.map((row: any) => {
                  const channel = channels.find((candidate: any) => candidate.id === row.channelId);
                  const externalProduct = externalProducts.find((candidate: any) => candidate.id === row.externalProductId);
                  return (
                    <TR key={row.id}>
                      <TD>{channel?.name ?? "—"}</TD>
                      <TD muted className="font-mono text-xs">{externalProduct?.externalSku ?? row.externalProductId}</TD>
                      <TD numeric>{row.qtyObserved}</TD>
                      <TD muted className="numeric text-xs">{dateTime(row.observedAt)}</TD>
                      <TD><Badge tone={row.locationStatus === "mapped" ? "success" : "warning"}>{observedLocationStatusLabel[row.locationStatus] ?? row.locationStatus}</Badge></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          {observedRows.length > 0 && (
            <Pagination
              page={observedPage}
              pageSize={observedPageSize}
              total={observedRows.length}
              onPageChange={setObservedPage}
              onPageSizeChange={(size) => {
                setObservedPageSize(size);
                setObservedPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ChannelFinancePage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: channelFinanceWorkspaceQueryKey(id),
    queryFn: () => apiGet<ChannelFinanceWorkspacePayload>(`/api/integrations/channels/${encodeURIComponent(id ?? "")}/finance/workspace`),
    enabled: Boolean(id)
  });
  const channel = workspaceQuery.data?.channel;
  const events = workspaceQuery.data?.events ?? [];
  const sales = workspaceQuery.data?.sales ?? [];
  const returns = workspaceQuery.data?.salesReturns ?? [];
  const payouts = workspaceQuery.data?.payouts ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const externalEvents = workspaceQuery.data?.externalEvents ?? [];
  const [eventKind, setEventKind] = useState("");
  const [status, setStatus] = useState("");
  const [linkedSaleOnly, setLinkedSaleOnly] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events[0]?.id ?? null);
  const [saleLinkId, setSaleLinkId] = useState("");
  const [classification, setClassification] = useState<"commission" | "logistics" | "penalty" | "compensation">("commission");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const processReady = useMutation({
    mutationFn: () => apiPost(`/api/integrations/channels/${id}/finance-events/process-ready`),
    onSuccess: () => invalidateChannelArea(queryClient, id)
  });
  const postEvent = useMutation({
    mutationFn: (eventId: string) => apiPost(`/api/integrations/finance-events/${eventId}/post`),
    onSuccess: (_data, eventId) => invalidateChannelArea(queryClient, id, eventId)
  });
  const relink = useMutation({
    mutationFn: ({ financeEventId, saleId }: { financeEventId: string; saleId: string }) => apiPost(`/api/integrations/finance-events/${financeEventId}/link-sale`, { saleId }),
    onSuccess: (_data, variables) => invalidateChannelArea(queryClient, id, variables.financeEventId)
  });
  const reclassify = useMutation({
    mutationFn: ({ financeEventId, eventKind }: { financeEventId: string; eventKind: string }) => apiPost(`/api/integrations/finance-events/${financeEventId}/classification`, { eventKind }),
    onSuccess: (_data, variables) => invalidateChannelArea(queryClient, id, variables.financeEventId)
  });

  const rows = useMemo(() => {
    return events
      .slice()
      .sort((left: any, right: any) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .map((event: any) => {
        const sale = sales.find((candidate: any) => candidate.id === event.linkedSaleId);
        const salesReturn = returns.find((candidate: any) => candidate.id === event.linkedReturnId);
        const payout = payouts.find((candidate: any) => candidate.id === event.payoutId);
        const document = documents.find((candidate: any) => candidate.id === event.documentId);
        const externalEvent = externalEvents.find((candidate: any) => candidate.id === event.externalEventId);
        const effectLabel = event.eventKind === "compensation" ? "Дт 76.ТП / Кт 91.01" : `Дт ${event.eventKind === "penalty" ? "91.02" : "44"} / Кт 76.ТП`;
        return { event, sale, salesReturn, payout, document, externalEvent, effectLabel };
      })
      .filter((row) => {
        if (eventKind && row.event.eventKind !== eventKind) return false;
        if (status && row.event.status !== status) return false;
        if (linkedSaleOnly === "linked" && !row.sale) return false;
        if (linkedSaleOnly === "unmatched" && row.sale) return false;
        return true;
      });
  }, [events, sales, returns, payouts, documents, externalEvents, eventKind, status, linkedSaleOnly]);

  useEffect(() => {
    setPage(1);
  }, [eventKind, status, linkedSaleOnly]);

  const pagedRows = useMemo(() => paginateRows<any>(rows, page, pageSize), [rows, page, pageSize]);
  const selected = pagedRows.find((row) => row.event.id === selectedEventId) ?? pagedRows[0];
  const totalCommissions = rows.filter((row) => row.event.eventKind === "commission").reduce((sum, row) => sum + Number(row.event.amountRub ?? 0), 0);
  const totalLogistics = rows.filter((row) => row.event.eventKind === "logistics").reduce((sum, row) => sum + Number(row.event.amountRub ?? 0), 0);
  const totalOther = rows.filter((row) => row.event.eventKind === "penalty").reduce((sum, row) => sum + Number(row.event.amountRub ?? 0), 0);
  const totalCompensations = rows.filter((row) => row.event.eventKind === "compensation").reduce((sum, row) => sum + Number(row.event.amountRub ?? 0), 0);
  const needsAttention = rows.filter((row) => row.event.status === "needs_attention" || row.event.status === "new").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Финансы · ${channel?.name ?? ""}`}
        subtitle="Комиссии, логистика, штрафы и компенсации канала отдельно от выручки и себестоимости продаж."
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: channel?.name ?? "Канал", to: `/integrations/channels/${id}` }, { label: "Финансы" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => processReady.mutate()} disabled={processReady.isPending}><RefreshCcw size={14} /> Обработать новые операции</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="warning" label="Комиссии" value={rub(totalCommissions)} />
        <Kpi tone="info" label="Логистика" value={rub(totalLogistics)} />
        <Kpi tone="neutral" label="Прочие удержания" value={rub(totalOther)} />
        <Kpi tone="success" label="Компенсации" value={rub(totalCompensations)} />
        <Kpi tone="danger" label="Требуют внимания" value={needsAttention} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Select value={eventKind} onChange={(event) => setEventKind(event.target.value)} className="w-44">
            <option value="">Все типы</option>
            <option value="commission">Комиссия</option>
            <option value="logistics">Логистика</option>
            <option value="penalty">Штраф</option>
            <option value="compensation">Компенсация</option>
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-44">
            <option value="">Все статусы</option>
            <option value="new">Новое</option>
            <option value="classified">Классифицировано</option>
            <option value="posted">Проведено</option>
            <option value="needs_attention">Нужно внимание</option>
          </Select>
          <Select value={linkedSaleOnly} onChange={(event) => setLinkedSaleOnly(event.target.value)} className="w-44">
            <option value="">Любая связь</option>
            <option value="linked">Связаны с продажей</option>
            <option value="unmatched">Не связаны</option>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <EmptyState icon={<Inbox size={20} />} title="Финансовых событий по фильтрам нет" description="Запустите загрузку финансового потока или измените фильтры." />
            ) : (
              <Table>
                <THead><TR><TH>Дата</TH><TH>Тип</TH><TH>Внешний ID</TH><TH numeric>Сумма</TH><TH>Продажа / возврат</TH><TH>Выплата</TH><TH>Статус</TH><TH>Эффект</TH></TR></THead>
                <TBody>
                  {pagedRows.map((row) => (
                    <TR key={row.event.id} interactive selected={row.event.id === selected?.event.id} onClick={() => { setSelectedEventId(row.event.id); setClassification(row.event.eventKind); setSaleLinkId(row.sale?.id ?? ""); }}>
                      <TD muted className="numeric text-xs">{date(row.event.occurredAt)}</TD>
                      <TD><Badge tone="neutral">{eventKindLabel[row.event.eventKind] ?? row.event.eventKind}</Badge></TD>
                      <TD muted className="font-mono text-xs">{row.event.externalId ?? row.externalEvent?.externalId ?? "—"}</TD>
                      <TD numeric className={row.event.eventKind === "compensation" ? "text-[var(--color-success)] font-semibold" : "font-semibold"}>{rub(row.event.amountRub)}</TD>
                      <TD>
                        {row.sale ? <Link to={`/sales/${row.sale.id}`} className="text-[var(--color-primary)] hover:underline">{row.sale.externalOrderId ?? row.sale.id}</Link> : row.salesReturn ? <Link to={`/returns/${row.salesReturn.id}`} className="text-[var(--color-primary)] hover:underline">{row.salesReturn.id}</Link> : "—"}
                      </TD>
                      <TD>{row.payout ? <Link to={`/finance/payouts/${row.payout.id}/reconciliation`} className="text-[var(--color-primary)] hover:underline">{row.payout.id}</Link> : "—"}</TD>
                      <TD><Badge tone={financeEventTone(row.event.status)}>{financeEventStatusLabel(row.event.status)}</Badge></TD>
                      <TD muted className="text-xs">{row.effectLabel}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {rows.length > 0 && (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={rows.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader className="min-w-0">
            <div className="min-w-0">
              <CardTitle>Детали операции</CardTitle>
              <CardDescription className="break-all">{selected?.event.externalId ?? selected?.event.id ?? "Выберите строку"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 flex flex-col gap-4">
            {!selected ? (
              <EmptyState icon={<Inbox size={20} />} title="Событие не выбрано" />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 text-sm">
                  <Info label="Дата" value={date(selected.event.occurredAt)} />
                  <Info label="Статус" value={<Badge tone={financeEventTone(selected.event.status)}>{financeEventStatusLabel(selected.event.status)}</Badge>} />
                  <Info label="Категория" value={eventKindLabel[selected.event.eventKind] ?? selected.event.eventKind} />
                  <Info label="Сумма" value={rub(selected.event.amountRub)} />
                  <Info label="Документ" value={selected.document ? <Link to={`/documents/${selected.document.id}`} className="text-[var(--color-primary)] hover:underline">{selected.document.number}</Link> : "—"} />
                  <Info label="Источник" value={selected.externalEvent?.externalId ?? "—"} />
                </div>
                <Field label="Классификация">
                  <Select value={classification} onChange={(event) => setClassification(event.target.value as any)}>
                    <option value="commission">Комиссия</option>
                    <option value="logistics">Логистика</option>
                    <option value="penalty">Штраф</option>
                    <option value="compensation">Компенсация</option>
                  </Select>
                </Field>
                <Button variant="secondary" onClick={() => reclassify.mutate({ financeEventId: selected.event.id, eventKind: classification })} disabled={reclassify.isPending}>Изменить классификацию</Button>
                <Field label="Связать с продажей">
                  <Select value={saleLinkId} onChange={(event) => setSaleLinkId(event.target.value)}>
                    <option value="">Без связи</option>
                    {sales.filter((sale: any) => sale.channelId === id).map((sale: any) => (
                      <option key={sale.id} value={sale.id}>{sale.externalOrderId ?? sale.id} · {rub(sale.grossAmountRub)}</option>
                    ))}
                  </Select>
                </Field>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => saleLinkId && relink.mutate({ financeEventId: selected.event.id, saleId: saleLinkId })} disabled={relink.isPending || !saleLinkId}>Связать с продажей</Button>
                  <Button variant="secondary" asChild><Link to={`/integrations/finance-events/${selected.event.id}`}>Полная карточка</Link></Button>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">Предпросмотр проводки</div>
                  {selected.event.eventKind === "compensation"
                    ? <div>Дт 76.ТП / Кт 91.01 на {rub(selected.event.amountRub)}</div>
                    : <div>Дт {selected.event.eventKind === "penalty" ? "91.02" : "44"} / Кт 76.ТП на {rub(selected.event.amountRub)}</div>}
                </div>
                <Button onClick={() => postEvent.mutate(selected.event.id)} disabled={postEvent.isPending || !["classified", "posted"].includes(selected.event.status)}>
                  Провести операцию
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function FinanceEventCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: financeEventWorkspaceQueryKey(id),
    queryFn: () => apiGet<FinanceEventWorkspacePayload>(`/api/integrations/finance-events/${encodeURIComponent(id ?? "")}/workspace`),
    enabled: Boolean(id)
  });
  const event = workspaceQuery.data?.event;
  const sales = workspaceQuery.data?.sales ?? [];
  const returns = workspaceQuery.data?.salesReturns ?? [];
  const payouts = workspaceQuery.data?.payouts ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const externalEvent = workspaceQuery.data?.externalEvent;
  const linkedSale = sales.find((candidate: any) => candidate.id === event?.linkedSaleId);
  const linkedSales = channelFinanceSaleAllocations(event ?? {}).map((allocation) => ({
    allocation,
    sale: sales.find((candidate: any) => candidate.id === allocation.saleId)
  })).filter((row) => row.sale);
  const linkedReturn = returns.find((candidate: any) => candidate.id === event?.linkedReturnId);
  const linkedPayout = payouts.find((candidate: any) => candidate.id === event?.payoutId);
  const document = documents.find((candidate: any) => candidate.id === event?.documentId);
  const sourcePayload = (externalEvent?.normalizedPayload ?? externalEvent?.rawPayload ?? null) as Record<string, unknown> | null;
  const sourceOperationName = channelFinanceSourceOperationName({
    operationTypeName: event?.operationTypeName ?? sourcePayload?.operationTypeName,
    comment: event?.comment
  });
  const sourceOperationCode = channelFinanceSourceOperationCode({
    operationType: event?.operationType ?? sourcePayload?.operationType
  });
  const sourcePostingNumber = String(sourcePayload?.postingNumber ?? "").trim();
  const [saleLinkId, setSaleLinkId] = useState(linkedSale?.id ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (event?.id) {
      setSaleLinkId(linkedSale?.id ?? "");
    }
  }, [event?.id, linkedSale?.id]);

  const relink = useMutation({
    mutationFn: () => apiPost(`/api/integrations/finance-events/${id}/link-sale`, { saleId: saleLinkId }),
    onSuccess: () => invalidateChannelArea(queryClient, event?.channelId, id)
  });
  const postEvent = useMutation({
    mutationFn: () => apiPost(`/api/integrations/finance-events/${id}/post`),
    onSuccess: () => invalidateChannelArea(queryClient, event?.channelId, id)
  });
  const reprocess = useMutation({
    mutationFn: () => apiPost(`/api/integrations/finance-events/${id}/reprocess`),
    onSuccess: () => invalidateChannelArea(queryClient, event?.channelId, id)
  });
  const removeEvent = useMutation({
    mutationFn: () => apiDelete(`/api/integrations/finance-events/${id}`),
    onSuccess: () => {
      invalidateChannelArea(queryClient, event?.channelId, id);
      navigate(event ? `/integrations/channels/${event.channelId}/finance` : "/channels");
    }
  });

  if (workspaceQuery.isPending) {
    return <PageHeader title="Карточка финансовой операции" breadcrumbs={[{ label: "Каналы", to: "/channels" }]} subtitle="Загружаем операцию" />;
  }

  if (!event) {
    return <PageHeader title="Карточка финансовой операции" breadcrumbs={[{ label: "Каналы", to: "/channels" }]} subtitle="Операция не найдена" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Финансовая операция · ${eventKindLabel[event.eventKind] ?? event.eventKind}`}
        subtitle={`${date(event.occurredAt)} · ${event.externalId ?? externalEvent?.externalId ?? event.id}`}
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: "Финансы" }]}
        badge={<Badge tone={financeEventTone(event.status)}>{financeEventStatusLabel(event.status)}</Badge>}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}><RotateCcw size={14} /> Повторить обработку</Button>
            <Button onClick={() => postEvent.mutate()} disabled={postEvent.isPending || !["classified", "posted"].includes(event.status)}>Провести операцию</Button>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
            >
              <Trash2 size={14} /> Удалить
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <Card>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
            <Info label="Дата операции" value={date(event.occurredAt)} />
            <Info label="Внешний ID" value={event.externalId ?? externalEvent?.externalId ?? "—"} />
            <Info label="Сумма" value={rub(event.amountRub)} />
            <Info label="Текущая статья" value={eventKindLabel[event.eventKind] ?? event.eventKind} />
            <Info label="Операция Ozon" value={sourceOperationName} />
            <Info label="Код операции" value={sourceOperationCode} />
            <Info label="Документ" value={document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"} />
            <Info label="Исходное событие" value={externalEvent ? externalEvent.externalId : "—"} />
            <Info label="Posting Ozon" value={sourcePostingNumber || "—"} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Связи</CardTitle>
              <CardDescription>Продажа, возврат, выплата и канал</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Info
              label="Продажа"
              value={
                linkedSales.length > 1 ? (
                  <div className="flex flex-col gap-1">
                    {linkedSales.map(({ sale, allocation }: any) => (
                      <Link key={sale.id} to={`/sales/${sale.id}`} className="text-[var(--color-primary)] hover:underline">
                        {sale.externalOrderId ?? sale.id} · {rub(allocation.amountRub)}
                      </Link>
                    ))}
                  </div>
                ) : linkedSale ? (
                  <Link to={`/sales/${linkedSale.id}`} className="text-[var(--color-primary)] hover:underline">{linkedSale.externalOrderId ?? linkedSale.id}</Link>
                ) : "—"
              }
            />
            <Info label="Возврат" value={linkedReturn ? <Link to={`/returns/${linkedReturn.id}`} className="text-[var(--color-primary)] hover:underline">{linkedReturn.id}</Link> : "—"} />
            <Info label="Выплата" value={linkedPayout ? <Link to={`/finance/payouts/${linkedPayout.id}/reconciliation`} className="text-[var(--color-primary)] hover:underline">{linkedPayout.id}</Link> : "—"} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Связать с продажей</CardTitle>
            <CardDescription>Нужно для unit-экономики и объяснения выплаты канала.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <Field label="Продажа">
            <Select value={saleLinkId} onChange={(event) => setSaleLinkId(event.target.value)}>
              <option value="">Без связи</option>
              {sales.filter((sale: any) => sale.channelId === event.channelId).map((sale: any) => (
                <option key={sale.id} value={sale.id}>{sale.externalOrderId ?? sale.id} · {rub(sale.grossAmountRub)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => relink.mutate()} disabled={relink.isPending || !saleLinkId}>Связать с продажей</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Предпросмотр проводки</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {event.eventKind === "compensation"
            ? <div>Дт 76.ТП / Кт 91.01 на {rub(event.amountRub)}</div>
            : <div>Дт {event.eventKind === "penalty" ? "91.02" : "44"} / Кт 76.ТП на {rub(event.amountRub)}</div>}
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Удалить финансовую операцию</DialogTitle>
            <DialogDescription>
              Удаление снимет локальную финансовую операцию и вернет исходное событие в очередь, чтобы потом заново материализовать его из канала.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
              Если операция уже попала в выплату маркетплейса, удаление будет заблокировано.
            </div>
            {removeEvent.isError && <p className="text-sm text-[var(--color-danger)]">{mutationMessage(removeEvent.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={() => removeEvent.mutate()} disabled={removeEvent.isPending}>
              <Trash2 size={14} /> Удалить операцию
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function syncStatusLabel(status: string) {
  if (status === "running") return "В работе";
  if (status === "queued") return "В очереди";
  if (status === "completed") return "Завершён";
  if (status === "failed") return "Ошибка";
  if (status === "cancelled") return "Остановлен";
  return status;
}

function eventTypeLabel(eventType: string) {
  if (eventType === "sale") return "Продажа";
  if (eventType === "sale_accrual") return "Начисление продажи";
  if (eventType === "return") return "Возврат";
  if (eventType === "fee") return "Финансы";
  if (eventType === "payout") return "Выплата";
  if (eventType === "stock") return "Остаток";
  if (eventType === "product") return "Карточка";
  return eventType;
}

function eventStatusTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "processed") return "success";
  if (status === "ready_for_processing" || status === "awaiting_sale") return "info";
  if (status === "needs_mapping" || status === "needs_attention") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function financeEventTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "posted") return "success";
  if (status === "classified") return "info";
  if (status === "needs_attention") return "warning";
  if (status === "ignored" || status === "reversed") return "danger";
  return "neutral";
}

function financeEventStatusLabel(status: string) {
  if (status === "new") return "Новое";
  if (status === "classified") return "Классифицировано";
  if (status === "posted") return "Проведено";
  if (status === "needs_attention") return "Нужно внимание";
  if (status === "ignored") return "Игнор";
  if (status === "reversed") return "Сторно";
  return status;
}

function streamLabel(code: string) {
  return STREAM_DEFS.find((stream) => stream.code === code)?.label ?? code;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) return "—";
  if (durationMs < 1000) return `${durationMs} мс`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} с`;
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}

function sanitizeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}
