import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCcw, Save, Plus, Banknote, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { apiGet, apiPost } from "@/api";
import { rub, date } from "@/lib/format";
import { paginateRows } from "@/lib/pagination";
import { FinanceWorkspace } from "@/pages/finance/FinanceWorkspace";

const today = () => new Date().toISOString().slice(0, 10);
const OWNER_FORM_QUERY_KEY = ["money-owner-form-workspace"] as const;
const PAYOUT_FORM_QUERY_KEY = ["payout-form-workspace"] as const;
const PAYOUTS_WORKSPACE_QUERY_KEY = ["payouts-workspace"] as const;

interface OwnerMoneyFormWorkspacePayload {
  accountingPolicy?: any;
}

interface PayoutFormWorkspacePayload {
  salesChannels: any[];
}

interface PayoutsWorkspacePayload {
  payouts: any[];
  salesChannels: any[];
  payoutLines: any[];
}

interface PayoutReconciliationWorkspacePayload {
  payout: any;
  payoutLines: any[];
  channel?: any;
  sales: any[];
  salesReturns: any[];
  channelFinanceEvents: any[];
  payment?: any;
  paymentDocument?: any;
}

const LEGACY_MONEY_COLLECTION_KEYS = [
  "accountingPolicy",
  "cashAccounts",
  "channelFinanceEvents",
  "documents",
  "ownerTransactions",
  "payments",
  "payoutLines",
  "payouts",
  "sales",
  "salesChannels",
  "salesReturns"
] as const;

function invalidateMoneyArea(queryClient: QueryClient, payoutId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: OWNER_FORM_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PAYOUT_FORM_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PAYOUTS_WORKSPACE_QUERY_KEY });
  if (payoutId) void queryClient.invalidateQueries({ queryKey: ["payout-reconciliation", payoutId] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
  for (const key of LEGACY_MONEY_COLLECTION_KEYS) {
    void queryClient.invalidateQueries({ queryKey: ["collection", key] });
  }
}

export function MoneyWorkspace() {
  return <FinanceWorkspace />;
}

export function OwnerContributionFormPage() {
  const ownerFormQuery = useQuery({
    queryKey: OWNER_FORM_QUERY_KEY,
    queryFn: () => apiGet<OwnerMoneyFormWorkspacePayload>("/api/money/owner-form-workspace")
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [paidAt, setPaidAt] = useState(today());
  const [amountRub, setAmountRub] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (defaultsApplied || !ownerFormQuery.data) return;
    setPaidAt(ownerFormQuery.data.accountingPolicy?.accountingStartDate ?? today());
    setDefaultsApplied(true);
  }, [defaultsApplied, ownerFormQuery.data]);

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => apiPost("/api/money/owner-contributions", { paidAt, amountRub: Number(amountRub), comment, post }),
    onSuccess: () => {
      invalidateMoneyArea(queryClient);
      navigate("/money?view=incoming");
    }
  });
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Пополнение владельцем" }]}
        title="Пополнение владельцем"
        subtitle="Дт 51 / Кт 80.01"
        actions={<Button variant="ghost" asChild><Link to="/money"><ArrowLeft size={14} /> Назад</Link></Button>}
      />
      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
          <Field label="Дата" required><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          <Field label="Сумма, ₽" required><Input type="number" value={amountRub} onChange={(e) => setAmountRub(e.target.value)} placeholder="0" /></Field>
          <div className="md:col-span-2">
            <Field label="Комментарий"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: стартовый капитал" /></Field>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button size="lg" variant="secondary" onClick={() => create.mutate({ post: false })} disabled={create.isPending || !(Number(amountRub) > 0)}><Save size={14} /> Сохранить черновик</Button>
        <Button size="lg" onClick={() => create.mutate({ post: true })} disabled={create.isPending || !(Number(amountRub) > 0)}><Save size={14} /> Провести пополнение</Button>
      </div>
    </div>
  );
}

