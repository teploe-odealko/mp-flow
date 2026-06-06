import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Field, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CheckLabel } from "@/components/ui/checkbox";
import { Pagination } from "@/components/ui/pagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { DocumentStatusBadge } from "@/components/status-badge";
import { useAppState } from "@/lib/use-app-state";
import { useCollection } from "@/lib/use-collection";
import { date, rub, dateTime } from "@/lib/format";
import { apiPost } from "@/api";
import { EmptyState } from "@/components/ui/empty-state";
import { paginateRows } from "@/lib/pagination";

export function DocumentsPage() {
  const { workingPeriodId } = useAppState();
  const docs = useCollection<any[]>("documents") ?? [];
  const lines = useCollection<any[]>("journalLines") ?? [];
  const entries = useCollection<any[]>("journalEntries") ?? [];
  const links = useCollection<any[]>("documentLinks") ?? [];
  const periods = useCollection<any[]>("periods") ?? [];
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [periodId, setPeriodId] = useState(workingPeriodId);
  const [status, setStatus] = useState("");
  const [docType, setDocType] = useState("");
  const [source, setSource] = useState("");
  const [withPostings, setWithPostings] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(params.get("selected") ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (workingPeriodId && !periodId) setPeriodId(workingPeriodId);
  }, [workingPeriodId, periodId]);

  useEffect(() => {
    setPage(1);
  }, [search, periodId, status, docType, source, withPostings]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return docs
      .slice()
      .reverse()
      .filter((d: any) => {
        if (q && !`${d.number} ${d.title} ${d.comment ?? ""}`.toLowerCase().includes(q)) return false;
        if (periodId) {
          const p = periods.find((p: any) => p.id === periodId);
          if (p && (d.accountingDate < p.startsOn || d.accountingDate > p.endsOn)) return false;
        }
        if (status && d.status !== status) return false;
        if (docType && d.documentType !== docType) return false;
        if (source && d.source !== source) return false;
        if (withPostings) {
          const hasEntry = entries.some((e: any) => e.documentId === d.id);
          if (!hasEntry) return false;
        }
        return true;
      });
  }, [docs, search, periodId, status, docType, source, withPostings, periods, entries]);

  const docTypes = Array.from(new Set(docs.map((d: any) => d.documentType as string)));
  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);
  const selectedDoc = paged.find((doc: any) => doc.id === selectedId) ?? paged[0];

  useEffect(() => {
    if (!selectedDoc) return;
    if (selectedDoc.id === selectedId && params.get("selected") === selectedId) return;
    const next = new URLSearchParams(params);
    next.set("selected", selectedDoc.id);
    setSelectedId(selectedDoc.id);
    setParams(next, { replace: true });
  }, [selectedDoc, selectedId, params, setParams]);

  function resetFilters() {
    setSearch("");
    setPeriodId(workingPeriodId || "");
    setStatus("");
    setDocType("");
    setSource("");
    setWithPostings(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Документы"
        subtitle="Документ фиксирует бизнес-событие. После проведения он создаёт проводки, складские движения и связи."
        actions={
          <Button onClick={() => setNoteOpen(true)}>
            <Plus size={14} /> Создать учётную заметку
          </Button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input className="pl-9" placeholder="Поиск по номеру, описанию или комментарию" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-36">
                <option value="">Все периоды</option>
                {periods.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </Select>
              <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-44">
                <option value="">Все типы</option>
                {(docTypes as string[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
                <option value="">Все статусы</option>
                <option value="draft">Черновик</option>
                <option value="posted">Проведён</option>
                <option value="cancelled">Отменён</option>
                <option value="corrected">Исправлен</option>
              </Select>
              <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-36">
                <option value="">Все источники</option>
                <option value="manual">Вручную</option>
                <option value="system">Система</option>
                <option value="plugin">Плагин</option>
                <option value="backfill">Backfill</option>
              </Select>
              <CheckLabel checked={withPostings} onCheckedChange={setWithPostings} label="Только с проводками" />
            </div>

            {docs.length === 0 ? (
              <div className="py-12 px-5">
                <EmptyState
                  icon={<FileText size={20} />}
                  title="Документы появятся после стартовых остатков, заказов, оплат и приемок"
                  description="Для проверки document core можно уже сейчас создать учетную заметку."
                  action={<Button onClick={() => setNoteOpen(true)}>Создать учетную заметку</Button>}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10"></TH>
                    <TH className="w-32">Номер</TH>
                    <TH className="w-28">Дата учета</TH>
                    <TH>Описание</TH>
                    <TH className="w-32">Тип</TH>
                    <TH className="w-24">Статус</TH>
                    <TH className="w-28">Источник</TH>
                    <TH numeric className="w-24">Проводки</TH>
                    <TH numeric className="w-20">Связи</TH>
                    <TH numeric className="w-32">Сумма</TH>
                    <TH className="w-32">Изменён</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.length === 0 && (
                    <TR>
                      <TD colSpan={11} className="text-center py-10 text-[var(--color-muted-foreground)]">
                        <div className="flex flex-col items-center gap-3">
                          <span>По выбранным фильтрам документов нет</span>
                          <Button variant="ghost" size="sm" onClick={resetFilters}>Сбросить фильтры</Button>
                        </div>
                      </TD>
                    </TR>
                  )}
                  {paged.map((doc: any) => {
                    const entryCount = entries.filter((e: any) => e.documentId === doc.id).length;
                    const lineCount = lines.filter((l: any) => entries.some((e: any) => e.id === l.journalEntryId && e.documentId === doc.id)).length;
                    const linkCount = links.filter((l: any) => l.fromDocumentId === doc.id || l.toDocumentId === doc.id).length;
                    return (
                      <TR key={doc.id} interactive selected={doc.id === selectedDoc?.id} onClick={() => setSelectedId(doc.id)}>
                        <TD><input type="checkbox" aria-label={`Выбрать документ ${doc.number}`} /></TD>
                        <TD>
                          <Link to={`/documents/${doc.id}`} state={{ returnTo: `/documents?${params.toString() || `selected=${doc.id}`}` }} className="text-[var(--color-primary)] font-mono font-semibold text-sm hover:underline">
                            {doc.number}
                          </Link>
                        </TD>
                        <TD muted className="numeric">{date(doc.accountingDate)}</TD>
                        <TD>
                          <Link to={`/documents/${doc.id}`} state={{ returnTo: `/documents?${params.toString() || `selected=${doc.id}`}` }} className="font-medium hover:text-[var(--color-primary)] transition-colors">
                            {doc.title}
                          </Link>
                          {doc.comment && <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{doc.comment}</div>}
                        </TD>
                        <TD muted><span className="text-xs">{doc.documentType}</span></TD>
                        <TD><DocumentStatusBadge status={doc.status} /></TD>
                        <TD muted><span className="text-xs">{sourceLabel(doc.source)}</span></TD>
                        <TD numeric muted className="text-xs">{entryCount > 0 ? `${entryCount} (${lineCount})` : "—"}</TD>
                        <TD numeric muted className="text-xs">{linkCount || "—"}</TD>
                        <TD numeric className="font-semibold">{rub(doc.amountRub)}</TD>
                        <TD muted className="text-xs numeric">{doc.postedAt ? dateTime(doc.postedAt) : doc.createdAt ? dateTime(doc.createdAt) : "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {filtered.length > 0 && (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
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
          <CardContent className="py-4">
            {selectedDoc ? (
              <DocumentPreview
                document={selectedDoc}
                entryCount={entries.filter((entry: any) => entry.documentId === selectedDoc.id).length}
                linkCount={links.filter((link: any) => link.fromDocumentId === selectedDoc.id || link.toDocumentId === selectedDoc.id).length}
              />
            ) : (
              <EmptyState icon={<Eye size={20} />} title="Выберите документ" description="Справа появится быстрый preview без перехода в карточку." />
            )}
          </CardContent>
        </Card>
      </div>

      <CreateNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} />
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

function CreateNoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [accountingDate, setAccountingDate] = useState(new Date().toISOString().slice(0, 10));
  const [comment, setComment] = useState("");
  const [rows, setRows] = useState<string[]>([""]);

  const create = useMutation({
    mutationFn: (postNow: boolean) =>
      apiPost("/api/documents", {
        documentType: "accounting_note",
        title: "Учётная заметка",
        accountingDate,
        comment,
        source: "manual",
        amountRub: 0,
        lines: rows
          .map((row) => row.trim())
          .filter(Boolean)
          .map((description) => ({ lineType: "note_line", payload: { description } })),
        post: postNow
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onClose();
      setComment("");
      setRows([""]);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={16} /> Создать учётную заметку
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">
            Информационный документ без проводок, складских движений и денежных операций. Используется для фиксации событий учётной правды и связей между документами.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата учёта" required>
              <Input type="date" value={accountingDate} onChange={(e) => setAccountingDate(e.target.value)} />
            </Field>
            <Field label="Номер" hint="Если пусто — система выдаст следующий">
              <Input placeholder="Авто" disabled />
            </Field>
          </div>
          <Field label="Комментарий" required>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="О чём эта заметка?" />
          </Field>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-muted-foreground)]">Строки заметки</span>
              <Button variant="ghost" size="sm" onClick={() => setRows((current) => [...current, ""])}>Добавить строку</Button>
            </div>
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input value={row} onChange={(e) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value : item))} placeholder={`Описание строки ${index + 1}`} />
                {rows.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    Удалить
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Отмена</Button>
          </DialogClose>
          <Button variant="secondary" onClick={() => create.mutate(false)} disabled={create.isPending || !comment.trim()}>
            {create.isPending ? "Сохраняем…" : "Сохранить черновик"}
          </Button>
          <Button onClick={() => create.mutate(true)} disabled={create.isPending || !comment.trim()}>
            {create.isPending ? "Сохраняем…" : "Сохранить и провести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPreview({ document, entryCount, linkCount }: { document: any; entryCount: number; linkCount: number }) {
  const queryClient = useQueryClient();
  const post = useMutation({
    mutationFn: () => apiPost(`/api/documents/${document.id}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-lg font-semibold">{document.number}</div>
          <div className="text-sm font-medium mt-1">{document.title}</div>
        </div>
        <DocumentStatusBadge status={document.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <PreviewMetric label="Дата учета" value={date(document.accountingDate)} />
        <PreviewMetric label="Источник" value={sourceLabel(document.source)} />
        <PreviewMetric label="Проводки" value={String(entryCount)} />
        <PreviewMetric label="Связи" value={String(linkCount)} />
      </div>
      {document.comment && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-xs leading-relaxed">
          {document.comment}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link to={`/documents/${document.id}`}>Открыть</Link>
        </Button>
        {document.status === "draft" && (
          <Button variant="secondary" onClick={() => post.mutate()} disabled={post.isPending}>
            Провести
          </Button>
        )}
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)] font-semibold">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
