import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, History, Link2, ListTree, Pencil, ScrollText, CheckCircle2, Trash2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { DocumentStatusBadge } from "@/components/status-badge";
import { useCollection } from "@/lib/use-collection";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/api";
import { date, dateTime, rub } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";

type DocumentDescendant = {
  documentId: string;
  number: string;
  title: string;
  documentType: string;
  documentTypeName: string;
  status: "draft" | "posted" | "cancelled";
  accountingDate: string;
  linkType: string;
  parentDocumentId: string;
  depth: number;
};

type BlockedActionState = {
  actionLabel: string;
  descendants: DocumentDescendant[];
};

export function DocumentCardPage() {
  const { id } = useParams();
  const state = { documents: useCollection<any[]>("documents") ?? [], documentLines: useCollection<any[]>("documentLines") ?? [], journalEntries: useCollection<any[]>("journalEntries") ?? [], journalLines: useCollection<any[]>("journalLines") ?? [], chartAccounts: useCollection<any[]>("chartAccounts") ?? [], periods: useCollection<any[]>("periods") ?? [], sales: useCollection<any[]>("sales") ?? [], salesReturns: useCollection<any[]>("salesReturns") ?? [], stockTransfers: useCollection<any[]>("stockTransfers") ?? [], channelFinanceEvents: useCollection<any[]>("channelFinanceEvents") ?? [] };
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [blockedAction, setBlockedAction] = useState<BlockedActionState | null>(null);

  const doc = (state.documents ?? []).find((d: any) => d.id === id);
  const docLines = (state.documentLines ?? []).filter((l: any) => l.documentId === id);
  const entries = (state.journalEntries ?? []).filter((e: any) => e.documentId === id);
  const journalLines = state.journalLines ?? [];
  const accounts = state.chartAccounts ?? [];

  const historyQuery = useQuery({
    queryKey: ["document-history", id],
    queryFn: () => apiGet<any>(`/api/documents/${id}/history`),
    enabled: Boolean(id)
  });
  const linksQuery = useQuery({
    queryKey: ["document-links", id],
    queryFn: () => apiGet<any>(`/api/documents/${id}/links`),
    enabled: Boolean(id)
  });
  const descendantsQuery = useQuery({
    queryKey: ["document-descendants", id],
    queryFn: () => apiGet<DocumentDescendant[]>(`/api/documents/${id}/descendants`),
    enabled: Boolean(id)
  });

  const descendants = descendantsQuery.data ?? [];
  const openBlockedAction = (actionLabel: string, items = descendants) => {
    if (items.length === 0) return false;
    setBlockedAction({ actionLabel, descendants: items });
    return true;
  };
  const runGuardedAction = (actionLabel: string, action: () => void) => {
    if (openBlockedAction(actionLabel)) return;
    action();
  };
  const openBlockedActionFromError = (error: unknown, actionLabel: string) => {
    if (!(error instanceof ApiError) || error.code !== "document_has_descendants") return;
    const items = extractDescendants(error.details);
    if (items.length === 0) return;
    setBlockedAction({ actionLabel, descendants: items });
  };

  const post = useMutation({
    mutationFn: () => apiPost(`/api/documents/${id}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/documents/${id}`),
    onError: (error) => openBlockedActionFromError(error, "удалить"),
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate(returnTo);
    }
  });

  const periods = state.periods ?? [];
  const period = useMemo(
    () => periods.find((p: any) => doc && p.startsOn <= doc.accountingDate && p.endsOn >= doc.accountingDate),
    [periods, doc]
  );
  const returnTo = (location.state as { returnTo?: string } | undefined)?.returnTo ?? "/documents";
  const actionError = remove.error ?? post.error;
  const sourceEntity = useMemo(() => {
    if (!id) return null;
    const sale = (state.sales ?? []).find((candidate: any) => candidate.documentId === id || candidate.financialDocumentId === id);
    if (sale) return { to: `/sales/${sale.id}`, label: "Открыть продажу" };
    const salesReturn = (state.salesReturns ?? []).find((candidate: any) => candidate.documentId === id);
    if (salesReturn) return { to: `/returns/${salesReturn.id}`, label: "Открыть возврат" };
    const transfer = (state.stockTransfers ?? []).find((candidate: any) => candidate.documentId === id);
    if (transfer) return { to: `/inventory/transfers/${transfer.id}`, label: "Открыть перемещение" };
    const financeEvent = (state.channelFinanceEvents ?? []).find((candidate: any) => candidate.documentId === id);
    if (financeEvent) return { to: `/integrations/finance-events/${financeEvent.id}`, label: "Открыть финансовую операцию" };
    return null;
  }, [id, state.channelFinanceEvents, state.sales, state.salesReturns, state.stockTransfers]);

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Документ не найден" breadcrumbs={[{ label: "Документы", to: "/documents" }]} />
        <Button variant="ghost" asChild>
          <Link to="/documents"><ArrowLeft size={14} /> К списку</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Документы", to: "/documents" }, { label: doc.number }]}
        title={
          <span className="flex items-baseline gap-3">
            <span className="font-mono text-2xl">{doc.number}</span>
            <span className="text-base font-medium text-[var(--color-muted-foreground)]">{doc.title}</span>
          </span>
        }
        badge={<DocumentStatusBadge status={doc.status} />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to={returnTo}><ArrowLeft size={14} /> Вернуть в список</Link>
            </Button>
            {doc.status === "draft" && (
              <Button
                variant="secondary"
                onClick={() => runGuardedAction("изменить", () => setEditOpen(true))}
                disabled={descendantsQuery.isLoading}
              >
                <Pencil size={14} /> Редактировать
              </Button>
            )}
            {doc.status === "draft" && (
              <Button onClick={() => post.mutate()} disabled={post.isPending}>
                <CheckCircle2 size={14} /> Провести
              </Button>
            )}
            {doc.status === "draft" && (
              <Button
                variant="secondary"
                onClick={() => runGuardedAction("удалить", () => remove.mutate())}
                disabled={remove.isPending || descendantsQuery.isLoading}
              >
                <Trash2 size={14} /> Удалить
              </Button>
            )}
            {sourceEntity && (
              <Button variant="secondary" asChild>
                <Link to={sourceEntity.to}>{sourceEntity.label}</Link>
              </Button>
            )}
          </div>
        }
      />

      {actionError && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          <AlertTriangle size={14} className="inline mr-1 align-[-2px]" />
          {mutationMessage(actionError)}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <Tabs defaultValue="main">
          <TabsList>
            <TabsTrigger value="main"><ScrollText size={13} /> Основное</TabsTrigger>
            <TabsTrigger value="lines"><ListTree size={13} /> Строки {docLines.length > 0 && <Badge tone="neutral" size="sm">{docLines.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="postings"><ArrowRightLeft size={13} /> Проводки {entries.length > 0 && <Badge tone="neutral" size="sm">{entries.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="links"><Link2 size={13} /> Связи</TabsTrigger>
            <TabsTrigger value="history"><History size={13} /> История</TabsTrigger>
          </TabsList>

          <TabsContent value="main">
            <Card>
              <CardContent className="py-5">
                <DataList
                  columns={2}
                  items={[
                    { label: "Тип документа", value: doc.documentType },
                    { label: "Номер", value: <span className="font-mono">{doc.number}</span> },
                    { label: "Дата учёта", value: date(doc.accountingDate) },
                    { label: "Период", value: period?.label ?? "—", hint: "Открыт" },
                    { label: "Источник", value: sourceLabel(doc.source) },
                    { label: "Сумма", value: rub(doc.amountRub) },
                    { label: "Создан", value: dateTime(doc.createdAt) },
                    { label: "Проведён", value: doc.postedAt ? dateTime(doc.postedAt) : "—" }
                  ]}
                />
                {doc.comment && (
                  <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-muted)]/40 p-3 border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase font-semibold tracking-wide text-[var(--color-muted-foreground)] mb-1">Комментарий</div>
                    <p className="text-sm leading-relaxed">{doc.comment}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lines">
            <Card>
              <CardContent className="p-0">
                {docLines.length === 0 ? (
                  <EmptyState icon={<ListTree size={20} />} title="У документа нет строк" description="Этот тип документа не использует строки или они появятся после конкретных шагов." />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-12">№</TH>
                        <TH className="w-32">Тип строки</TH>
                        <TH>Описание</TH>
                        <TH numeric className="w-24">Кол-во</TH>
                        <TH numeric className="w-32">Сумма</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {docLines.map((l: any) => (
                        <TR key={l.id}>
                          <TD muted className="numeric">{l.lineNo}</TD>
                          <TD muted><span className="text-xs">{l.lineType}</span></TD>
                          <TD>{(l.payload as any)?.description ?? "—"}</TD>
                          <TD numeric muted>{l.qty ?? "—"}</TD>
                          <TD numeric>{l.amountRub ? rub(l.amountRub) : "—"}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="postings">
            <Card>
              <CardContent className="p-0">
                {entries.length === 0 ? (
                  <EmptyState icon={<ArrowRightLeft size={20} />} title="Этот документ не создаёт проводок" />
                ) : (
                  <div className="flex flex-col gap-3 p-3">
                    {entries.map((entry: any) => {
                      const lines = journalLines.filter((l: any) => l.journalEntryId === entry.id);
                      const debit = lines.reduce((s: number, l: any) => s + l.debit, 0);
                      const credit = lines.reduce((s: number, l: any) => s + l.credit, 0);
                      return (
                        <div key={entry.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30">
                          <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--color-border)]">
                            <div>
                              <div className="text-sm font-medium">{entry.memo}</div>
                              <div className="text-[11px] text-[var(--color-muted-foreground)] numeric">{date(entry.accountingDate)}</div>
                            </div>
                            <Badge tone={Math.abs(debit - credit) < 0.01 ? "success" : "danger"}>
                              {Math.abs(debit - credit) < 0.01 ? "сбалансирована" : `Δ ${rub(Math.abs(debit - credit))}`}
                            </Badge>
                          </div>
                          <Table>
                            <THead>
                              <TR>
                                <TH className="w-32">Счёт</TH>
                                <TH>Описание</TH>
                                <TH numeric className="w-32">Дебет</TH>
                                <TH numeric className="w-32">Кредит</TH>
                              </TR>
                            </THead>
                            <TBody>
                              {lines.map((l: any) => {
                                const acc = accounts.find((a: any) => a.code === l.accountCode);
                                return (
                                  <TR key={l.id}>
                                    <TD>
                                      <Link to={`/reports/ledger?account=${l.accountCode}`} className="font-mono text-sm font-semibold text-[var(--color-primary)] hover:underline">
                                        {l.accountCode}
                                      </Link>
                                      <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{acc?.name}</div>
                                    </TD>
                                    <TD muted>{l.memo}</TD>
                                    <TD numeric className={cn(l.debit > 0 ? "font-semibold" : "text-[var(--color-muted-foreground)]/40")}>{l.debit > 0 ? rub(l.debit) : "—"}</TD>
                                    <TD numeric className={cn(l.credit > 0 ? "font-semibold" : "text-[var(--color-muted-foreground)]/40")}>{l.credit > 0 ? rub(l.credit) : "—"}</TD>
                                  </TR>
                                );
                              })}
                            </TBody>
                          </Table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="links">
            <Card>
              <CardContent className="p-0">
                {(linksQuery.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={<Link2 size={20} />} title="Связанных документов нет" />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Связь</TH>
                        <TH>Документ</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {(linksQuery.data ?? []).map((l: any) => (
                        <TR key={l.id} interactive onClick={() => navigate(`/documents/${l.toDocumentId === id ? l.fromDocumentId : l.toDocumentId}`)}>
                          <TD muted><span className="text-xs">{l.linkType}</span></TD>
                          <TD>{l.toDocumentId === id ? l.fromDocumentId : l.toDocumentId}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-0">
                {(historyQuery.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={<History size={20} />} title="История пуста" />
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {(historyQuery.data ?? []).map((h: any) => (
                      <li key={h.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{h.eventType}</div>
                            <div className="text-[11px] text-[var(--color-muted-foreground)]">{h.actorLabel ?? "system"} · {h.entityType}</div>
                          </div>
                          <span className="text-[11px] text-[var(--color-muted-foreground)] numeric">{dateTime(h.createdAt)}</span>
                        </div>
                        {h.reason && <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{h.reason}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Состояние</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Row label="Статус" value={<DocumentStatusBadge status={doc.status} />} />
              <Row label="Период" value={period?.label ?? "—"} hint="Открыт" />
              <Row label="Сумма" value={<span className="numeric font-semibold">{rub(doc.amountRub)}</span>} />
              <Row label="Проводки" value={`${entries.length}`} />
              <Row label="Строки" value={`${docLines.length}`} />
              <Row
                label="Зависимые документы"
                value={
                  descendants.length > 0 ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      onClick={() => openBlockedAction("изменить")}
                    >
                      {descendants.length}
                    </button>
                  ) : (
                    "0"
                  )
                }
              />
            </CardContent>
          </Card>
          {doc.status === "posted" && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              Проведенный документ здесь не редактируется. Если нужно исправить историю, откройте исходную сущность и удалите ее оттуда.
            </div>
          )}
        </aside>
      </div>

      <EditDraftDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        document={doc}
        disabled={doc.status !== "draft"}
      />
      <DescendantsDialog
        open={Boolean(blockedAction)}
        onClose={() => setBlockedAction(null)}
        actionLabel={blockedAction?.actionLabel ?? "изменить"}
        descendants={blockedAction?.descendants ?? []}
      />
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <div className="flex flex-col items-end">
        {value}
        {hint && <span className="text-[10px] text-[var(--color-muted-foreground)]">{hint}</span>}
      </div>
    </div>
  );
}

function sourceLabel(s: string) {
  if (s === "manual") return "Вручную";
  if (s === "system") return "Система";
  if (s === "plugin") return "Плагин";
  if (s === "backfill") return "Backfill";
  return s ?? "—";
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}

function extractDescendants(details: unknown): DocumentDescendant[] {
  if (!details || typeof details !== "object" || !("descendants" in details)) return [];
  const descendants = (details as { descendants?: unknown }).descendants;
  return Array.isArray(descendants) ? descendants as DocumentDescendant[] : [];
}

function descendantLinkLabel(linkType: string) {
  if (linkType === "payment") return "Оплата";
  if (linkType === "sale_finance") return "Начисление";
  if (linkType === "channel_fee") return "Расход по продаже";
  if (linkType === "return") return "Возврат";
  if (linkType === "receipt") return "Приемка";
  if (linkType === "procurement_cost") return "Расход закупки";
  if (linkType === "shortage") return "Недопоставка";
  if (linkType === "correction") return "Исправление";
  return linkType;
}

function DescendantsDialog({
  open,
  onClose,
  actionLabel,
  descendants
}: {
  open: boolean;
  onClose: () => void;
  actionLabel: string;
  descendants: DocumentDescendant[];
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Сначала уберите зависимые документы</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Нельзя {actionLabel} этот документ, пока от него зависят другие документы. Сначала удалите их, потом повторите действие.
          </p>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Документ</TH>
                  <TH>Тип</TH>
                  <TH>Связь</TH>
                  <TH>Статус</TH>
                  <TH className="w-28">Дата</TH>
                </TR>
              </THead>
              <TBody>
                {descendants.map((descendant) => (
                  <TR key={descendant.documentId}>
                    <TD>
                      <Link
                        to={`/documents/${descendant.documentId}`}
                        className="font-mono text-sm font-semibold text-[var(--color-primary)] hover:underline"
                      >
                        {descendant.number}
                      </Link>
                      <div className="text-[11px] text-[var(--color-muted-foreground)] whitespace-normal">
                        {descendant.title}
                      </div>
                    </TD>
                    <TD muted>{descendant.documentTypeName}</TD>
                    <TD muted>{descendantLinkLabel(descendant.linkType)}</TD>
                    <TD><DocumentStatusBadge status={descendant.status} /></TD>
                    <TD muted>{date(descendant.accountingDate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Понятно</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDraftDialog({ open, onClose, document, disabled }: { open: boolean; onClose: () => void; document: any; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [accountingDate, setAccountingDate] = useState(document.accountingDate);
  const [title, setTitle] = useState(document.title);
  const [comment, setComment] = useState(document.comment ?? "");

  const mutation = useMutation({
    mutationFn: () => apiPatch(`/api/documents/${document.id}`, { accountingDate, title, comment, changeReason: "Редактирование черновика" }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onClose();
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Редактировать черновик</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Дата учета">
            <Input type="date" value={accountingDate} onChange={(e) => setAccountingDate(e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Заголовок">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={disabled} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Комментарий">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={disabled} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} disabled={disabled || mutation.isPending || !title.trim()}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