export function OwnerWithdrawalFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ownerFormQuery = useQuery({
    queryKey: OWNER_FORM_QUERY_KEY,
    queryFn: () => apiGet<OwnerMoneyFormWorkspacePayload>("/api/money/owner-form-workspace")
  });
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [paidAt, setPaidAt] = useState(today());
  const [amountRub, setAmountRub] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (defaultsApplied || !ownerFormQuery.data) return;
    setPaidAt(ownerFormQuery.data.accountingPolicy?.accountingStartDate ?? today());
    setDefaultsApplied(true);
  }, [defaultsApplied, ownerFormQuery.data]);

  const create = useMutation({
    mutationFn: () => apiPost("/api/money/owner-withdrawals", { paidAt, amountRub: Number(amountRub), comment }),
    onSuccess: () => {
      invalidateMoneyArea(queryClient);
      navigate("/money?view=outgoing");
    }
  });

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Вывод владельцу" }]}
        title="Вывод владельцу"
        subtitle="Изъятие средств владельцем из бизнеса."
        actions={<Button variant="ghost" asChild><Link to="/money"><ArrowLeft size={14} /> Назад</Link></Button>}
      />
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2">
          <Field label="Дата" required><Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></Field>
          <Field label="Сумма, ₽" required><Input type="number" value={amountRub} onChange={(event) => setAmountRub(event.target.value)} placeholder="0" /></Field>
          <div className="md:col-span-2">
            <Field label="Комментарий"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: вывод средств владельцем" /></Field>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending || Number(amountRub) <= 0}>
          <Banknote size={14} /> Провести вывод
        </Button>
      </div>
    </div>
  );
}

export function PayoutFormPage() {
  const formQuery = useQuery({
    queryKey: PAYOUT_FORM_QUERY_KEY,
    queryFn: () => apiGet<PayoutFormWorkspacePayload>("/api/finance/payouts/form-workspace")
  });
  const channels = formQuery.data?.salesChannels ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [payoutDate, setPayoutDate] = useState(today());
  const [periodFrom, setPeriodFrom] = useState(today());
  const [periodTo, setPeriodTo] = useState(today());
  const [expectedAmountRub, setExpectedAmountRub] = useState("0");
  const [bankReceiptRub, setBankReceiptRub] = useState("0");
  const [externalPayoutId, setExternalPayoutId] = useState("");

  useEffect(() => {
    if (defaultsApplied || !formQuery.data) return;
    setChannelId(channels[0]?.id ?? "");
    setDefaultsApplied(true);
  }, [channels, defaultsApplied, formQuery.data]);

  const create = useMutation({
    mutationFn: () => apiPost<any>("/api/finance/payouts", {
      channelId,
      payoutDate,
      periodFrom,
      periodTo,
      expectedAmountRub: Number(expectedAmountRub),
      bankReceiptRub: Number(bankReceiptRub),
      externalPayoutId: externalPayoutId.trim() || undefined,
      compositionMode: "manual"
    }),
    onSuccess: (data: any) => {
      invalidateMoneyArea(queryClient, data.id);
      navigate(`/finance/payouts/${data.id}/reconciliation`);
    }
  });

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Поступление от маркетплейса" }]}
        title="Поступление от маркетплейса"
        subtitle="Ручной документ выплаты с последующей сверкой состава и факта поступления на счет."
        actions={<Button variant="ghost" asChild><Link to="/money"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <Card>
        <CardHeader><CardTitle>Параметры выплаты</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Канал" required>
            <Select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </Select>
          </Field>
          <Field label="Дата выплаты" required><Input type="date" value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} /></Field>
          <Field label="Номер документа канала">
            <Input value={externalPayoutId} onChange={(event) => setExternalPayoutId(event.target.value)} placeholder="Например, №444330 от 07.04.2026" />
          </Field>
          <Field label="Период с"><Input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} /></Field>
          <Field label="Период по"><Input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} /></Field>
          <Field label="Сумма по документу канала" required><Input type="number" value={expectedAmountRub} onChange={(event) => setExpectedAmountRub(event.target.value)} /></Field>
          <Field label="Фактически пришло на счет" required><Input type="number" value={bankReceiptRub} onChange={(event) => setBankReceiptRub(event.target.value)} /></Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending || !channelId}>
          <Save size={14} /> Создать выплату
        </Button>
      </div>
    </div>
  );
}

