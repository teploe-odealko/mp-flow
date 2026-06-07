import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, CreditCard, Plus, ReceiptText, Save, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Kpi } from "@/components/ui/kpi";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/ui/pagination";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/api";
import { rub, date, dateTime } from "@/lib/format";
import { paginateRows } from "@/lib/pagination";

const today = () => new Date().toISOString().slice(0, 10);
const EXPENSES_WORKSPACE_QUERY_KEY = ["expenses-workspace"] as const;
const EXPENSE_FORM_QUERY_KEY = ["expense-form-workspace"] as const;

interface ExpensesWorkspacePayload {
  expenses: any[];
  categories: any[];
  counterparties: any[];
  ownerTransactions: any[];
  payments: any[];
  documents: any[];
  accountingPolicy?: any;
}

interface ExpenseFormWorkspacePayload {
  categories: any[];
  counterparties: any[];
  cashAccounts: any[];
  accountingPolicy?: any;
}

interface ExpenseDetailPayload {
  expense: any;
  category?: any;
  counterparty?: any;
  document?: any;
  payment?: any;
}

const LEGACY_EXPENSE_COLLECTION_KEYS = [
  "operatingExpenses",
  "expenseCategories",
  "ownerTransactions",
  "payments",
  "documents",
  "cashAccounts",
  "counterparties"
] as const;

