import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Wallet } from "lucide-react";
import { apiPost } from "@/api";
import { FinanceOperationLauncher } from "@/components/finance-operation-launcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rub, date } from "@/lib/format";
import {
  buildFinanceOperations,
  matchesFinanceStatus,
  matchesFinanceType,
  matchesFinanceView,
  sumOperationAmounts,
  type FinanceOperationStatusFilter,
  type FinanceOperationTypeFilter,
  type FinanceOperationView
} from "@/lib/finance-operations";
import { paginateRows } from "@/lib/pagination";
import { useAppState } from "@/lib/use-app-state";

const today = () => new Date().toISOString().slice(0, 10);

const VIEW_OPTIONS: Array<{ value: FinanceOperationView; label: string }> = [
  { value: "all", label: "Все" },
  { value: "outgoing", label: "Списания" },
  { value: "incoming", label: "Поступления" },
  { value: "attention", label: "Требуют внимания" }
];

const TYPE_OPTIONS: Array<{ value: FinanceOperationTypeFilter; label: string }> = [
  { value: "all", label: "Все виды" },
  { value: "expense_like", label: "Расходы" },
  { value: "operating_expense", label: "Расходы компании" },
  { value: "procurement_cost", label: "Расходы поставки" },
  { value: "supplier_payment", label: "Оплаты поставщикам" },
  { value: "payout", label: "Маркетплейсы" },
  { value: "owner", label: "Операции владельца" }
];

const STATUS_OPTIONS: Array<{ value: FinanceOperationStatusFilter; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновики" },
  { value: "ready", label: "Готово провести" },
  { value: "needs_payment", label: "К оплате" },
  { value: "needs_reconciliation", label: "Нужна сверка" },
  { value: "completed", label: "Оплачено / получено" }
];

