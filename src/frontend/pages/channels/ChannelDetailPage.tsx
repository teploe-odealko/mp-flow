import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  History,
  Inbox,
  KeyRound,
  Loader2,
  PackageCheck,
  Pencil,
  PlugZap,
  Power,
  PowerOff,
  RefreshCcw,
  Shield,
  Trash2
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CheckLabel } from "@/components/ui/checkbox";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
  DialogDescription
} from "@/components/ui/dialog";
import { DataList } from "@/components/ui/data-list";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/api";
import { useCollection } from "@/lib/use-collection";
import { date, dateTime, rub } from "@/lib/format";
import { cn } from "@/lib/cn";

const STREAM_DEFS: Array<{ code: string; label: string; hint: string }> = [
  { code: "products", label: "Карточки", hint: "Список товаров и их атрибутов" },
  { code: "stocks", label: "Остатки", hint: "Наблюдаемые остатки на складах канала" },
  { code: "sales", label: "Продажи", hint: "Заказы и отправления, превращающиеся в продажи" },
  { code: "returns", label: "Возвраты", hint: "Отмены и возвраты от покупателей" },
  { code: "finance_events", label: "Комиссии и логистика", hint: "Финансовые операции (commissions, logistics, penalties)" },
  { code: "payouts", label: "Выплаты", hint: "Поступления и реестр выплат маркетплейса" }
];

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  active: "success",
  needs_setup: "warning",
  error: "danger",
  disabled: "neutral",
  connected: "success"
};
const STATUS_LABEL: Record<string, string> = {
  active: "Подключён",
  connected: "Подключён",
  needs_setup: "Нужны учётные данные",
  error: "Ошибка доступа",
  disabled: "Отключён"
};

interface ChannelDetailPayload {
  channel: any;
  credentialStatus: { saved: boolean; fields: string[] };
  warehouse: any | null;
  plugin: { code: string; displayName: string; capabilities: string[] } | null;
  syncRuns: any[];
  counts: { externalProducts: number; observedStocks: number; externalEvents: number; sales: number; payouts: number };
}