function invalidateExpenseArea(queryClient: QueryClient, expenseId?: string) {
  void queryClient.invalidateQueries({ queryKey: EXPENSES_WORKSPACE_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: EXPENSE_FORM_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ["finance-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
  if (expenseId) void queryClient.invalidateQueries({ queryKey: ["expense-card", expenseId] });
  for (const key of LEGACY_EXPENSE_COLLECTION_KEYS) {
    void queryClient.invalidateQueries({ queryKey: ["collection", key] });
  }
}

export function ExpensesWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: EXPENSES_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<ExpensesWorkspacePayload>("/api/finance/expenses/workspace")
  });
  const expenses = workspaceQuery.data?.expenses ?? [];
  const categories = workspaceQuery.data?.categories ?? [];
  const counterparties = workspaceQuery.data?.counterparties ?? [];
  const ownerTransactions = workspaceQuery.data?.ownerTransactions ?? [];
  const payments = workspaceQuery.data?.payments ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const accountingStartDate = workspaceQuery.data?.accountingPolicy?.accountingStartDate;
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const postExpense = useMutation({
    mutationFn: (expenseId: string) => apiPost(`/api/finance/expenses/${expenseId}/post`),
    onSuccess: (_data, expenseId) => invalidateExpenseArea(queryClient, expenseId)
  });
  const postSelected = useMutation({
    mutationFn: async () => {
      for (const expenseId of selectedIds) {
        await apiPost(`/api/finance/expenses/${expenseId}/post`);
      }
    },
    onSuccess: () => {
      invalidateExpenseArea(queryClient);
      setSelectedIds([]);
    }
  });

  useEffect(() => {
    if (!accountingStartDate) return;
    setDateFrom((current) => current === today() ? accountingStartDate : current);
  }, [accountingStartDate]);

  const rows = useMemo(() => {
    return expenses
      .slice()
      .sort((left: any, right: any) => String(right.expenseDate).localeCompare(String(left.expenseDate)))
      .map((expense: any) => {
        const category = categories.find((candidate: any) => candidate.id === expense.categoryId);
        const counterparty = counterparties.find((candidate: any) => candidate.id === expense.counterpartyId);
        const payment = payments.find((candidate: any) => candidate.id === expense.paymentId);
        const document = documents.find((candidate: any) => candidate.id === expense.documentId);
        const effect = expense.paymentMode === "paid_now"
          ? `Дт ${category?.accountCode ?? "—"} / Кт 51`
          : `Дт ${category?.accountCode ?? "—"} / Кт 60.01`;
        return { expense, category, counterparty, payment, document, effect };
      })
      .filter((row) => {
        if (dateFrom && row.expense.expenseDate < dateFrom) return false;
        if (dateTo && row.expense.expenseDate > dateTo) return false;
        if (categoryId && row.expense.categoryId !== categoryId) return false;
        if (counterpartyId && row.expense.counterpartyId !== counterpartyId) return false;
        if (paymentStatus && row.expense.paymentStatus !== paymentStatus) return false;
        return true;
      });
  }, [categories, categoryId, counterparties, counterpartyId, dateFrom, dateTo, documents, expenses, paymentStatus, payments]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [dateFrom, dateTo, categoryId, counterpartyId, paymentStatus]);

  const pagedRows = useMemo(() => paginateRows<any>(rows, page, pageSize), [rows, page, pageSize]);

  const totals = useMemo(() => {
    const paid = rows.reduce((sum, row) => sum + (row.expense.paymentStatus === "paid" ? row.expense.amountRub : 0), 0);
    const unpaid = rows.reduce((sum, row) => sum + (row.expense.paymentStatus === "unpaid" ? row.expense.amountRub : 0), 0);
    const withdrawals = ownerTransactions.reduce((sum, row) => sum + (row.transactionType === "withdrawal" ? row.amountRub : 0), 0);
    return {
      total: rows.reduce((sum, row) => sum + row.expense.amountRub, 0),
      paid,
      unpaid,
      withdrawals
    };
  }, [ownerTransactions, rows]);

  const draftCount = rows.filter((row) => row.expense.paymentStatus === "draft").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Расходы"
        subtitle="Операционные расходы компании и выводы владельца. Оплата может проходить сразу или остаться к оплате."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary"><Link to="/finance/expenses/new"><Plus size={14} /> Добавить расход</Link></Button>
            <Button variant="secondary" onClick={() => setWithdrawalOpen(true)}><UserRound size={14} /> Внести вывод владельца</Button>
            <Button onClick={() => postSelected.mutate()} disabled={postSelected.isPending || selectedIds.length === 0}>
              <Save size={14} /> Провести выбранные
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi tone="warning" label="Расходы" value={rub(totals.total)} hint={`${rows.length} операций`} />
        <Kpi tone="success" label="Оплачено" value={rub(totals.paid)} hint={`${rows.filter((row) => row.expense.paymentStatus === "paid").length} операций`} />
        <Kpi tone="danger" label="К оплате" value={rub(totals.unpaid)} hint={`${rows.filter((row) => row.expense.paymentStatus === "unpaid").length} операций`} />
        <Kpi tone="neutral" label="Вывод владельца" value={rub(totals.withdrawals)} hint={`${ownerTransactions.filter((row) => row.transactionType === "withdrawal").length} операций`} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Field label="Период" className="min-w-[280px]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
          </Field>
          <Field label="Категория" className="min-w-[220px]">
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Все категории</option>
              {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <Field label="Контрагент" className="min-w-[220px]">
            <Select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
              <option value="">Все контрагенты</option>
              {counterparties.map((counterparty: any) => <option key={counterparty.id} value={counterparty.id}>{counterparty.name}</option>)}
            </Select>
          </Field>
          <Field label="Статус оплаты" className="min-w-[200px]">
            <Select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
              <option value="">Все статусы</option>
              <option value="draft">Черновик</option>
              <option value="paid">Оплачено</option>
              <option value="unpaid">К оплате</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Операционные расходы</CardTitle>
            <CardDescription>{draftCount > 0 ? `Черновиков к проведению: ${draftCount}` : "Каждая строка ведёт в карточку расхода."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={<ReceiptText size={20} />} title="Расходов по фильтрам нет" />
          ) : (
            <Table>
              <THead><TR><TH className="w-12"><Checkbox checked={selectedIds.length > 0 && selectedIds.length === rows.filter((row) => row.expense.paymentStatus === "draft").length} onCheckedChange={(checked) => setSelectedIds(checked ? rows.filter((row) => row.expense.paymentStatus === "draft").map((row) => row.expense.id) : [])} /></TH><TH>Дата</TH><TH>Категория</TH><TH>Контрагент</TH><TH numeric>Сумма</TH><TH>Статус оплаты</TH><TH>Документ</TH><TH>Эффект</TH></TR></THead>
              <TBody>
                {pagedRows.map((row) => {
                  const selected = selectedIds.includes(row.expense.id);
                  const isDraft = row.expense.paymentStatus === "draft";
                  return (
                    <TR key={row.expense.id} interactive onClick={() => navigate(`/finance/expenses/${row.expense.id}`)}>
                      <TD onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected}
                          disabled={!isDraft}
                          onCheckedChange={(checked) => setSelectedIds((current) => checked ? [...new Set([...current, row.expense.id])] : current.filter((value) => value !== row.expense.id))}
                        />
                      </TD>
                      <TD muted className="numeric">{date(row.expense.expenseDate)}</TD>
                      <TD>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.category?.name ?? "—"}</span>
                          <span className="text-xs text-[var(--color-muted-foreground)]">Счёт {row.category?.accountCode ?? "—"}</span>
                        </div>
                      </TD>
                      <TD>{row.counterparty?.name ?? "—"}</TD>
                      <TD numeric className="font-semibold">{rub(row.expense.amountRub)}</TD>
                      <TD><Badge tone={expenseTone(row.expense.paymentStatus)}>{expenseLabel(row.expense.paymentStatus)}</Badge></TD>
                      <TD>{row.document ? <Link to={`/documents/${row.document.id}`} className="text-[var(--color-primary)] hover:underline" onClick={(event) => event.stopPropagation()}>{row.document.number}</Link> : "—"}</TD>
                      <TD muted className="text-xs">{row.effect}</TD>
                    </TR>
                  );
                })}
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
                setSelectedIds([]);
              }}
            />
          )}
        </CardContent>
      </Card>

      <OwnerWithdrawalDialog open={withdrawalOpen} onClose={() => setWithdrawalOpen(false)} />
    </div>
  );
}