export function FinanceWorkspace() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const documents = state.documents ?? [];
  const cashAccounts = state.cashAccounts ?? [];
  const payments = state.payments ?? [];
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRangeTouched, setDateRangeTouched] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const view = parseView(searchParams.get("view"));
  const typeFilter = parseType(searchParams.get("type"));
  const statusFilter = parseStatus(searchParams.get("status"));

  const operations = useMemo(() => buildFinanceOperations(state), [state]);
  const suggestedRange = useMemo(() => suggestFinanceDateRange(state, operations), [state, operations]);

  useEffect(() => {
    if (dateRangeTouched) return;
    setDateFrom(suggestedRange.from);
    setDateTo(suggestedRange.to);
  }, [dateRangeTouched, suggestedRange.from, suggestedRange.to]);

  const filteredOperations = useMemo(() => {
    return operations
      .filter((item) => matchesFinanceView(item, view))
      .filter((item) => matchesFinanceType(item, typeFilter))
      .filter((item) => matchesFinanceStatus(item, statusFilter))
      .filter((item) => {
        if (dateFrom && item.date < dateFrom) return false;
        if (dateTo && item.date > dateTo) return false;
        return true;
      });
  }, [operations, view, typeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    setPage(1);
  }, [view, typeFilter, statusFilter, dateFrom, dateTo]);

  const pagedRows = useMemo(() => paginateRows(filteredOperations, page, pageSize), [filteredOperations, page, pageSize]);

  const postedDocumentIds = useMemo(
    () => new Set(documents.filter((document: any) => document.status === "posted").map((document: any) => document.id)),
    [documents]
  );
  const totalBalance = cashAccounts.reduce((sum: number, account: any) => sum + Number(account.balanceRub ?? 0), 0);
  const incoming = payments
    .filter((payment: any) => payment.paymentDirection === "incoming" && postedDocumentIds.has(payment.documentId))
    .reduce((sum: number, payment: any) => sum + Number(payment.amountRub ?? 0), 0);
  const outgoing = payments
    .filter((payment: any) => payment.paymentDirection === "outgoing" && postedDocumentIds.has(payment.documentId))
    .reduce((sum: number, payment: any) => sum + Number(payment.amountRub ?? 0), 0);
  const toPay = operations
    .filter((item) => item.statusKey === "needs_payment")
    .reduce((sum, item) => sum + Number(item.amountRub ?? 0), 0);
  const needsAttention = operations.filter((item) => item.needsAttention).length;
  const filteredTotal = sumOperationAmounts(filteredOperations);

  const postAction = useMutation({
    mutationFn: (payload: { endpoint: string }) => apiPost(payload.endpoint),
    onSuccess: () => queryClient.invalidateQueries()
  });

  const marketplaceAttention = operations.filter((item) => item.kind === "payout" && item.needsAttention).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Деньги и расчеты"
        subtitle="Один экран для расходов, оплат поставщикам, выплат маркетплейсов и операций владельца."
        actions={<Button onClick={() => setLauncherOpen(true)}><Plus size={14} /> Новая операция</Button>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi tone="primary" icon={<Wallet size={18} />} label="На счетах" value={rub(totalBalance)} />
        <Kpi tone="success" label="Поступило" value={rub(incoming)} hint="Проведенные поступления" />
        <Kpi tone="warning" label="Списано" value={rub(outgoing)} hint="Проведенные списания" />
        <Kpi tone="danger" label="К оплате" value={rub(toPay)} hint={`${needsAttention} операций требуют действий`} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={view} onValueChange={(next) => updateSearchParams(searchParams, setSearchParams, { view: next })}>
            <TabsList>
              {VIEW_OPTIONS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="text-sm text-[var(--color-muted-foreground)]">
            {marketplaceAttention > 0
              ? `Выплаты маркетплейсов на сверке: ${marketplaceAttention}`
              : "Все выплаты маркетплейсов сейчас без активных расхождений"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-3 py-4">
          <Field label="Период" className="min-w-[280px]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateRangeTouched(true);
                  setDateFrom(event.target.value);
                }}
              />
              <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateRangeTouched(true);
                  setDateTo(event.target.value);
                }}
              />
            </div>
          </Field>
          <Field label="Тип операции" className="min-w-[240px]">
            <Select value={typeFilter} onChange={(event) => updateSearchParams(searchParams, setSearchParams, { type: event.target.value })}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Статус" className="min-w-[220px]">
            <Select value={statusFilter} onChange={(event) => updateSearchParams(searchParams, setSearchParams, { status: event.target.value })}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Реестр операций</CardTitle>
            <div className="text-sm text-[var(--color-muted-foreground)]">
              {filteredOperations.length > 0
                ? `${filteredOperations.length} операций · оборот ${rub(filteredTotal)}`
                : "По выбранным фильтрам операций нет"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredOperations.length === 0 ? (
            <EmptyState icon={<Wallet size={20} />} title="Операций по фильтрам нет" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Дата</TH>
                  <TH>Операция</TH>
                  <TH>Основание</TH>
                  <TH>Эффект</TH>
                  <TH>Статус</TH>
                  <TH numeric>Сумма</TH>
                  <TH>Документ</TH>
                  <TH>Действие</TH>
                </TR>
              </THead>
              <TBody>
                {pagedRows.map((operation) => (
                  <TR key={`${operation.kind}-${operation.id}`} interactive onClick={() => navigate(operation.primaryHref)}>
                    <TD muted className="numeric text-xs">{date(operation.date)}</TD>
                    <TD>
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={operation.typeTone} size="sm">{operation.typeLabel}</Badge>
                          <Link
                            to={operation.primaryHref}
                            className="font-medium text-[var(--color-primary)] hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {operation.title}
                          </Link>
                        </div>
                        {operation.subtitle && <span className="text-xs text-[var(--color-muted-foreground)]">{operation.subtitle}</span>}
                      </div>
                    </TD>
                    <TD>
                      <div className="text-sm">{operation.sourceLabel ?? "—"}</div>
                    </TD>
                    <TD muted className="text-xs">{operation.effectLabel}</TD>
                    <TD><Badge tone={operation.statusTone}>{operation.statusLabel}</Badge></TD>
                    <TD numeric className={operation.direction === "incoming" ? "font-semibold text-[var(--color-success)]" : "font-semibold"}>
                      {operation.direction === "incoming" ? "+" : "−"} {rub(operation.amountRub)}
                    </TD>
                    <TD>
                      {operation.documentHref && operation.documentNumber ? (
                        <Link
                          to={operation.documentHref}
                          className="text-[var(--color-primary)] hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {operation.documentNumber}
                        </Link>
                      ) : "—"}
                    </TD>
                    <TD>
                      {operation.postAction ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            postAction.mutate({ endpoint: operation.postAction!.endpoint });
                          }}
                          disabled={postAction.isPending}
                        >
                          {operation.postAction.label}
                        </Button>
                      ) : operation.kind === "payout" && operation.needsAttention ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Link to={operation.primaryHref}>Открыть</Link>
                        </Button>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {filteredOperations.length > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={filteredOperations.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Денежные счета</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {cashAccounts.map((account: any) => (
            <div key={account.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{account.name}</div>
              <div className="mt-2 text-lg font-semibold">{rub(Number(account.balanceRub ?? 0))}</div>
              <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">Счет {account.accountCode}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <FinanceOperationLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  );
}

function parseView(value: string | null): FinanceOperationView {
  if (value === "outgoing" || value === "incoming" || value === "attention") return value;
  return "all";
}

function parseType(value: string | null): FinanceOperationTypeFilter {
  if (
    value === "expense_like" ||
    value === "operating_expense" ||
    value === "procurement_cost" ||
    value === "supplier_payment" ||
    value === "payout" ||
    value === "owner"
  ) {
    return value;
  }
  return "all";
}

function parseStatus(value: string | null): FinanceOperationStatusFilter {
  if (
    value === "draft" ||
    value === "ready" ||
    value === "needs_payment" ||
    value === "completed" ||
    value === "needs_reconciliation"
  ) {
    return value;
  }
  return "all";
}

function updateSearchParams(
  current: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  patch: Record<string, string>
) {
  const next = new URLSearchParams(current);
  Object.entries(patch).forEach(([key, value]) => {
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
  });
  setSearchParams(next, { replace: true });
}

function suggestFinanceDateRange(state: any, operations: Array<{ date: string }>) {
  const candidateDates = [
    state.accountingPolicy?.accountingStartDate,
    today(),
    ...operations.map((item) => item.date).filter(Boolean)
  ].filter(Boolean) as string[];

  const from = candidateDates.reduce((min, value) => (value < min ? value : min), candidateDates[0] ?? today());
  const to = candidateDates.reduce((max, value) => (value > max ? value : max), candidateDates[0] ?? today());
  return { from, to };
}
