import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, AlertTriangle, FileText, Lock, RefreshCw, Unlock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppState } from "@/lib/use-app-state";
import { apiGet, apiPost } from "@/api";
import { date, dateTime } from "@/lib/format";

export function ControlsWorkspace() {
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const corrections = state.correctionCases ?? [];
  const jobs = state.recalculationJobs ?? [];
  const periods = state.periods ?? [];
  const documents = state.documents ?? [];
  const products = state.products ?? [];
  const lines = state.documentLines ?? [];
  const [periodFilter, setPeriodFilter] = useState("");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("");
  const [selectedCorrectionId, setSelectedCorrectionId] = useState<string | null>(corrections[0]?.id ?? null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id ?? null);

  const retry = useMutation({
    mutationFn: (jobId: string) => apiPost(`/api/recalculation-jobs/${jobId}/retry`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const queueRecalc = useMutation({
    mutationFn: (scope: Record<string, unknown>) => apiPost("/api/recalculation-jobs", { jobType: "reports", scope }),
    onSuccess: () => queryClient.invalidateQueries()
  });

  const correctionRows = useMemo(() => {
    return corrections
      .slice()
      .sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((correction: any) => {
        const sourceDocument = documents.find((candidate: any) => candidate.id === correction.sourceDocumentId);
        const impactedProductIds = Object.values(correction.impactSummary ?? {}).flatMap((value: any) => typeof value === "string" && value.startsWith("prod_") ? [value] : []);
        const lineProductIds = lines.filter((line: any) => line.documentId === sourceDocument?.id).map((line: any) => line.payload?.productId).filter(Boolean);
        const productIds = [...new Set([...impactedProductIds, ...lineProductIds])];
        const affectedProducts = products.filter((product: any) => productIds.includes(product.id));
        const affectedPeriod = periods.find((period: any) => sourceDocument && sourceDocument.accountingDate >= period.dateFrom && sourceDocument.accountingDate <= period.dateTo);
        const linkedJobs = jobs.filter((job: any) => Object.values(job.scope ?? {}).includes(sourceDocument?.id));
        return { correction, sourceDocument, affectedProducts, affectedPeriod, linkedJobs };
      })
      .filter((row) => {
        if (periodFilter && row.affectedPeriod?.id !== periodFilter) return false;
        if (documentTypeFilter && row.sourceDocument?.documentType !== documentTypeFilter) return false;
        if (statusFilter && row.correction.status !== statusFilter) return false;
        if (productFilter && !row.affectedProducts.some((product: any) => product.id === productFilter)) return false;
        if (jobStatusFilter && !row.linkedJobs.some((job: any) => job.status === jobStatusFilter)) return false;
        return true;
      });
  }, [corrections, documentTypeFilter, documents, jobStatusFilter, jobs, lines, periodFilter, periods, productFilter, products, statusFilter]);
  const documentTypes = useMemo(() => Array.from(new Set(documents.map((document: any) => String(document.documentType)))) as string[], [documents]);

  const selectedCorrection = correctionRows.find((row) => row.correction.id === selectedCorrectionId) ?? correctionRows[0];
  const visibleJobs = useMemo(() => {
    return jobs
      .slice()
      .sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .filter((job: any) => {
        if (jobStatusFilter && job.status !== jobStatusFilter) return false;
        return true;
      });
  }, [jobStatusFilter, jobs]);
  const selectedJob = visibleJobs.find((job: any) => job.id === selectedJobId) ?? visibleJobs[0];
  const openCorrections = correctionRows.filter((row) => !["applied", "cancelled"].includes(row.correction.status)).length;
  const failedJobs = visibleJobs.filter((job: any) => job.status === "failed").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Исправления"
        subtitle="Управление исправлениями документов и пересчетом зависимых данных."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to="/documents">Новое исправление</Link></Button>
            <Button onClick={() => queueRecalc.mutate(selectedCorrection ? { sourceDocumentId: selectedCorrection.sourceDocument?.id } : { requestedAt: new Date().toISOString() })}>
              <RefreshCw size={14} /> Запустить пересчет
            </Button>
            <Button asChild>
              <Link to={`/controls/period-closing/${periods.find((p: any) => p.status === "open")?.id ?? ""}`}>
                <Lock size={14} /> Закрытие периода
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi tone="warning" label="Открытые исправления" value={openCorrections} hint={`${correctionRows.length} кейсов`} />
        <Kpi tone="info" label="Задачи пересчета" value={visibleJobs.length} hint={`${failedJobs} с ошибкой`} />
        <Kpi tone="success" label="Готово" value={correctionRows.filter((row) => row.correction.status === "applied").length} hint="Примененные кейсы" />
        <Kpi tone="neutral" label="Аудит" value={(state.auditEvents ?? []).length} hint="Записей в журнале действий" />
      </div>

      <Tabs defaultValue="corrections">
        <TabsList>
          <TabsTrigger value="corrections">Исправления</TabsTrigger>
          <TabsTrigger value="recalc">Пересчёты</TabsTrigger>
          <TabsTrigger value="audit">Аудит</TabsTrigger>
        </TabsList>
        <TabsContent value="corrections">
          <Card>
            <CardContent className="flex flex-wrap gap-2 py-4">
              <Select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} className="w-44">
                <option value="">Все периоды</option>
                {periods.map((period: any) => <option key={period.id} value={period.id}>{period.label}</option>)}
              </Select>
              <Select value={documentTypeFilter} onChange={(event) => setDocumentTypeFilter(event.target.value)} className="w-44">
                <option value="">Все типы документов</option>
                {documentTypes.map((documentType) => <option key={documentType} value={documentType}>{documentType}</option>)}
              </Select>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-40">
                <option value="">Все статусы</option>
                <option value="draft">Черновик</option>
                <option value="previewed">Проверено</option>
                <option value="applied">Готово</option>
                <option value="failed">Ошибка</option>
              </Select>
              <Select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="w-44">
                <option value="">Все товары</option>
                {products.map((product: any) => <option key={product.id} value={product.id}>{product.sku}</option>)}
              </Select>
              <Select value={jobStatusFilter} onChange={(event) => setJobStatusFilter(event.target.value)} className="w-44">
                <option value="">Любой статус задач</option>
                <option value="queued">В очереди</option>
                <option value="running">Выполняется</option>
                <option value="completed">Готово</option>
                <option value="failed">Ошибка</option>
              </Select>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="flex flex-col gap-5">
              <Card className="min-w-0">
                <CardHeader>
                  <div>
                    <CardTitle>Исправления</CardTitle>
                    <CardDescription>Кейсы исправлений по документам и связанные пересчеты.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {correctionRows.length === 0 ? (
                    <EmptyState icon={<FileText size={20} />} title="Исправлений нет" description="Здесь появятся корректирующие документы и сторно." />
                  ) : (
                    <Table>
                      <THead><TR><TH>Создано</TH><TH>Источник</TH><TH>Причина</TH><TH>Период</TH><TH>Влияние</TH><TH>Статус</TH><TH>Кто</TH></TR></THead>
                      <TBody>
                        {correctionRows.map((row) => (
                          <TR key={row.correction.id} interactive selected={row.correction.id === selectedCorrection?.correction.id} onClick={() => setSelectedCorrectionId(row.correction.id)}>
                            <TD muted className="text-xs numeric">{dateTime(row.correction.createdAt)}</TD>
                            <TD>{row.sourceDocument ? <Link to={`/documents/${row.sourceDocument.id}`} className="text-[var(--color-primary)] hover:underline" onClick={(event) => event.stopPropagation()}>{row.sourceDocument.number}</Link> : row.correction.sourceDocumentId}</TD>
                            <TD>{row.correction.reason}</TD>
                            <TD muted>{row.affectedPeriod?.label ?? "—"}</TD>
                            <TD><Badge tone={impactTone(row.correction.impactSummary)}>{impactLabel(row.correction.impactSummary)}</Badge></TD>
                            <TD><Badge tone={correctionTone(row.correction.status)}>{correctionLabel(row.correction.status)}</Badge></TD>
                            <TD muted>{row.sourceDocument?.source === "manual" ? "Оператор" : "System"}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <div>
                    <CardTitle>Задачи пересчета</CardTitle>
                    <CardDescription>Перестраивают отчеты, себестоимость и зависимые продажи после исправления.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {visibleJobs.length === 0 ? (
                    <EmptyState icon={<RefreshCw size={20} />} title="Пересчетов пока нет" />
                  ) : (
                    <Table>
                      <THead><TR><TH>ID</TH><TH>Тип</TH><TH>Статус</TH><TH numeric>Прогресс</TH><TH>Результат</TH></TR></THead>
                      <TBody>
                        {visibleJobs.map((job: any) => (
                          <TR key={job.id} interactive selected={job.id === selectedJob?.id} onClick={() => setSelectedJobId(job.id)}>
                            <TD muted className="font-mono text-xs">{job.id}</TD>
                            <TD>{jobLabel(job.jobType)}</TD>
                            <TD><Badge tone={jobTone(job.status)}>{jobStatus(job.status)}</Badge></TD>
                            <TD numeric>{job.progress}%</TD>
                            <TD>
                              {job.status === "failed" ? (
                                <Button variant="link" size="sm" onClick={(event) => { event.stopPropagation(); retry.mutate(job.id); }} disabled={retry.isPending}>Повторить</Button>
                              ) : (
                                <span className="text-xs text-[var(--color-muted-foreground)]">{job.finishedAt ? "Успешно" : "—"}</span>
                              )}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="h-fit min-w-0 overflow-hidden">
              <CardHeader className="min-w-0">
                <div className="min-w-0">
                  <CardTitle>{selectedCorrection ? `Исправление ${selectedCorrection.correction.id}` : "Детали исправления"}</CardTitle>
                  <CardDescription>{selectedCorrection?.sourceDocument ? `${selectedCorrection.sourceDocument.number} · ${selectedCorrection.sourceDocument.documentType}` : "Выберите кейс"}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="min-w-0 flex flex-col gap-4">
                {!selectedCorrection ? (
                  <EmptyState icon={<AlertTriangle size={20} />} title="Кейс не выбран" />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <Info label="Источник" value={selectedCorrection.sourceDocument ? <Link to={`/documents/${selectedCorrection.sourceDocument.id}`} className="text-[var(--color-primary)] hover:underline">{selectedCorrection.sourceDocument.number}</Link> : selectedCorrection.correction.sourceDocumentId} />
                      <Info label="Период влияния" value={selectedCorrection.affectedPeriod?.label ?? "—"} />
                      <Info label="Причина" value={selectedCorrection.correction.reason} />
                      <Info label="Статус" value={<Badge tone={correctionTone(selectedCorrection.correction.status)}>{correctionLabel(selectedCorrection.correction.status)}</Badge>} />
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Что затрагивается</div>
                      <div className="flex flex-wrap gap-2">
                        {(selectedCorrection.affectedProducts.length > 0 ? selectedCorrection.affectedProducts.map((product: any) => product.sku) : ["Без товарной привязки"]).map((item: string) => (
                          <Badge key={item} tone="neutral">{item}</Badge>
                        ))}
                        {Object.keys(selectedCorrection.correction.impactSummary ?? {}).length === 0 && <Badge tone="neutral">Только документ</Badge>}
                      </div>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">История и зависимые задачи</div>
                      <div className="space-y-2">
                        {selectedCorrection.linkedJobs.length === 0 ? (
                          <div className="text-[var(--color-muted-foreground)]">Задачи пересчета еще не ставились.</div>
                        ) : (
                          selectedCorrection.linkedJobs.map((job: any) => (
                            <div key={job.id} className="flex items-center justify-between gap-3">
                              <span>{jobLabel(job.jobType)}</span>
                              <Badge tone={jobTone(job.status)}>{jobStatus(job.status)}</Badge>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {selectedCorrection.sourceDocument && <Button variant="secondary" asChild><Link to={`/documents/${selectedCorrection.sourceDocument.id}`}>Открыть документ</Link></Button>}
                      <Button onClick={() => queueRecalc.mutate({ sourceDocumentId: selectedCorrection.sourceDocument?.id })} disabled={queueRecalc.isPending}>Запустить пересчет</Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="recalc">
          <Card>
            <CardContent className="p-0">
              {visibleJobs.length === 0 ? (
                <EmptyState icon={<RefreshCw size={20} />} title="Пересчётов пока нет" />
              ) : (
                <Table>
                  <THead><TR><TH>Тип</TH><TH>Статус</TH><TH numeric>Прогресс</TH><TH>Область</TH><TH>Действие</TH></TR></THead>
                  <TBody>
                    {visibleJobs.map((j: any) => (
                      <TR key={j.id}>
                        <TD>{jobLabel(j.jobType)}</TD>
                        <TD><Badge tone={jobTone(j.status)}>{jobStatus(j.status)}</Badge></TD>
                        <TD numeric>{j.progress}%</TD>
                        <TD muted className="text-xs">{Object.keys(j.scope ?? {}).join(", ") || "—"}</TD>
                        <TD>{j.status === "failed" ? <Button variant="link" size="sm" onClick={() => retry.mutate(j.id)} disabled={retry.isPending}>Повторить задачу</Button> : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="audit">
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead><TR><TH>Дата</TH><TH>Действие</TH><TH>Сущность</TH><TH>Кто</TH></TR></THead>
                <TBody>
                  {(state.auditEvents ?? []).slice(-25).reverse().map((e: any) => (
                    <TR key={e.id}>
                      <TD muted className="text-xs numeric">{dateTime(e.createdAt)}</TD>
                      <TD><Badge tone="neutral">{e.eventType}</Badge></TD>
                      <TD muted className="font-mono text-xs">{e.entityType} {e.entityId}</TD>
                      <TD muted>{e.actorLabel ?? "system"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}

function correctionTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "applied") return "success";
  if (status === "previewed") return "info";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "neutral";
  return "warning";
}

function correctionLabel(status: string) {
  if (status === "draft") return "Черновик";
  if (status === "previewed") return "К проверке";
  if (status === "applied") return "Готово";
  if (status === "cancelled") return "Отменено";
  if (status === "failed") return "Ошибка";
  return status;
}

function jobTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "completed") return "success";
  if (status === "running") return "info";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "neutral";
  return "warning";
}

function jobStatus(status: string) {
  if (status === "queued") return "В очереди";
  if (status === "running") return "Выполняется";
  if (status === "completed") return "Готово";
  if (status === "failed") return "Ошибка";
  if (status === "cancelled") return "Отменено";
  return status;
}

function jobLabel(jobType: string) {
  if (jobType === "inventory_cost") return "Себестоимость и остатки";
  if (jobType === "sales_profit") return "Себестоимость продаж";
  if (jobType === "settlements") return "Взаиморасчеты";
  if (jobType === "reports") return "Финансовый результат";
  if (jobType === "external_event_reprocess") return "Перепроцессинг интеграций";
  return jobType;
}

function impactTone(impact: Record<string, unknown>): "success" | "warning" | "danger" | "neutral" {
  const keys = Object.keys(impact ?? {});
  if (keys.some((key) => ["sales", "returns", "reports"].includes(key))) return "danger";
  if (keys.length > 0) return "warning";
  return "neutral";
}

function impactLabel(impact: Record<string, unknown>) {
  const keys = Object.keys(impact ?? {});
  if (keys.length === 0) return "Локально";
  if (keys.some((key) => ["sales", "returns", "reports"].includes(key))) return "Высокое";
  return "Среднее";
}

export function PeriodClosingPage() {
  const { periodId } = useParams();
  const { state } = useAppState();
  const period = (state.periods ?? []).find((p: any) => p.id === periodId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closingQuery = useQuery({
    queryKey: ["period-closing", periodId],
    queryFn: () => apiGet<any>(`/api/accounting-periods/${periodId}/closing`),
    enabled: Boolean(periodId)
  });
  const reportQuery = useQuery({
    queryKey: ["period-closing-report", periodId],
    queryFn: () => apiGet<any>(`/api/accounting-periods/${periodId}/closing-report`),
    enabled: Boolean(periodId)
  });

  const runChecks = useMutation({
    mutationFn: () => apiPost(`/api/accounting-periods/${periodId}/closing/run-checks`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["period-closing", periodId] });
      queryClient.invalidateQueries();
    }
  });
  const close = useMutation({
    mutationFn: () => apiPost(`/api/periods/${periodId}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["period-closing", periodId] });
      queryClient.invalidateQueries();
      navigate(`/controls/period-closing/${periodId}/report`);
    }
  });
  const generateReports = useMutation({
    mutationFn: () => apiPost(`/api/accounting-periods/${periodId}/closing/generate-reports`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["period-closing-report", periodId] });
      queryClient.invalidateQueries({ queryKey: ["period-closing", periodId] });
      queryClient.invalidateQueries();
    }
  });
  const run = closingQuery.data;
  const checks = run?.checks ?? [];
  const groupedChecks = ["documents", "inventory", "channels", "money", "settlements", "reports", "recalculations"].map((area) => ({
    area,
    items: checks.filter((check: any) => check.area === area)
  })).filter((group) => group.items.length > 0);
  const requiredFailures = checks.filter((check: any) => check.severity === "required" && check.status === "failed").length;
  const warningFailures = checks.filter((check: any) => check.severity === "warning" && check.status === "failed").length;
  const snapshots = reportQuery.data?.snapshots ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Контроль", to: "/controls" }, { label: period?.label ?? "Период" }]}
        title={`Закрытие периода ${period?.label ?? ""}`}
        subtitle="Перед закрытием система проверяет документы, склад, маркетплейс-события, деньги, взаиморасчеты, пересчеты и актуальность итоговых отчетов."
        actions={<Button variant="ghost" asChild><Link to="/controls"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi tone={requiredFailures > 0 ? "danger" : "success"} label="Обязательные проверки" value={checks.filter((check: any) => check.severity === "required").length} hint={requiredFailures > 0 ? `Провалов: ${requiredFailures}` : "Все пройдены"} />
        <Kpi tone={warningFailures > 0 ? "warning" : "success"} label="Предупреждения" value={checks.filter((check: any) => check.severity === "warning").length} hint={warningFailures > 0 ? `Требуют внимания: ${warningFailures}` : "Критичных предупреждений нет"} />
        <Kpi tone="info" label="Отчеты закрытия" value={snapshots.length} hint={snapshots.length ? "Снимки уже сформированы" : "Нужно сформировать"} />
        <Kpi tone="neutral" label="Статус периода" value={period?.status === "closed" ? "Закрыт" : "Открыт"} hint={`${date(period?.startsOn)} – ${date(period?.endsOn)}`} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Чеклист закрытия</CardTitle>
            <CardDescription>Каждая группа ведет на свой drilldown. Пока обязательные проверки не пройдены, кнопка закрытия недоступна.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupedChecks.length === 0 ? (
            <EmptyState icon={<AlertTriangle size={20} />} title="Чеклист еще не запускался" description="Запустите проверку, чтобы увидеть блокеры и предупреждения." />
          ) : (
            groupedChecks.map((group) => (
              <div key={group.area} className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-muted)]/30">
                  <div className="text-sm font-semibold">{closingAreaLabel(group.area)}</div>
                </div>
                <Table>
                  <THead><TR><TH>Проверка</TH><TH>Статус</TH><TH numeric>Кол-во</TH><TH>Важность</TH><TH>Детали</TH><TH>Открыть</TH></TR></THead>
                  <TBody>
                    {group.items.map((check: any) => (
                      <TR key={check.code}>
                        <TD>{check.title}</TD>
                        <TD><Badge tone={closingStatusTone(check.status)}>{closingStatusLabel(check.status)}</Badge></TD>
                        <TD numeric>{check.count ?? 0}</TD>
                        <TD><Badge tone={check.severity === "required" ? "danger" : "warning"}>{check.severity === "required" ? "Обязательная" : "Предупреждение"}</Badge></TD>
                        <TD muted className="text-xs">{check.details}</TD>
                        <TD>{check.drilldownPath ? <Button variant="link" size="sm" asChild><Link to={check.drilldownPath}>Открыть проблему</Link></Button> : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => runChecks.mutate()} disabled={runChecks.isPending}><RefreshCw size={14} /> Запустить проверку</Button>
          <Button variant="secondary" onClick={() => generateReports.mutate()} disabled={generateReports.isPending}>Сформировать отчеты</Button>
          <Button onClick={() => close.mutate()} disabled={close.isPending || requiredFailures > 0 || checks.length === 0}><Lock size={14} /> Закрыть период</Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Финальные отчеты</CardTitle>
            <CardDescription>После формирования снимков можно перейти к отчету закрытия и открыть итоговые представления.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild><Link to={`/controls/period-closing/${periodId}/report`}>Отчет закрытия</Link></Button>
          <Button variant="secondary" asChild><Link to="/reports/profit-and-loss">P&L</Link></Button>
          <Button variant="secondary" asChild><Link to="/reports/balance-sheet">Баланс</Link></Button>
          <Button variant="secondary" asChild><Link to="/reports/unit-economics">Юнит-экономика</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function PeriodClosingReportPage() {
  const { periodId } = useParams();
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const period = (state.periods ?? []).find((candidate: any) => candidate.id === periodId);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reportQuery = useQuery({
    queryKey: ["period-closing-report", periodId],
    queryFn: () => apiGet<any>(`/api/accounting-periods/${periodId}/closing-report`),
    enabled: Boolean(periodId)
  });
  const reopen = useMutation({
    mutationFn: () => apiPost(`/api/accounting-periods/${periodId}/reopen`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setReopenOpen(false);
      setReason("");
    }
  });

  const run = reportQuery.data?.run;
  const snapshots = reportQuery.data?.snapshots ?? [];
  const warnings = (run?.checks ?? []).filter((check: any) => check.severity === "warning" && (check.status === "failed" || check.status === "accepted"));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Контроль", to: "/controls" }, { label: period?.label ?? "Период" }, { label: "Отчет закрытия" }]}
        title="Отчет закрытия периода"
        subtitle="Сводка по закрытому месяцу, финальным снимкам отчетов и политике исправлений после блокировки периода."
        badge={<Badge tone={period?.status === "closed" ? "success" : "warning"}>{period?.status === "closed" ? "Период закрыт" : "Период открыт"}</Badge>}
        actions={
          <div className="flex gap-2">
            {period?.status === "closed" && <Button variant="secondary" onClick={() => setReopenOpen(true)}><Unlock size={14} /> Открыть период</Button>}
            <Button asChild><Link to="/controls/corrections">Создать корректировку</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi tone="success" label="Закрыт" value={period?.closedAt ? dateTime(period.closedAt) : "—"} hint="Дата закрытия" />
        <Kpi tone="info" label="Кто закрыл" value="system" hint="Пока без авторизации пользователей" />
        <Kpi tone="primary" label="Снимков отчетов" value={snapshots.length} hint="P&L, баланс, cash, inventory, unit" />
        <Kpi tone={warnings.length > 0 ? "warning" : "success"} label="Предупреждения" value={warnings.length} hint={warnings.length > 0 ? "Приняты или оставлены" : "Нет"} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Сводка закрытия</CardTitle>
            <CardDescription>Краткий итог checklist без редактирования периода.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Info label="Период" value={period?.label ?? "—"} />
          <Info label="Статус run" value={<Badge tone={run?.status === "closed" ? "success" : run?.status === "blocked" ? "danger" : "warning"}>{run?.status === "closed" ? "Закрыт" : run?.status === "blocked" ? "Есть блокеры" : "Черновик"}</Badge>} />
          <Info label="Обязательные проверки" value={String((run?.checks ?? []).filter((check: any) => check.severity === "required").length)} />
          <Info label="Пройдено" value={String((run?.checks ?? []).filter((check: any) => check.status === "passed").length)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Итоговые отчеты</CardTitle>
            <CardDescription>Открывают текущие итоговые экраны; снимки закрытия уже сохранены в системе.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshots.length === 0 ? (
            <div className="text-sm text-[var(--color-muted-foreground)]">Снимки еще не сформированы. Вернитесь на чеклист и нажмите «Сформировать отчеты».</div>
          ) : (
            snapshots.map((snapshot: any) => (
              <div key={snapshot.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{snapshotLabel(snapshot.reportType)}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">Сформирован {dateTime(snapshot.createdAt)}</div>
                </div>
                <Button variant="secondary" asChild><Link to={snapshotRoute(snapshot.reportType)}>Открыть отчет</Link></Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Предупреждения и политика исправлений</CardTitle>
            <CardDescription>После закрытия периода прямое редактирование документов запрещено. Используйте исправления текущим периодом или сторно.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {warnings.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-3 text-sm">Предупреждений не осталось.</div>
          ) : (
            warnings.map((check: any) => (
              <div key={check.code} className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
                <div className="font-medium">{check.title}</div>
                <div className="mt-1 text-sm text-[var(--color-foreground)]/75">{check.details}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Открыть период заново?</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-[var(--color-muted-foreground)]">Переоткрытие периода — исключительный шаг. Укажите причину, чтобы запись попала в аудит.</p>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина переоткрытия" />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={() => reopen.mutate()} disabled={reopen.isPending || !reason.trim()}>
              <Unlock size={14} /> Открыть период
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function closingAreaLabel(area: string) {
  if (area === "documents") return "Документы";
  if (area === "inventory") return "Склад";
  if (area === "channels") return "Каналы";
  if (area === "money") return "Деньги";
  if (area === "settlements") return "Взаиморасчеты";
  if (area === "reports") return "Отчеты";
  if (area === "recalculations") return "Пересчеты";
  return area;
}

function closingStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "passed") return "success";
  if (status === "accepted") return "neutral";
  if (status === "failed") return "danger";
  return "warning";
}

function closingStatusLabel(status: string) {
  if (status === "passed") return "Пройдено";
  if (status === "accepted") return "Принято";
  if (status === "failed") return "Ошибка";
  return "Черновик";
}

function snapshotLabel(reportType: string) {
  if (reportType === "profit-and-loss") return "P&L";
  if (reportType === "balance-sheet") return "Баланс";
  if (reportType === "cash-flow") return "Движение денег";
  if (reportType === "inventory") return "Отчет по складу";
  if (reportType === "unit-economics") return "Юнит-экономика";
  return reportType;
}

function snapshotRoute(reportType: string) {
  if (reportType === "profit-and-loss") return "/reports/profit-and-loss";
  if (reportType === "balance-sheet") return "/reports/balance-sheet";
  if (reportType === "cash-flow") return "/reports";
  if (reportType === "inventory") return "/inventory";
  if (reportType === "unit-economics") return "/reports/unit-economics";
  return "/reports";
}