export function ExpenseFormPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formQuery = useQuery({
    queryKey: EXPENSE_FORM_QUERY_KEY,
    queryFn: () => apiGet<ExpenseFormWorkspacePayload>("/api/finance/expenses/form-workspace")
  });
  const categories = formQuery.data?.categories ?? [];
  const counterparties = formQuery.data?.counterparties ?? [];
  const cashAccounts = (formQuery.data?.cashAccounts ?? []).filter((account: any) => account.isActive);
  const defaultExpenseDate = formQuery.data?.accountingPolicy?.accountingStartDate ?? today();
  const defaultCategoryId = categories[0]?.id ?? "";
  const defaultCounterpartyId = counterparties[0]?.id ?? "";
  const defaultCashAccountId = cashAccounts[0]?.id ?? "";

  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [expenseDate, setExpenseDate] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [amountRub, setAmountRub] = useState("45000");
  const [cashAccountId, setCashAccountId] = useState("");
  const [comment, setComment] = useState("Аренда склада за июнь");

  useEffect(() => {
    if (defaultsApplied || !formQuery.data) return;
    setExpenseDate(defaultExpenseDate);
    setCategoryId(defaultCategoryId);
    setCounterpartyId(defaultCounterpartyId);
    setCashAccountId(defaultCashAccountId);
    setDefaultsApplied(true);
  }, [defaultCashAccountId, defaultCategoryId, defaultCounterpartyId, defaultExpenseDate, defaultsApplied, formQuery.data]);

  const create = useMutation({
    mutationFn: async () => apiPost("/api/finance/expenses", {
      categoryId,
      counterpartyId: counterpartyId || undefined,
      counterpartyName: counterpartyId ? undefined : counterpartyName || undefined,
      expenseDate,
      amountRub: Number(amountRub),
      cashAccountId,
      comment
    }),
    onSuccess: (created: any) => {
      invalidateExpenseArea(queryClient, created?.id);
      navigate("/money?view=outgoing&type=expense_like");
    }
  });

  const category = categories.find((candidate: any) => candidate.id === categoryId);
  const counterparty = counterparties.find((candidate: any) => candidate.id === counterpartyId);
  const canSubmit = Boolean(categoryId && Number(amountRub) > 0 && (counterpartyId || counterpartyName.trim()) && cashAccountId);
  const creditAccount = "51";
  const creditLabel = "Расчетный счет";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Расход компании" }]}
        title="Операционный расход"
        subtitle="Расход компании с оплатой сразу."
        actions={<Button variant="ghost" asChild><Link to="/money?view=outgoing&type=expense_like"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Основные данные</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
              <Field label="Дата учета" required>
                <Input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
              </Field>
              <Field label="Статья расхода" required>
                <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  {categories.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Контрагент" required>
                <Select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
                  <option value="">Новый контрагент</option>
                  {counterparties.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Сумма" required>
                <Input type="number" value={amountRub} onChange={(event) => setAmountRub(event.target.value)} />
              </Field>
              {!counterpartyId && (
                <div className="md:col-span-2">
                  <Field label="Название нового контрагента" required>
                    <Input value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} placeholder="ООО «Аренда-Плюс»" />
                  </Field>
                </div>
              )}
              <div className="md:col-span-2">
                <Field label="Комментарий">
                  <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Оплата</CardTitle></CardHeader>
            <CardContent className="py-5">
              <Field label="Денежный счет" required>
                <Select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
                  {cashAccounts.map((account: any) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </Select>
              </Field>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" asChild><Link to="/money?view=outgoing&type=expense_like">Отмена</Link></Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !canSubmit}><Save size={14} /> Сохранить расход</Button>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card className="h-fit sticky top-20 min-w-0 overflow-hidden">
            <CardHeader className="min-w-0">
              <div className="min-w-0">
                <CardTitle>Бухгалтерский эффект</CardTitle>
                <CardDescription>{category?.name ?? "Выберите статью расхода"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="min-w-0 flex flex-col gap-4">
              <Info label="Категория P&L" value={category?.name ?? "—"} />
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Предпросмотр проводки</div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Дебет</div>
                    <div className="mt-1 font-semibold">{category?.accountCode ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Кредит</div>
                    <div className="mt-1 font-semibold">{creditAccount}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Сумма</div>
                    <div className="mt-1 font-semibold">{rub(Number(amountRub) || 0)}</div>
                  </div>
                </div>
              </div>
              <Info label="Контрагент" value={counterparty?.name ?? (counterpartyName || "—")} />
              <Info label="Оплата" value="Оплачено сразу" />
              <Info label="Кредитовый счет" value={creditLabel} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function ExpenseCardPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const expenseQuery = useQuery({
    queryKey: ["expense-card", id],
    queryFn: () => apiGet<ExpenseDetailPayload>(`/api/finance/expenses/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id)
  });
  const expense = expenseQuery.data?.expense;
  const category = expenseQuery.data?.category;
  const counterparty = expenseQuery.data?.counterparty;
  const document = expenseQuery.data?.document;
  const payment = expenseQuery.data?.payment;

  const post = useMutation({
    mutationFn: () => apiPost(`/api/finance/expenses/${id}/post`),
    onSuccess: () => invalidateExpenseArea(queryClient, id)
  });

  if (!expense && expenseQuery.isLoading) {
    return <PageHeader title="Карточка расхода" breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }]} subtitle="Загружаем расход" />;
  }

  if (!expense) {
    return <PageHeader title="Карточка расхода" breadcrumbs={[{ label: "Деньги и расчеты", to: "/money" }]} subtitle="Расход не найден" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Деньги и расчеты", to: "/money?view=outgoing&type=expense_like" }, { label: expense.id }]}
        title={category?.name ?? "Операционный расход"}
        subtitle={`${date(expense.expenseDate)} · ${counterparty?.name ?? "Без контрагента"}`}
        badge={<Badge tone={expenseTone(expense.paymentStatus)}>{expenseLabel(expense.paymentStatus)}</Badge>}
        actions={
          <div className="flex gap-2">
            {expense.paymentStatus === "draft" && <Button onClick={() => post.mutate()} disabled={post.isPending}><Save size={14} /> Провести</Button>}
            {document && <Button variant="secondary" asChild><Link to={`/documents/${document.id}`}>Открыть документ</Link></Button>}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
            <Info label="Дата учета" value={date(expense.expenseDate)} />
            <Info label="Статья" value={category?.name ?? "—"} />
            <Info label="Контрагент" value={counterparty?.name ?? "—"} />
            <Info label="Сумма" value={rub(expense.amountRub)} />
            <Info label="Оплачено" value={rub(expense.amountPaidRub)} />
            <Info label="Способ оплаты" value={expense.paymentMode === "paid_now" ? "Оплата сейчас" : expense.paymentMode === "pay_later" ? "К оплате позже" : "Без оплаты"} />
            <div className="md:col-span-2">
              <Info label="Комментарий" value={expense.comment ?? "—"} />
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader className="min-w-0">
            <div className="min-w-0">
              <CardTitle>Связи</CardTitle>
              <CardDescription>Документ, платеж и проводка расхода</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 flex flex-col gap-3">
            <Info label="Документ" value={document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"} />
            <Info label="Платеж" value={payment ? `${payment.paymentType} · ${rub(payment.amountRub)}` : "—"} />
            <Info label="Создано" value={document?.createdAt ? dateTime(document.createdAt) : "—"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OwnerWithdrawalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [paidAt, setPaidAt] = useState(today());
  const [amountRub, setAmountRub] = useState("50000");
  const [comment, setComment] = useState("Вывод средств владельцем");

  const create = useMutation({
    mutationFn: () => apiPost("/api/finance/owner-withdrawals", { paidAt, amountRub: Number(amountRub), comment }),
    onSuccess: () => {
      invalidateExpenseArea(queryClient);
      onClose();
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Вывод владельца</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Дата" required><Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></Field>
          <Field label="Сумма, RUB" required><Input type="number" value={amountRub} onChange={(event) => setAmountRub(event.target.value)} /></Field>
          <Field label="Комментарий"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || Number(amountRub) <= 0}><Banknote size={14} /> Провести</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function expenseTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "unpaid") return "warning";
  return "neutral";
}

function expenseLabel(status: string) {
  if (status === "draft") return "Черновик";
  if (status === "paid") return "Оплачено";
  if (status === "unpaid") return "К оплате";
  return status;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}
