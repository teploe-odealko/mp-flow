import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Kpi } from "@/components/ui/kpi";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useAppState } from "@/lib/use-app-state";
import { apiGet } from "@/api";
import { date, rub } from "@/lib/format";
import { accountKindLabel } from "@/lib/i18n";

export function LedgerPage() {
  const { workingPeriodId } = useAppState();
  const workspaceQuery = useQuery({
    queryKey: ["accounting-journal-workspace"],
    queryFn: () => apiGet<{ entries: any[]; lines: any[]; periods: any[]; accounts: any[] }>("/api/accounting/journal/workspace")
  });
  const accounts = workspaceQuery.data?.accounts ?? [];
  const periods = workspaceQuery.data?.periods ?? [];
  const entries = workspaceQuery.data?.entries ?? [];
  const lines = workspaceQuery.data?.lines ?? [];

  const [searchParams, setSearchParams] = useSearchParams();
  const initialAccount = searchParams.get("account") ?? "";

  const [accountCode, setAccountCode] = useState<string>(initialAccount);
  const [periodId, setPeriodId] = useState<string>(workingPeriodId || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyWithMovements, setOnlyWithMovements] = useState(false);

  useEffect(() => {
    if (initialAccount && initialAccount !== accountCode) {
      setAccountCode(initialAccount);
    }
  }, [initialAccount]);

  useEffect(() => {
    if (!periodId) {
      const nextPeriodId = workingPeriodId || periods.find((p: any) => p.status === "open")?.id || "";
      if (nextPeriodId) applyPeriod(nextPeriodId);
    }
  }, [periodId, workingPeriodId, periods]);

  function applyAccount(code: string) {
    setAccountCode(code);
    if (code) searchParams.set("account", code);
    else searchParams.delete("account");
    setSearchParams(searchParams, { replace: true });
  }

  function applyPeriod(id: string) {
    setPeriodId(id);
    if (id) {
      const p = periods.find((p: any) => p.id === id);
      if (p) {
        setFrom(p.startsOn);
        setTo(p.endsOn);
      }
    } else {
      setFrom("");
      setTo("");
    }
  }

  const account = accounts.find((a: any) => a.code === accountCode);
  const visibleAccounts = useMemo(
    () => (onlyWithMovements ? accounts.filter((account: any) => lines.some((line: any) => line.accountCode === account.code)) : accounts),
    [accounts, lines, onlyWithMovements]
  );

  const movements = useMemo(() => {
    if (!accountCode) return [];
    const accountLines = lines.filter((l: any) => l.accountCode === accountCode);
    return accountLines
      .map((line: any) => {
        const entry = entries.find((e: any) => e.id === line.journalEntryId);
        return entry ? { line, entry } : null;
      })
      .filter((x): x is { line: any; entry: any } => x !== null)
      .filter(({ entry }) => {
        if (from && entry.accountingDate < from) return false;
        if (to && entry.accountingDate > to) return false;
        return true;
      })
      .sort((a, b) => a.entry.accountingDate.localeCompare(b.entry.accountingDate));
  }, [lines, entries, accountCode, from, to]);

  const totalDebit = movements.reduce((s, m) => s + m.line.debit, 0);
  const totalCredit = movements.reduce((s, m) => s + m.line.credit, 0);
  const balance = account?.normalSide === "credit" ? totalCredit - totalDebit : totalDebit - totalCredit;
  const openingBalance = useMemo(() => {
    if (!accountCode || !from) return 0;
    const previous = lines
      .filter((line: any) => line.accountCode === accountCode)
      .map((line: any) => {
        const entry = entries.find((candidate: any) => candidate.id === line.journalEntryId);
        return entry ? { line, entry } : null;
      })
      .filter((item): item is { line: any; entry: any } => item !== null)
      .filter(({ entry }) => entry.accountingDate < from);
    const debit = previous.reduce((sum, item) => sum + item.line.debit, 0);
    const credit = previous.reduce((sum, item) => sum + item.line.credit, 0);
    return roundBalance(account?.normalSide === "credit" ? credit - debit : debit - credit);
  }, [account?.normalSide, accountCode, entries, from, lines]);

  let runningBalance = openingBalance;
  const movementsWithRunning = movements.map((m) => {
    const delta = account?.normalSide === "credit" ? m.line.credit - m.line.debit : m.line.debit - m.line.credit;
    runningBalance += delta;
    return { ...m, running: runningBalance };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Главная книга"
        subtitle="Обороты и остаток по выбранному счёту"
        breadcrumbs={[{ label: "Учёт", to: "/accounting" }, { label: "Главная книга" }]}
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="flex flex-col gap-1.5 min-w-[260px]">
            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">Счёт</span>
            <Select value={accountCode} onChange={(e) => applyAccount(e.target.value)}>
              <option value="">Выберите счёт…</option>
              {visibleAccounts.map((a: any) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 min-w-[180px]">
            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">Период</span>
            <Select value={periodId} onChange={(e) => applyPeriod(e.target.value)}>
              <option value="">Все периоды</option>
              {periods.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">С даты</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-card)] px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">По дату</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-card)] px-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
            <input type="checkbox" checked={onlyWithMovements} onChange={(e) => setOnlyWithMovements(e.target.checked)} />
            Только счета с оборотами
          </label>
          <Button variant="ghost" onClick={() => { setAccountCode(""); setPeriodId(""); setFrom(""); setTo(""); applyAccount(""); }}>Сбросить</Button>
        </CardContent>
      </Card>

      {!accountCode ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BookOpen size={20} />}
              title="Выберите счёт"
              description="Главная книга показывает обороты и остаток по конкретному счёту. Начните с 41.01 или 51, чтобы увидеть динамику."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi tone="neutral" label="Начальный остаток" value={rub(openingBalance)} />
            <Kpi tone="info" icon={<ArrowDownLeft size={18} />} label="Оборот Дебет" value={rub(totalDebit)} />
            <Kpi tone="info" icon={<ArrowUpRight size={18} />} label="Оборот Кредит" value={rub(totalCredit)} />
            <Kpi tone={balance >= 0 ? "success" : "danger"} label="Конечный остаток" value={rub(balance)} hint={`по ${account?.normalSide === "credit" ? "кредиту" : "дебету"}`} />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="font-mono text-base">{account?.code}</span>
                  <span>{account?.name}</span>
                  <Badge tone="primary">{accountKindLabel[account?.kind ?? ""] ?? ""}</Badge>
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-28">Дата</TH>
                    <TH>Операция</TH>
                    <TH numeric className="w-32">Дебет</TH>
                    <TH numeric className="w-32">Кредит</TH>
                    <TH numeric className="w-32">Остаток</TH>
                  </TR>
                </THead>
                <TBody>
                  {movementsWithRunning.length === 0 && (
                    <TR>
                      <TD colSpan={5} className="text-center py-8 text-[var(--color-muted-foreground)]">Движений по фильтру нет</TD>
                    </TR>
                  )}
                  {movementsWithRunning.map(({ line, entry, running }) => (
                    <TR key={line.id}>
                      <TD muted className="numeric">{date(entry.accountingDate)}</TD>
                      <TD>
                        <Link to={`/reports/journal/${entry.id}`} className="hover:text-[var(--color-primary)]">
                          {entry.memo}
                        </Link>
                      </TD>
                      <TD numeric className={line.debit > 0 ? "font-semibold" : "text-[var(--color-muted-foreground)]/40"}>
                        {line.debit > 0 ? rub(line.debit) : "—"}
                      </TD>
                      <TD numeric className={line.credit > 0 ? "font-semibold" : "text-[var(--color-muted-foreground)]/40"}>
                        {line.credit > 0 ? rub(line.credit) : "—"}
                      </TD>
                      <TD numeric className="font-semibold text-[var(--color-primary)]">{rub(running)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function roundBalance(value: number) {
  return Math.round(value * 100) / 100;
}