export function ChannelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const warehouses = (useCollection<any[]>("warehouses") ?? []).filter((w: any) => w.warehouseType === "sales_point");
  const channelsList = useCollection<any[]>("salesChannels") ?? [];
  const backfillProjects = useCollection<any[]>("backfillProjects") ?? [];

  const channelQuery = useQuery({
    queryKey: ["channel-detail", id],
    queryFn: () => apiGet<ChannelDetailPayload>(`/api/integrations/channels/${id}`),
    enabled: Boolean(id)
  });

  const [credsOpen, setCredsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (!id) return null;
  const data = channelQuery.data;
  const channel = data?.channel ?? channelsList.find((c: any) => c.id === id);
  const status = channel?.status ?? "needs_setup";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["channel-detail", id] });
  const refreshAll = () => queryClient.invalidateQueries();

  const checkAccess = useMutation({
    mutationFn: () => apiPost(`/api/integrations/channels/${id}/check`),
    onSuccess: () => { refresh(); refreshAll(); }
  });
  const disable = useMutation({
    mutationFn: () => apiPost(`/api/integrations/channels/${id}/disable`),
    onSuccess: () => { refresh(); refreshAll(); }
  });
  const enable = useMutation({
    mutationFn: () => apiPatch(`/api/integrations/channels/${id}`, { status: "active" }),
    onSuccess: () => { refresh(); refreshAll(); }
  });
  const removeCreds = useMutation({
    mutationFn: () => apiDelete(`/api/integrations/channels/${id}/credentials`),
    onSuccess: () => { refresh(); refreshAll(); }
  });

  if (!channel) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Канал не найден" breadcrumbs={[{ label: "Каналы", to: "/channels" }]} />
        <Button variant="ghost" asChild><Link to="/channels"><ArrowLeft size={14} /> К списку</Link></Button>
      </div>
    );
  }

  const credsSaved = data?.credentialStatus.saved ?? false;
  const enabledStreams: string[] = channel.enabledStreams ?? [];
  const capabilities: string[] = data?.plugin?.capabilities ?? [];
  const counts = data?.counts;

  // Onboarding ("перенос в учёт") progress for this channel, derived from its backfill project.
  const onboarding = useMemo(() => {
    const projects = backfillProjects
      .filter((p: any) => String(p?.payload?.salesChannelId ?? "") === String(id))
      .slice()
      .sort((a: any, b: any) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    const project = projects[0];
    const summary = project?.payload?.summary ?? null;
    const done = project ? ["applied", "completed"].includes(project.status) : false;
    const started = Boolean(project) && !done;
    return { project, summary, done, started };
  }, [backfillProjects, id]);
  const onboardingDocumentedFlow = onboarding.project?.payload?.inventoryStartMode === "documented_flow";
  const onboardingPath = `/integrations/channels/${channel.id}/onboarding`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Каналы", to: "/channels" }, { label: channel.name }]}
        title={channel.name}
        subtitle={data?.plugin ? `Плагин · ${data.plugin.displayName}` : "Ручной канал без плагина"}
        badge={<Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" asChild><Link to="/channels"><ArrowLeft size={14} /> К списку</Link></Button>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={14} /> Изменить
            </Button>
            <Button
              variant="secondary"
              onClick={() => checkAccess.mutate()}
              disabled={checkAccess.isPending || !credsSaved}
              title={credsSaved ? undefined : "Сначала введите учётные данные"}
            >
              {checkAccess.isPending ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              Проверить доступ
            </Button>
            <Button
              onClick={() => setSyncOpen(true)}
              variant="secondary"
              disabled={!credsSaved || status === "disabled"}
              title={credsSaved ? undefined : "Сначала введите учётные данные"}
            >
              <RefreshCcw size={14} /> Синхронизировать
            </Button>
          </div>
        }
      />

      {channel.lastError && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-[var(--color-danger)] mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--color-danger)]">Ошибка от канала</p>
            <p className="text-xs text-[var(--color-foreground)]/80 mt-1 leading-relaxed">{channel.lastError}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => checkAccess.mutate()}>Повторить</Button>
        </div>
      )}

      {!credsSaved && (
        <div className="rounded-[var(--radius-md)] border border-[oklch(0.85_0.1_70)] bg-[var(--color-warning-soft)] p-4 flex items-start gap-3">
          <KeyRound size={18} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Канал не подключён</p>
            <p className="text-xs text-[var(--color-foreground)]/75 leading-relaxed mt-1">
              Введите учётные данные плагина, чтобы система могла подключиться к API канала и получать карточки, продажи и финансы.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setCredsOpen(true)}>
              <PlugZap size={14} /> Подключить
            </Button>
          </div>
        </div>
      )}

      {credsSaved && status !== "disabled" && (
        onboarding.done ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 flex items-start gap-3">
            <CheckCircle2 size={18} className="text-[var(--color-success)] mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{onboardingDocumentedFlow ? "Каталог сопоставлен" : "Каталог и остатки перенесены в учёт"}</p>
              <p className="text-xs text-[var(--color-foreground)]/75 leading-relaxed mt-1">
                {onboardingDocumentedFlow
                  ? "Карточки сопоставлены без создания стартовых остатков. Откройте мастер, чтобы дозаполнить отложенные строки."
                  : "Стартовые остатки по каналу созданы. Откройте мастер, чтобы дозаполнить отложенные строки или перенести новые карточки."}
              </p>
            </div>
            <Button size="sm" variant="secondary" asChild>
              <Link to={onboardingPath}><PackageCheck size={14} /> Открыть мастер</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-soft)] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <PackageCheck size={20} className="text-[var(--color-primary)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {onboarding.started ? "Продолжите перенос в учёт" : "Следующий шаг: перенести каталог и остатки в учёт"}
              </p>
              <p className="text-xs text-[var(--color-foreground)]/75 leading-relaxed mt-1">
                {onboarding.started && onboarding.summary
                  ? onboardingDocumentedFlow
                    ? <>Готово {onboarding.summary.mapped ?? 0} из {onboarding.summary.totalItems ?? 0}. Осталось сопоставить товары; себестоимость и складские проводки мастер не создаёт.</>
                    : <>Готово {onboarding.summary.mapped ?? 0} из {onboarding.summary.totalItems ?? 0}. Осталось сопоставить товары и заполнить себестоимость, затем создать стартовые остатки.</>
                  : <>Загрузим карточки и остатки из «{channel.name}», затем дадим выбрать: быстрый старт по себестоимости или сопоставление без складских проводок. Прогресс сохраняется — можно делать постепенно.</>}
              </p>
            </div>
            <Button asChild>
              <Link to={onboardingPath}>
                <PackageCheck size={14} /> {onboarding.started ? "Продолжить перенос" : "Начать перенос"}
              </Link>
            </Button>
          </div>
        )
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="credentials">
              <KeyRound size={13} /> Учётные данные {credsSaved && <Badge tone="success" size="sm">Сохранены</Badge>}
            </TabsTrigger>
            <TabsTrigger value="streams">Потоки</TabsTrigger>
            <TabsTrigger value="history"><History size={13} /> Синхронизации {data?.syncRuns.length ? <Badge tone="neutral" size="sm">{data.syncRuns.length}</Badge> : null}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardContent className="py-5">
                <DataList
                  columns={2}
                  items={[
                    { label: "Плагин", value: data?.plugin?.displayName ?? "Без плагина" },
                    { label: "Тип канала", value: channel.channelType },
                    { label: "Точка продаж", value: data?.warehouse?.name ?? "—" },
                    { label: "Статус", value: STATUS_LABEL[status] ?? status },
                    { label: "Учётные данные", value: credsSaved ? `Сохранены (${data?.credentialStatus.fields.join(", ")})` : "Не введены" },
                    { label: "Последняя проверка", value: channel.lastCheckedAt ? dateTime(channel.lastCheckedAt) : "—" },
                    { label: "Последняя синхронизация", value: channel.lastSyncAt ? dateTime(channel.lastSyncAt) : "—" },
                    { label: "Включённые потоки", value: enabledStreams.length ? enabledStreams.length : "Все доступные" }
                  ]}
                />
                {data && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-5">
                    <CountTile label="Внешние карточки" value={counts?.externalProducts ?? 0} to="/products/channel-mapping" />
                    <CountTile label="Наблюдаемые остатки" value={counts?.observedStocks ?? 0} to="/integrations/inbox" />
                    <CountTile label="События" value={counts?.externalEvents ?? 0} to="/integrations/inbox" />
                    <CountTile label="Продажи" value={counts?.sales ?? 0} to="/sales" />
                    <CountTile label="Выплаты" value={counts?.payouts ?? 0} to="/finance/payouts" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credentials">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Учётные данные API</CardTitle>
                  <CardDescription>
                    {credsSaved
                      ? "Сохранены и шифруются на диске. Frontend никогда не получает значения обратно."
                      : "Введите учётные данные плагина, чтобы открыть синхронизацию."}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {credsSaved ? (
                  <>
                    <div className="text-sm">
                      Сохранённые поля:{" "}
                      {data?.credentialStatus.fields.map((f) => (
                        <Badge key={f} tone="primary" size="sm" className="ml-1">{f}</Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setCredsOpen(true)}><Pencil size={14} /> Обновить</Button>
                      <Button variant="ghost" onClick={() => removeCreds.mutate()} disabled={removeCreds.isPending}>
                        <Trash2 size={14} /> Удалить
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button onClick={() => setCredsOpen(true)}>
                    <PlugZap size={14} /> Ввести учётные данные
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="streams">
            <StreamsCard
              capabilities={capabilities}
              enabled={enabledStreams}
              onSave={async (next) => {
                await apiPatch(`/api/integrations/channels/${id}`, { enabledStreams: next });
                refresh(); refreshAll();
              }}
            />
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-0">
                {(data?.syncRuns?.length ?? 0) === 0 ? (
                  <EmptyState icon={<History size={20} />} title="Синхронизаций пока не было" />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Старт</TH>
                        <TH>Режим</TH>
                        <TH>Потоки</TH>
                        <TH>Статус</TH>
                        <TH numeric>Длит.</TH>
                        <TH numeric>Карточек</TH>
                        <TH numeric>Событий</TH>
                        <TH>Ошибки</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data!.syncRuns.map((run: any) => {
                        const duration = run.finishedAt && run.startedAt
                          ? Math.max(0, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))
                          : null;
                        return (
                          <TR key={run.id}>
                            <TD muted className="text-xs numeric">{dateTime(run.startedAt)}</TD>
                            <TD muted><Badge tone="neutral" size="sm">{run.mode ?? "incremental"}</Badge></TD>
                            <TD>
                              {(run.streams?.length ?? 0) === 0 ? <span className="text-xs text-[var(--color-muted-foreground)]">Все</span> : run.streams.map((s: string) => <Badge key={s} tone="neutral" size="sm" className="mr-1">{s}</Badge>)}
                            </TD>
                            <TD>
                              <Badge tone={run.status === "completed" ? "success" : run.status === "running" ? "info" : "danger"}>
                                {run.status === "completed" ? "Завершено" : run.status === "running" ? "Идёт" : run.status === "failed" ? "Ошибка" : run.status}
                              </Badge>
                            </TD>
                            <TD numeric muted>{duration === null ? "—" : `${duration}s`}</TD>
                            <TD numeric>{run.stats?.products ?? 0}</TD>
                            <TD numeric>{run.stats?.events ?? 0}</TD>
                            <TD muted className="text-xs">
                              {run.errors?.length ? <span className="text-[var(--color-danger)]">{run.errors[0]}</span> : "—"}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-3 text-sm">
          <Card>
            <CardContent className="flex flex-col gap-2.5 py-4">
              <SideRow label="Состояние" value={<Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>} />
              <SideRow label="Точка продаж" value={data?.warehouse?.name ?? "—"} />
              <SideRow label="Креды" value={credsSaved ? <Badge tone="success" size="sm">сохранены</Badge> : <Badge tone="warning" size="sm">не введены</Badge>} />
              <SideRow label="Последняя проверка" value={channel.lastCheckedAt ? dateTime(channel.lastCheckedAt) : "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Действия</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="secondary" asChild><Link to="/integrations/inbox"><Inbox size={14} /> Очередь событий</Link></Button>
              <Button variant="secondary" asChild><Link to="/products/channel-mapping">Привязки товаров</Link></Button>
              {status === "disabled" ? (
                <Button variant="secondary" onClick={() => enable.mutate()} disabled={enable.isPending}>
                  <Power size={14} /> Включить
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => disable.mutate()} disabled={disable.isPending}>
                  <PowerOff size={14} /> Отключить
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <CredentialsDialog
        open={credsOpen}
        onClose={() => setCredsOpen(false)}
        channelId={id}
        pluginCode={data?.plugin?.code}
        existingFields={data?.credentialStatus.fields ?? []}
        onSaved={() => { setCredsOpen(false); refresh(); refreshAll(); }}
      />

      <SyncDialog
        open={syncOpen}
        onClose={() => { setSyncOpen(false); refresh(); refreshAll(); }}
        channelId={id}
        capabilities={capabilities}
        enabledStreams={enabledStreams}
        onCompleted={() => { refresh(); refreshAll(); }}
      />

      <EditChannelDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        channel={channel}
        warehouses={warehouses}
        onSaved={() => { setEditOpen(false); refresh(); refreshAll(); navigate(`/integrations/channels/${id}`); }}
      />
    </div>
  );
}

function CountTile({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 hover:bg-[var(--color-muted)] transition-colors">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-xl font-semibold mt-0.5 numeric">{value}</div>
    </Link>
  );
}

function SideRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <div className="text-right">{value}</div>
    </div>
  );
}

function StreamsCard({ capabilities, enabled, onSave }: { capabilities: string[]; enabled: string[]; onSave: (next: string[]) => Promise<void> | void }) {
  const [selected, setSelected] = useState<string[]>(enabled);
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => JSON.stringify([...selected].sort()) !== JSON.stringify([...enabled].sort()), [selected, enabled]);

  function toggle(code: string) {
    setSelected((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Потоки данных</CardTitle>
          <CardDescription>Выберите, что плагин будет загружать. Можно ограничить набор для ускорения синхронизаций.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {STREAM_DEFS.map((s) => {
          const supported = capabilities.length === 0 || capabilities.includes(s.code) || (s.code === "stocks" && capabilities.includes("observed_stock"));
          return (
            <label
              key={s.code}
              className={cn(
                "flex items-start gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] cursor-pointer",
                !supported && "opacity-50 cursor-not-allowed",
                selected.includes(s.code) && supported && "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
              )}
            >
              <CheckLabel
                label=""
                checked={selected.includes(s.code)}
                onCheckedChange={() => supported && toggle(s.code)}
              />
              <div className="flex-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  {s.label}
                  {!supported && <Badge tone="neutral" size="sm">плагин не умеет</Badge>}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 leading-relaxed">{s.hint}</p>
              </div>
            </label>
          );
        })}
        <div className="flex gap-2 mt-2">
          <Button onClick={save} disabled={!dirty || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Сохранить
          </Button>
          <Button variant="ghost" onClick={() => setSelected(enabled)} disabled={!dirty}>Сбросить</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CredentialsDialog({
  open, onClose, channelId, pluginCode, existingFields, onSaved
}: {
  open: boolean; onClose(): void; channelId: string; pluginCode?: string; existingFields: string[]; onSaved(): void;
}) {
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; message?: string }>("/api/integrations/channels/validate", {
      pluginCode,
      online: true,
      credentials: { clientId, apiKey, token }
    }),
    onSuccess: (data) => {
      if (data.ok) {
        setError(null);
        setSuccess("Доступ подтверждён. Можно сохранять.");
      } else {
        setSuccess(null);
        setError(data.message ?? "Не удалось подтвердить доступ");
      }
    },
    onError: (err) => { setSuccess(null); setError((err as Error).message); }
  });

  const save = useMutation({
    mutationFn: () => apiPost(`/api/integrations/channels/${channelId}/credentials`, {
      credentials: { clientId, apiKey, token }
    }),
    onSuccess: () => { onSaved(); setClientId(""); setApiKey(""); setToken(""); setError(null); setSuccess(null); },
    onError: (err) => { setError((err as Error).message); setSuccess(null); }
  });

  const isOzon = pluginCode === "ozon";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound size={16} /> Учётные данные {pluginCode ?? ""}</DialogTitle>
          <DialogDescription>
            {existingFields.length > 0
              ? "Введите новые значения, чтобы заменить ранее сохранённые. Старые значения не показываются."
              : "Только эти данные сохраняются на сервере. Frontend никогда не получает их обратно."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {isOzon ? (
            <>
              <Field label="Client-Id" required hint="Идентификатор кабинета Ozon Seller">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="3379092" />
              </Field>
              <Field label="Api-Key" required hint="Создаётся в Ozon Seller → Настройки → API ключи">
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="00000000-0000-0000-0000-000000000000" />
              </Field>
            </>
          ) : (
            <>
              <Field label="Client Id"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} /></Field>
              <Field label="Api Key"><Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" /></Field>
              <Field label="Token (опционально)"><Input value={token} onChange={(e) => setToken(e.target.value)} type="password" /></Field>
            </>
          )}
          {error && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={12} className="inline mr-1" /> {error}
            </div>
          )}
          {success && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
              <CheckCircle2 size={12} className="inline mr-1" /> {success}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Отмена</Button></DialogClose>
          <Button variant="secondary" onClick={() => validate.mutate()} disabled={validate.isPending || !clientId || !apiKey}>
            {validate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} Проверить доступ
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !clientId || !apiKey}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SYNC_STAT_LABELS: Record<string, string> = {
  products: "Товары",
  events: "Событий",
  stocks: "Остатки",
  sales: "Продажи",
  returns: "Возвраты",
  finance_events: "Финоперации",
  payouts: "Выплаты",
  auto_sales_materialized: "Продажи проведены",
  auto_returns_materialized: "Возвраты проведены",
  auto_finance_posted: "Финансы проведены",
  auto_payouts_materialized: "Выплаты разнесены",
  auto_needs_attention: "Требуют внимания",
  auto_skipped_before_start: "Вне учёта (до старта)"
};

function syncStatLabel(key: string) {
  return SYNC_STAT_LABELS[key] ?? key.replace(/_/g, " ");
}

function SyncDialog({
  open, onClose, channelId, capabilities, enabledStreams, onCompleted
}: {
  open: boolean; onClose(): void; channelId: string; capabilities: string[]; enabledStreams: string[]; onCompleted(): void;
}) {
  const initial = enabledStreams.length > 0 ? enabledStreams : ["products", "stocks", "sales", "returns", "finance_events", "payouts"];
  const [streams, setStreams] = useState<string[]>(initial);
  const [mode, setMode] = useState<"incremental" | "full" | "backfill">("incremental");
  const [since, setSince] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useMutation({
    mutationFn: () => apiPost<any>(`/api/integrations/channels/${channelId}/sync-runs`, {
      mode,
      streams,
      since: mode === "full" ? undefined : since
    }),
    onSuccess: (data) => { setResult(data); setError(null); onCompleted(); },
    onError: (err) => { setError((err as Error).message); setResult(null); }
  });

  function toggle(code: string) {
    setStreams((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RefreshCcw size={16} /> Синхронизация канала</DialogTitle>
          <DialogDescription>Выберите, что и за какой период обновить. Плагин загрузит данные в очередь внешних событий.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Режим">
            <Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="incremental">Инкрементально (с даты)</option>
              <option value="full">Полная</option>
              <option value="backfill">Исторический период</option>
            </Select>
          </Field>
          {mode !== "full" && (
            <Field label={mode === "backfill" ? "Начало исторического периода" : "Забирать с даты"}>
              <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </Field>
          )}
          {mode === "backfill" && (
            <div className="md:col-span-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
              Загрузим продажи и операции с выбранной даты. Всё, что раньше старта учёта, попадёт в стартовый остаток и не будет проводиться отдельно — такие факты помечаются «Вне учёта (до старта)».
            </div>
          )}
          <div className="md:col-span-2">
            <div className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2">Потоки</div>
            <div className="grid grid-cols-2 gap-2">
              {STREAM_DEFS.map((s) => {
                const supported = capabilities.length === 0 || capabilities.includes(s.code) || (s.code === "stocks" && capabilities.includes("observed_stock"));
                const checked = streams.includes(s.code);
                return (
                  <label
                    key={s.code}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-[var(--radius-sm)] border cursor-pointer",
                      !supported && "opacity-50 cursor-not-allowed",
                      checked && supported && "border-[var(--color-primary)] bg-[var(--color-primary-soft)]",
                      !checked && supported && "border-[var(--color-border)]"
                    )}
                  >
                    <CheckLabel label="" checked={checked} onCheckedChange={() => supported && toggle(s.code)} />
                    <div>
                      <div className="text-xs font-medium">{s.label}</div>
                      <div className="text-[10px] text-[var(--color-muted-foreground)]">{s.hint}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="md:col-span-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={12} className="inline mr-1" /> {error}
            </div>
          )}

          {result && (
            <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                {result.status === "completed" ? <CheckCircle2 size={16} className="text-[var(--color-success)]" /> : <AlertTriangle size={16} className="text-[var(--color-danger)]" />}
                <span className="text-sm font-medium">{result.status === "completed" ? "Готово" : "Ошибка"}</span>
                {result.finishedAt && (
                  <span className="text-[11px] text-[var(--color-muted-foreground)] numeric ml-auto">
                    {Math.round((new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()) / 1000)}s
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {Object.entries(result.stats ?? {}).map(([k, v]) => (
                  <div key={k} className="rounded-[var(--radius-sm)] bg-[var(--color-card)] p-2 border border-[var(--color-border)]">
                    <div className="text-[10px] font-semibold text-[var(--color-muted-foreground)]">{syncStatLabel(k)}</div>
                    <div className="text-sm font-semibold numeric">{String(v)}</div>
                  </div>
                ))}
              </div>
              {(result.errors ?? []).length > 0 && (
                <div className="mt-3 text-xs text-[var(--color-danger)]">
                  {result.errors.map((err: string, i: number) => <div key={i}>· {err}</div>)}
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Закрыть</Button></DialogClose>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || streams.length === 0}>
            {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Запустить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditChannelDialog({
  open, onClose, channel, warehouses, onSaved
}: {
  open: boolean; onClose(): void; channel: any; warehouses: any[]; onSaved(): void;
}) {
  const [name, setName] = useState(channel.name);
  const [salesPointWarehouseId, setWarehouse] = useState(channel.salesPointWarehouseId);

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/integrations/channels/${channel.id}`, { name, salesPointWarehouseId }),
    onSuccess: onSaved
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить канал</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Название" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Точка продаж">
            <Select value={salesPointWarehouseId} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Отмена</Button></DialogClose>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