export function PayoutsPage() {
  const workspaceQuery = useQuery({
    queryKey: PAYOUTS_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<PayoutsWorkspacePayload>("/api/finance/payouts/workspace")
  });
  const payouts = workspaceQuery.data?.payouts ?? [];
  const channels = workspaceQuery.data?.salesChannels ?? [];
  const payoutLines = workspaceQuery.data?.payoutLines ?? [];
  const queryClient = useQueryClient();

  const [filterChannelId, setFilterChannelId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const postReady = useMutation({
    mutationFn: async () => {
      const readyIds = payouts.filter((payout: any) => payout.status === "ready").map((payout: any) => payout.id);
      for (const payoutId of readyIds) {
        await apiPost(`/api/finance/payouts/${payoutId}/post`);
      }
      return readyIds.length;
    },
    onSuccess: () => invalidateMoneyArea(queryClient)
  });

  const rows = useMemo(() => {
    return payouts
      .slice()
      .sort((left: any, right: any) => String(right.payoutDate).localeCompare(String(left.payoutDate)))
      .map((payout: any) => ({
        payout,
        channel: channels.find((channel: any) => channel.id === payout.channelId),
        operationsCount: payoutLines.filter((line: any) => line.payoutId === payout.id).length
      }))
      .filter((row) => {
        if (filterChannelId && row.payout.channelId !== filterChannelId) return false;
        if (status && row.payout.status !== status) return false;
        return true;
      });
  }, [payouts, channels, payoutLines, filterChannelId, status]);

  useEffect(() => {
    setPage(1);
  }, [filterChannelId, status]);

  const pagedRows = useMemo(() => paginateRows<any>(rows, page, pageSize), [rows, page, pageSize]);

  const expectedTotal = rows.reduce((sum, row) => sum + Number(row.payout.expectedAmountRub ?? row.payout.grossEventsRub ?? 0), 0);
  const receivedTotal = rows.reduce((sum, row) => sum + Number(row.payout.bankReceiptRub ?? 0), 0);
  const differenceTotal = rows.reduce((sum, row) => sum + Number(row.payout.differenceRub ?? 0), 0);
  const unreconciled = rows.filter((row) => Number(row.payout.differenceRub ?? 0) !== 0 || row.payout.status === "needs_reconciliation").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Выплаты маркетплейсов"
        subtitle="Здесь заносите документы маркетплейсов вручную, сверяете поступление на счёт и проводите закрытие 76.ТП."
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Выплаты маркетплейсов" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to="/finance/payouts/new"><Plus size={14} /> Новая выплата</Link></Button>
            <Button variant="secondary" onClick={() => postReady.mutate()} disabled={postReady.isPending || !payouts.some((payout: any) => payout.status === "ready")}>Провести выбранные</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" label="Ожидается" value={rub(expectedTotal)} />
        <Kpi tone="success" label="Поступило" value={rub(receivedTotal)} />
        <Kpi tone="warning" label="Разница" value={rub(differenceTotal)} />
        <Kpi tone="danger" label="Требуют сверки" value={unreconciled} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4 border-b border-[var(--color-border)]">
          <Select value={filterChannelId} onChange={(event) => setFilterChannelId(event.target.value)} className="w-48">
            <option value="">Все каналы</option>
            {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-48">
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="ready">Готово</option>
            <option value="posted">Проведено</option>
            <option value="needs_reconciliation">Нужна сверка</option>
          </Select>
        </CardContent>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={<Wallet size={20} />} title="Выплат по фильтрам нет" description="Создайте выплату вручную по документу маркетплейса." />
          ) : (
            <Table>
              <THead><TR><TH>Дата</TH><TH>Канал</TH><TH>Источник</TH><TH numeric>Ожидается</TH><TH numeric>Поступило</TH><TH numeric>Разница</TH><TH>Статус</TH><TH numeric>Операций</TH></TR></THead>
              <TBody>
                {pagedRows.map((row) => (
                  <TR key={row.payout.id} interactive>
                    <TD muted className="numeric text-xs"><Link to={`/finance/payouts/${row.payout.id}/reconciliation`} className="text-[var(--color-primary)] hover:underline">{date(row.payout.payoutDate)}</Link></TD>
                    <TD>{row.channel?.name ?? "—"}</TD>
                    <TD muted className="text-xs">{row.payout.externalPayoutId ?? (row.payout.compositionMode === "manual" ? "Ручной ввод" : "Из канала")}</TD>
                    <TD numeric>{rub(row.payout.expectedAmountRub ?? row.payout.grossEventsRub)}</TD>
                    <TD numeric className="font-semibold">{rub(row.payout.bankReceiptRub)}</TD>
                    <TD numeric className={Number(row.payout.differenceRub ?? 0) === 0 ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-warning)] font-semibold"}>{rub(row.payout.differenceRub)}</TD>
                    <TD><Badge tone={payoutTone(row.payout.status)}>{payoutLabel(row.payout.status)}</Badge></TD>
                    <TD numeric>{row.operationsCount}</TD>
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
    </div>
  );
}

export function PayoutReconciliationPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: ["payout-reconciliation", id],
    queryFn: () => apiGet<PayoutReconciliationWorkspacePayload>(`/api/finance/payouts/${encodeURIComponent(id ?? "")}/workspace`),
    enabled: Boolean(id)
  });
  const payout = workspaceQuery.data?.payout;
  const payoutLines = workspaceQuery.data?.payoutLines ?? [];
  const channel = workspaceQuery.data?.channel;
  const sales = workspaceQuery.data?.sales ?? [];
  const returns = workspaceQuery.data?.salesReturns ?? [];
  const financeEvents = workspaceQuery.data?.channelFinanceEvents ?? [];
  const paymentDocument = workspaceQuery.data?.paymentDocument;
  const [currentPayoutId, setCurrentPayoutId] = useState("");
  const [bankReceiptRub, setBankReceiptRub] = useState("0");
  const [differenceReason, setDifferenceReason] = useState("");

  useEffect(() => {
    if (!payout || currentPayoutId === payout.id) return;
    setBankReceiptRub(String(payout.bankReceiptRub ?? 0));
    setDifferenceReason(payout.differenceReason ?? "");
    setCurrentPayoutId(payout.id);
  }, [currentPayoutId, payout]);

  const recalc = useMutation({
    mutationFn: () => apiPost(`/api/finance/payouts/${id}/recalculate`),
    onSuccess: () => invalidateMoneyArea(queryClient, id)
  });
  const linkBank = useMutation({
    mutationFn: () => apiPost(`/api/finance/payouts/${id}/link-bank-payment`, { bankReceiptRub: Number(bankReceiptRub) }),
    onSuccess: () => invalidateMoneyArea(queryClient, id)
  });
  const leaveDifference = useMutation({
    mutationFn: () => apiPost(`/api/finance/payouts/${id}/leave-difference`, { reason: differenceReason }),
    onSuccess: () => invalidateMoneyArea(queryClient, id)
  });
  const postPayout = useMutation({
    mutationFn: () => apiPost(`/api/finance/payouts/${id}/post`),
    onSuccess: () => invalidateMoneyArea(queryClient, id)
  });

  const grouped = useMemo(() => {
    const groups: Record<string, Array<{ label: string; amountRub: number; href?: string }>> = {
      sales: [],
      returns: [],
      commissions: [],
      logistics: [],
      compensations: [],
      penalties: [],
      manual: []
    };
    payoutLines.forEach((line: any) => {
      if (line.sourceType === "sale") {
        const sale = sales.find((candidate: any) => candidate.id === line.sourceId);
        groups.sales.push({ label: sale?.externalOrderId ?? sale?.id ?? "Продажа", amountRub: line.amountRub, href: sale ? `/sales/${sale.id}` : undefined });
      } else if (line.sourceType === "return") {
        const salesReturn = returns.find((candidate: any) => candidate.id === line.sourceId);
        groups.returns.push({ label: salesReturn?.id ?? "Возврат", amountRub: line.amountRub, href: salesReturn ? `/returns/${salesReturn.id}` : undefined });
      } else if (line.sourceType === "finance_event") {
        const financeEvent = financeEvents.find((candidate: any) => candidate.id === line.sourceId);
        const key = financeEvent?.eventKind === "commission"
          ? "commissions"
          : financeEvent?.eventKind === "logistics"
            ? "logistics"
            : financeEvent?.eventKind === "compensation"
              ? "compensations"
              : "penalties";
        groups[key].push({ label: financeEvent?.externalId ?? financeEvent?.id ?? "Финансовая операция", amountRub: line.amountRub, href: financeEvent ? `/integrations/finance-events/${financeEvent.id}` : undefined });
      } else {
        groups.manual.push({ label: "Ручная корректировка", amountRub: line.amountRub });
      }
    });
    return groups;
  }, [payoutLines, sales, returns, financeEvents]);

  if (!payout && workspaceQuery.isLoading) {
    return <PageHeader title="Сверка выплаты" breadcrumbs={[{ label: "Выплаты маркетплейсов", to: "/finance/payouts" }]} subtitle="Загружаем выплату" />;
  }

  if (!payout) {
    return <PageHeader title="Сверка выплаты" breadcrumbs={[{ label: "Выплаты маркетплейсов", to: "/finance/payouts" }]} subtitle="Выплата не найдена" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Сверка выплаты · ${channel?.name ?? "Канал"}`}
        subtitle={`${date(payout.payoutDate)} · ${payout.externalPayoutId ?? payout.id}`}
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Выплаты маркетплейсов", to: "/finance/payouts" }, { label: payout.id }]}
        badge={<Badge tone={payoutTone(payout.status)}>{payoutLabel(payout.status)}</Badge>}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending}><RefreshCcw size={14} /> Пересчитать состав</Button>
            <Button onClick={() => postPayout.mutate()} disabled={postPayout.isPending || (payout.differenceRub !== 0 && !payout.differenceAccepted)}>Провести выплату</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <Card>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
            <Info label="Ожидаемая сумма" value={rub(payout.expectedAmountRub ?? payout.grossEventsRub)} />
            <Info label="Поступило на счет" value={rub(payout.bankReceiptRub)} />
            <Info label="Разница" value={rub(payout.differenceRub)} />
            <Info label="Период отчета" value={payout.periodFrom && payout.periodTo ? `${date(payout.periodFrom)} - ${date(payout.periodTo)}` : "—"} />
            <Info label="Режим состава" value={payout.compositionMode === "manual" ? "Ручной" : "Автоматический"} />
            <Info label="Банковский документ" value={paymentDocument ? paymentDocument.number : "—"} />
            <Info label="Канал" value={channel?.name ?? "—"} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Банковское поступление</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Сумма фактического поступления">
              <Input type="number" value={bankReceiptRub} onChange={(event) => setBankReceiptRub(event.target.value)} />
            </Field>
            <Button variant="secondary" onClick={() => linkBank.mutate()} disabled={linkBank.isPending}>Привязать банковское поступление</Button>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              Поступление хранится как денежный документ `channel_payout`, а проводка по расчету с каналом живет на документе выплаты.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Состав выплаты</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ["sales", "Продажи"],
            ["returns", "Возвраты"],
            ["commissions", "Комиссии"],
            ["logistics", "Логистика"],
            ["compensations", "Компенсации"],
            ["penalties", "Штрафы"]
          ].map(([key, label]) => (
            <div key={key} className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
              <div className="divide-y divide-[var(--color-border)]">
                {(grouped[key] ?? []).length === 0 ? (
                  <div className="px-3 py-3 text-sm text-[var(--color-muted-foreground)]">Нет строк</div>
                ) : (
                  grouped[key].map((row, index) => (
                    <div key={`${key}-${index}`} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                      <div>{row.href ? <Link to={row.href} className="text-[var(--color-primary)] hover:underline">{row.label}</Link> : row.label}</div>
                      <div className={row.amountRub >= 0 ? "font-semibold" : "font-semibold text-[var(--color-warning)]"}>{rub(row.amountRub)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Расхождение</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <Field label="Причина расхождения" hint="Нужна, если отчет канала и факт банка не сходятся">
            <Textarea value={differenceReason} onChange={(event) => setDifferenceReason(event.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => leaveDifference.mutate()} disabled={leaveDifference.isPending || differenceReason.trim().length < 3}>Оставить расхождение</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function payoutTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "posted") return "success";
  if (status === "ready") return "info";
  if (status === "needs_reconciliation") return "warning";
  if (status === "reversed") return "danger";
  return "neutral";
}

function payoutLabel(status: string) {
  if (status === "draft") return "Черновик";
  if (status === "ready") return "Готово";
  if (status === "posted") return "Проведено";
  if (status === "needs_reconciliation") return "Нужна сверка";
  if (status === "reconciled") return "Сверено";
  if (status === "reversed") return "Сторно";
  return status;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-medium mt-1 break-words">{value}</div>
    </div>
  );
}
