import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { useAppState } from "@/lib/use-app-state";
import { apiGet } from "@/api";
import { date } from "@/lib/format";
import { rub } from "@/lib/format";
import { cn } from "@/lib/cn";
import { paginateRows } from "@/lib/pagination";

export function JournalPage() {
  const { workingPeriodId } = useAppState();
  const workspaceQuery = useJournalWorkspace();
  const entries = workspaceQuery.data?.entries ?? [];
  const lines = workspaceQuery.data?.lines ?? [];
  const periods = workspaceQuery.data?.periods ?? [];
  const accounts = workspaceQuery.data?.accounts ?? [];
  const docs = workspaceQuery.data?.documents ?? [];

  const [search, setSearch] = useState("");
  const [periodId, setPeriodId] = useState(workingPeriodId);
  const [accountCode, setAccountCode] = useState("");
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const navigate = useNavigate();

  useEffect(() => {
    if (workingPeriodId && !periodId) {
      setPeriodId(workingPeriodId);
    }
  }, [workingPeriodId, periodId]);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [search, periodId, accountCode, source]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries
      .slice()
      .reverse()
      .filter((e: any) => {
        if (q && !`${e.memo} ${e.id}`.toLowerCase().includes(q)) return false;
        if (periodId) {
          const p = periods.find((p: any) => p.id === periodId);
          if (p && (e.accountingDate < p.startsOn || e.accountingDate > p.endsOn)) return false;
        }
        if (accountCode) {
          const has = lines.some((l: any) => l.journalEntryId === e.id && l.accountCode === accountCode);
          if (!has) return false;
        }
        if (source) {
          const doc = docs.find((d: any) => d.id === e.documentId);
          if (doc?.source !== source) return false;
        }
        return true;
      });
  }, [entries, lines, search, periodId, accountCode, source, periods, docs]);

  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);

  const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Журнал операций"
        subtitle="Хронологический список проведённых операций. Каждая проводка сбалансирована."
        breadcrumbs={[{ label: "Учёт", to: "/accounting" }, { label: "Журнал" }]}
        badge={
          balanced ? (
            <Badge tone="success">
              <CheckCircle2 size={11} /> Дебет = Кредит
            </Badge>
          ) : (
            <Badge tone="danger">
              <AlertTriangle size={11} /> Расхождение
            </Badge>
          )
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input className="pl-9" placeholder="Поиск по описанию или номеру" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-40">
              <option value="">Все периоды</option>
              {periods.map((p: any) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
            <Select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className="w-44">
              <option value="">Все счета</option>
              {accounts.map((a: any) => (
                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
              ))}
            </Select>
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-36">
              <option value="">Все источники</option>
              <option value="manual">Вручную</option>
              <option value="system">Система</option>
              <option value="plugin">Плагин</option>
              <option value="backfill">Backfill</option>
            </Select>
          </div>

          <Table>
            <THead>
              <TR>
                <TH className="w-10"></TH>
                <TH className="w-28">Дата</TH>
                <TH className="w-28">Операция</TH>
                <TH>Описание</TH>
                <TH numeric className="w-32">Сумма</TH>
                <TH className="w-24">Статус</TH>
                <TH className="w-28">Источник</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.length === 0 && (
                <TR>
                  <TD colSpan={7} className="text-center py-10 text-[var(--color-muted-foreground)]">
                    Записей по фильтрам нет
                  </TD>
                </TR>
              )}
              {paged.map((entry: any) => {
                const entryLines = lines.filter((l: any) => l.journalEntryId === entry.id);
                const entryDebit = entryLines.reduce((s: number, l: any) => s + l.debit, 0);
                const entryCredit = entryLines.reduce((s: number, l: any) => s + l.credit, 0);
                const isOpen = expanded === entry.id;
                const doc = docs.find((d: any) => d.id === entry.documentId);
                const entryNumber = journalEntryNumber(entries, entry.id);
                const source = doc?.source ?? "system";
                const reversed = entries.some((candidate: any) => candidate.reversalOfEntryId === entry.id);
                return (
                  <Fragment key={entry.id}>
                    <TR
                      interactive
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                    >
                      <TD>
                        {isOpen ? (
                          <ChevronDown size={14} className="text-[var(--color-muted-foreground)]" />
                        ) : (
                          <ChevronRight size={14} className="text-[var(--color-muted-foreground)]" />
                        )}
                      </TD>
                      <TD muted className="numeric">{date(entry.accountingDate)}</TD>
                      <TD>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/reports/journal/${entry.id}`);
                          }}
                          className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          {entryNumber}
                        </button>
                      </TD>
                      <TD>
                        <div className="font-medium">{entry.memo}</div>
                      </TD>
                      <TD numeric className="font-semibold">{rub(Math.max(entryDebit, entryCredit))}</TD>
                      <TD>{reversed ? <Badge tone="neutral">reversed</Badge> : <Badge tone="success">posted</Badge>}</TD>
                      <TD muted><span className="text-xs">{sourceLabel(source)}</span></TD>
                    </TR>
                    {isOpen && (
                      <TR key={`${entry.id}-detail`}>
                        <TD colSpan={7} className="bg-[var(--color-muted)]/40 p-0">
                          <div className="px-12 py-3">
                            <table className="w-full text-sm">
                              <tbody>
                                {entryLines.map((line: any) => {
                                  const account = accounts.find((a: any) => a.code === line.accountCode);
                                  return (
                                    <tr key={line.id} className="border-b border-[var(--color-border)]/50 last:border-0">
                                      <td className="py-1.5 pr-4">
                                        <button
                                          type="button"
                                          onClick={() => navigate(`/reports/ledger?account=${line.accountCode}`)}
                                          className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline"
                                        >
                                          {line.accountCode}
                                        </button>
                                        <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
                                          {account?.name}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-4 text-xs text-[var(--color-muted-foreground)]">{line.memo}</td>
                                      <td
                                        className={cn(
                                          "py-1.5 text-right numeric font-semibold w-32",
                                          line.debit > 0 ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]/40"
                                        )}
                                      >
                                        {line.debit > 0 ? rub(line.debit) : "—"}
                                      </td>
                                      <td
                                        className={cn(
                                          "py-1.5 text-right numeric font-semibold w-32",
                                          line.credit > 0 ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]/40"
                                        )}
                                      >
                                        {line.credit > 0 ? rub(line.credit) : "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="bg-[var(--color-card)]">
                                  <td colSpan={2} className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                                    Итого
                                  </td>
                                  <td className="py-2 text-right numeric font-bold">{rub(entryDebit)}</td>
                                  <td className="py-2 text-right numeric font-bold">{rub(entryCredit)}</td>
                                </tr>
                                <tr>
                                  <td colSpan={4} className="pt-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-[var(--color-muted-foreground)]">
                                        Документ: {doc ? doc.number : "без документа"}
                                      </span>
                                      <Button size="sm" variant="ghost" onClick={() => navigate(`/reports/journal/${entry.id}`)}>
                                        Открыть запись
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
          {filtered.length > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
                setExpanded(null);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function JournalEntryPage() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const workspaceQuery = useJournalWorkspace();
  const entries = workspaceQuery.data?.entries ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const journalLines = workspaceQuery.data?.lines ?? [];
  const entry = entries.find((candidate: any) => candidate.id === entryId);
  const doc = documents.find((candidate: any) => candidate.id === entry?.documentId);
  const lines = journalLines.filter((line: any) => line.journalEntryId === entryId);

  if (workspaceQuery.isLoading) {
    return (
      <div>
        <PageHeader title="Загружаем запись журнала" breadcrumbs={[{ label: "Журнал", to: "/reports/journal" }]} />
      </div>
    );
  }

  if (!entry) {
    return (
      <div>
        <PageHeader title="Запись журнала не найдена" breadcrumbs={[{ label: "Журнал", to: "/reports/journal" }]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Запись журнала ${journalEntryNumber(entries, entry.id)}`}
        subtitle={entry.memo}
        breadcrumbs={[{ label: "Журнал", to: "/reports/journal" }, { label: journalEntryNumber(entries, entry.id) }]}
        actions={
          doc ? (
            <Button variant="ghost" onClick={() => navigate(`/documents/${doc.id}`)}>
              Открыть документ
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Metric label="Дата" value={date(entry.accountingDate)} />
            <Metric label="Статус" value={entries.some((candidate: any) => candidate.reversalOfEntryId === entry.id) ? "reversed" : "posted"} />
            <Metric label="Источник" value={sourceLabel(doc?.source ?? "system")} />
            <Metric label="Документ" value={doc ? doc.number : "—"} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Счет</TH>
                <TH>Описание</TH>
                <TH numeric>Дебет</TH>
                <TH numeric>Кредит</TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((line: any) => (
                <TR key={line.id}>
                  <TD>
                    <Link to={`/reports/ledger?account=${line.accountCode}`} className="font-mono text-[var(--color-primary)] hover:underline">
                      {line.accountCode}
                    </Link>
                  </TD>
                  <TD>{line.memo}</TD>
                  <TD numeric>{line.debit > 0 ? rub(line.debit) : "—"}</TD>
                  <TD numeric>{line.credit > 0 ? rub(line.credit) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function useJournalWorkspace() {
  return useQuery({
    queryKey: ["accounting-journal-workspace"],
    queryFn: () => apiGet<{ entries: any[]; lines: any[]; periods: any[]; accounts: any[]; documents: any[] }>("/api/accounting/journal/workspace")
  });
}

function sourceLabel(source: string) {
  if (source === "manual") return "Вручную";
  if (source === "plugin") return "Плагин";
  if (source === "backfill") return "Backfill";
  return "Система";
}

function journalEntryNumber(entries: any[], entryId: string) {
  const index = entries.findIndex((entry) => entry.id === entryId);
  return `JE-${String(index + 1).padStart(5, "0")}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] font-semibold">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
