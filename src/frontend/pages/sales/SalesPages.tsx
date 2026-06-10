import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Trash2
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductCell, ProductThumb } from "@/components/product-thumb";
import { EntityDeleteDialog, type EntityRollbackPreview } from "@/components/entity-delete-dialog";
import { rub, qty, date, dateTime } from "@/lib/format";
import { apiDelete, apiGet, apiPost } from "@/api";
import { stockStateLabel, documentStatusLabel } from "@/lib/i18n";
import {
  channelFinanceAllocatedAmountForSale,
  channelFinanceCategoryLabel,
  channelFinanceSourceOperationCode,
  channelFinanceSourceOperationName,
  channelFinanceSaleAllocations,
  isExpenseFinanceTreatment,
  channelFinanceTreatmentLabel,
  isChannelOperatingTreatment,
  isVariableMarketplaceTreatment
} from "../../../shared/channel-finance";
import { invalidateSalesArea, useSalesWorkspace } from "./sales-queries";

const today = () => new Date().toISOString().slice(0, 10);

export function SalesWorkspace() {
  const state = useSalesWorkspace();
  const sales = state.sales ?? [];
  const saleLines = state.saleLines ?? [];
  const channels = state.salesChannels ?? [];
  const products = state.products ?? [];
  const returns = state.salesReturns ?? [];
  const documents = state.documents ?? [];
  const financeEvents = state.channelFinanceEvents ?? [];
  const queryClient = useQueryClient();

  const [channelId, setChannelId] = useState("");
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("");
  const [costStatus, setCostStatus] = useState("");
  const [returnStatus, setReturnStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const recalculate = useMutation({
    mutationFn: () => apiPost("/api/recalculation-jobs", { jobType: "sales_profit", scope: { channelId, productId } }),
    onSuccess: () => invalidateSalesArea(queryClient)
  });

  const rows = useMemo(() => {
    const postedFinanceEvents = financeEvents.filter((event: any) => event.status === "posted");
    const financeBySale = postedFinanceEvents.reduce((acc: Map<string, any[]>, event: any) => {
      for (const allocation of channelFinanceSaleAllocations(event)) {
        const bucket = acc.get(allocation.saleId) ?? [];
        bucket.push({
          ...event,
          allocatedAmountRub: allocation.amountRub,
          allocationCount: channelFinanceSaleAllocations(event).length
        });
        acc.set(allocation.saleId, bucket);
      }
      return acc;
    }, new Map<string, any[]>());
    return sales
      .slice()
      .sort((left: any, right: any) => String(right.saleDate).localeCompare(String(left.saleDate)))
      .map((sale: any) => {
        const revenueRub = saleRevenueRub(sale);
        const lines = saleLines.filter((line: any) => line.saleId === sale.id);
        const totalQty = lines.reduce((sum: number, line: any) => sum + Number(line.qty ?? 0), 0);
        const costRub = lines.reduce((sum: number, line: any) => sum + Number(line.costRub ?? 0), 0);
        const saleFinanceEvents = financeBySale.get(sale.id) ?? [];
        const profit = buildSaleProfitSummary({
          grossAmountRub: revenueRub,
          costRub,
          grossProfitRub: sale.grossProfitRub,
          financeEvents: saleFinanceEvents
        });
        const hasReturn = returns.some((candidate: any) => candidate.saleId === sale.id);
        const channel = channels.find((candidate: any) => candidate.id === sale.channelId);
        const document = documents.find((candidate: any) => candidate.id === sale.documentId);
        return { sale, revenueRub, lines, totalQty, costRub, hasReturn, channel, document, profit };
      })
      .filter((row) => {
        if (channelId && row.sale.channelId !== channelId) return false;
        if (productId && !row.lines.some((line: any) => line.productId === productId)) return false;
        if (status && row.sale.status !== status) return false;
        if (dateFrom && row.sale.saleDate < dateFrom) return false;
        if (dateTo && row.sale.saleDate > dateTo) return false;
        if (costStatus === "missing" && row.costRub > 0) return false;
        if (costStatus === "ready" && row.costRub <= 0) return false;
        if (returnStatus === "returned" && !row.hasReturn) return false;
        if (returnStatus === "open" && row.hasReturn) return false;
        return true;
      });
  }, [sales, saleLines, returns, channels, documents, financeEvents, channelId, productId, status, dateFrom, dateTo, costStatus, returnStatus]);

  const pagedRows = useMemo(() => paginateRows<any>(rows, page, pageSize), [rows, page, pageSize]);

  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenueRub ?? 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costRub, 0);
  const totalProfit = rows.reduce((sum, row) => sum + row.profit.linkedNetProfitRub, 0);
  const averageRoi = rows.filter((row) => row.costRub > 0).length > 0
    ? round2(rows.filter((row) => row.costRub > 0).reduce((sum, row) => sum + row.profit.roiPercent, 0) / rows.filter((row) => row.costRub > 0).length)
    : 0;
  const missingCost = rows.filter((row) => row.costRub <= 0 && row.sale.status !== "draft").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Продажи"
        subtitle="Продажи признают выручку отдельно от комиссий канала и списывают FIFO-себестоимость с точки продаж."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to="/integrations/inbox?eventType=sale"><Boxes size={14} /> Обработать события</Link></Button>
            <Button variant="secondary" onClick={() => recalculate.mutate()} disabled={recalculate.isPending}><RefreshCcw size={14} /> Пересчитать себестоимость</Button>
            <Button asChild><Link to="/sales/new"><Plus size={14} /> Создать продажу</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" label="Выручка" value={rub(totalRevenue)} />
        <Kpi tone="warning" label="Себестоимость продаж" value={rub(totalCost)} />
        <Kpi tone="success" label="Прибыль после расходов канала" value={rub(totalProfit)} />
        <Kpi tone="info" label="Средний ROI" value={`${averageRoi >= 0 ? "+" : ""}${averageRoi.toFixed(2)}%`} hint={`Без себестоимости: ${missingCost}`} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="w-44" aria-label="Продажи от даты" />
          <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="w-44" aria-label="Продажи до даты" />
          <Select value={channelId} onChange={(event) => { setChannelId(event.target.value); setPage(1); }} className="w-48">
            <option value="">Все каналы</option>
            {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </Select>
          <Select value={productId} onChange={(event) => { setProductId(event.target.value); setPage(1); }} className="w-56">
            <option value="">Все товары</option>
            {products.map((product: any) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="w-40">
            <option value="">Все статусы</option>
            <option value="posted">Проведён</option>
            <option value="shipped">Ждёт начисления</option>
            <option value="reversed">Сторнирован</option>
          </Select>
          <Select value={costStatus} onChange={(event) => { setCostStatus(event.target.value); setPage(1); }} className="w-44">
            <option value="">Любая себестоимость</option>
            <option value="ready">Себестоимость есть</option>
            <option value="missing">Без себестоимости</option>
          </Select>
          <Select value={returnStatus} onChange={(event) => { setReturnStatus(event.target.value); setPage(1); }} className="w-40">
            <option value="">Любой возврат</option>
            <option value="open">Без возвратов</option>
            <option value="returned">Есть возвраты</option>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={<Boxes size={20} />} title="Продаж по фильтрам нет" description="Создайте ручную продажу или обработайте внешние события из канала." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Дата</TH>
                  <TH>Канал</TH>
                  <TH>Внешний заказ</TH>
                  <TH>Товары</TH>
                  <TH numeric>Кол-во</TH>
                  <TH numeric>Выручка</TH>
                  <TH numeric>Себестоимость</TH>
                  <TH numeric>Расходы канала</TH>
                  <TH numeric>Прибыль</TH>
                  <TH numeric>ROI</TH>
                  <TH>Статус</TH>
                  <TH>Источник</TH>
                </TR>
              </THead>
              <TBody>
                {pagedRows.map((row) => (
                  <TR key={row.sale.id} interactive>
                    <TD muted className="numeric text-xs">
                      <Link to={`/sales/${row.sale.id}`} className="text-[var(--color-primary)] hover:underline">{date(row.sale.saleDate)}</Link>
                    </TD>
                    <TD>{row.channel?.name ?? "—"}</TD>
                    <TD muted className="font-mono text-xs">{row.sale.externalOrderId ?? row.sale.externalEventId ?? "—"}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        {row.lines.slice(0, 3).map((line: any) => {
                          const product = products.find((candidate: any) => candidate.id === line.productId);
                          return <ProductThumb key={line.id} product={product} size={28} />;
                        })}
                        {row.lines.length > 3 && <Badge tone="neutral" size="sm">+{row.lines.length - 3}</Badge>}
                      </div>
                    </TD>
                    <TD numeric>{qty(row.totalQty)}</TD>
                    <TD numeric className="font-semibold">{rub(row.revenueRub)}</TD>
                    <TD numeric>{rub(row.costRub)}</TD>
                    <TD numeric>{rub(row.profit.totalLinkedExpensesRub)}</TD>
                    <TD numeric className={row.profit.linkedNetProfitRub >= 0 ? "text-[var(--color-success)] font-semibold" : "text-[var(--color-danger)] font-semibold"}>{rub(row.profit.linkedNetProfitRub)}</TD>
                    <TD numeric className={row.profit.roiPercent >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>{`${row.profit.roiPercent >= 0 ? "+" : ""}${row.profit.roiPercent.toFixed(2)}%`}</TD>
                    <TD>
                      <StatusBadge status={row.sale.status} />
                    </TD>
                    <TD><Badge tone="neutral" size="sm">{documentStatusLabel[row.document?.source as string] ?? row.document?.source ?? "manual"}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
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
      </Card>
    </div>
  );
}

export function ManualSaleFormPage() {
  const state = useSalesWorkspace();
  const channels = state.salesChannels ?? [];
  const products = state.products ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [saleDate, setSaleDate] = useState(today());
  const [externalOrderId, setExternalOrderId] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; qty: string; priceRub: string }>>([
    { productId: "", qty: "1", priceRub: "" }
  ]);

  const canSubmit = Boolean(
    channelId &&
    lines.length > 0 &&
    lines.every((line) => line.productId && Number(line.qty) > 0 && line.priceRub.trim() !== "" && Number(line.priceRub) >= 0)
  );

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => apiPost<any>("/api/sales", {
      channelId,
      saleDate,
      externalOrderId: externalOrderId || undefined,
      post,
      lines: lines.map((line) => ({ productId: line.productId, qty: Number(line.qty), priceRub: Number(line.priceRub) }))
    }),
    onSuccess: (sale) => {
      invalidateSalesArea(queryClient);
      navigate(`/sales/${sale.id}`);
    }
  });

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Продажи", to: "/sales" }, { label: "Новая продажа" }]}
        title="Ручная продажа"
        subtitle="Для ручного ввода: продажа признает выручку и при проведении списывает FIFO-себестоимость со склада точки продаж."
        actions={<Button variant="ghost" asChild><Link to="/sales"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 py-5">
          <Field label="Канал" required>
            <Select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
              {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </Select>
          </Field>
          <Field label="Дата продажи" required>
            <Input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
          </Field>
          <Field label="Внешний заказ">
            <Input value={externalOrderId} onChange={(event) => setExternalOrderId(event.target.value)} placeholder="posting / order id" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Строки продажи</CardTitle>
            <CardDescription>Цена указывается в RUB за единицу. Себестоимость подтянется при проведении.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Товар</TH><TH numeric>Кол-во</TH><TH numeric>Цена за ед.</TH><TH numeric>Выручка</TH><TH></TH></TR></THead>
            <TBody>
              {lines.map((line, index) => (
                <TR key={`sale-line-${index}`}>
                  <TD>
                    <Select value={line.productId} onChange={(event) => updateSaleLine(setLines, index, { productId: event.target.value })}>
                      <option value="">Выберите товар</option>
                      {products.map((product: any) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </Select>
                  </TD>
                  <TD numeric><Input type="number" min="0" step="0.0001" value={line.qty} onChange={(event) => updateSaleLine(setLines, index, { qty: event.target.value })} /></TD>
                  <TD numeric><Input type="number" min="0" step="0.01" value={line.priceRub} onChange={(event) => updateSaleLine(setLines, index, { priceRub: event.target.value })} placeholder="0" /></TD>
                  <TD numeric className="font-semibold">{rub(Number(line.qty || 0) * Number(line.priceRub || 0))}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, currentIndex) => currentIndex !== index))}>Удалить</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
        <div className="px-5 pb-4">
          <Button variant="secondary" onClick={() => setLines((current) => [...current, { productId: "", qty: "1", priceRub: "" }])}><Plus size={14} /> Добавить строку</Button>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={() => create.mutate({ post: false })} disabled={create.isPending || !canSubmit}><Save size={14} /> Сохранить черновик</Button>
        <Button size="lg" onClick={() => create.mutate({ post: true })} disabled={create.isPending || !canSubmit}><Save size={14} /> Провести продажу</Button>
      </div>
    </div>
  );
}

export function SaleCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useSalesWorkspace();
  const queryClient = useQueryClient();
  const sale = (state.sales ?? []).find((candidate: any) => candidate.id === id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const requireSale = () => {
    if (!sale) throw new Error("sale_missing");
    return sale;
  };
  const saleDeletePreview = useQuery({
    queryKey: ["sale-delete-preview", sale?.id ?? id],
    queryFn: () => apiGet<EntityRollbackPreview>(`/api/sales/${requireSale().id}/delete-preview`),
    enabled: deleteOpen && Boolean(sale)
  });

  const post = useMutation({
    mutationFn: () => apiPost(`/api/sales/${requireSale().id}/post`),
    onSuccess: () => invalidateSalesArea(queryClient)
  });
  const removeSale = useMutation({
    mutationFn: () => apiDelete(`/api/sales/${requireSale().id}`),
    onSuccess: () => {
      invalidateSalesArea(queryClient);
      navigate("/sales");
    }
  });
  if (!sale) return null;
  const lines = (state.saleLines ?? []).filter((line: any) => line.saleId === sale.id);
  const products = state.products ?? [];
  const channel = (state.salesChannels ?? []).find((candidate: any) => candidate.id === sale.channelId);
  const document = (state.documents ?? []).find((candidate: any) => candidate.id === sale.documentId);
  const journalEntry = (state.journalEntries ?? []).find((candidate: any) => candidate.documentId === sale.documentId);
  const financialDocument = sale.financialDocumentId ? (state.documents ?? []).find((candidate: any) => candidate.id === sale.financialDocumentId) : undefined;
  const financialJournalEntry = sale.financialDocumentId ? (state.journalEntries ?? []).find((candidate: any) => candidate.documentId === sale.financialDocumentId) : undefined;
  const externalEvents = state.externalEvents ?? [];
  const externalEvent = externalEvents.find((candidate: any) => candidate.id === sale.externalEventId);
  const financeEvents = (state.channelFinanceEvents ?? [])
    .filter((candidate: any) => channelFinanceAllocatedAmountForSale(candidate, sale.id) > 0)
    .map((candidate: any) => ({
      ...candidate,
      allocatedAmountRub: channelFinanceAllocatedAmountForSale(candidate, sale.id),
      allocationCount: channelFinanceSaleAllocations(candidate).length
    }));
  const postedFinanceEvents = financeEvents.filter((candidate: any) => candidate.status === "posted");
  const hasLinkedExpenses = postedFinanceEvents.some((candidate: any) => isExpenseFinanceTreatment(candidate.treatment));
  const externalEventById = new Map(externalEvents.map((candidate: any) => [candidate.id, candidate]));
  const costApplications = (state.costApplications ?? []).filter((candidate: any) => candidate.outboundDocumentId === sale.documentId);
  const lots = state.inventoryLots ?? [];
  const sourceDocuments = state.documents ?? [];
  const warehouse = (state.warehouses ?? []).find((candidate: any) => candidate.id === sale.warehouseId);
  const revenueRub = saleRevenueRub(sale);
  const profit = buildSaleProfitSummary({
    grossAmountRub: revenueRub,
    costRub: sale.costAmountRub,
    grossProfitRub: sale.grossProfitRub,
    financeEvents: postedFinanceEvents
  });
  const saleLinesWithProfit = lines.map((line: any) => {
    const share = revenueRub > 0 ? Number(line.revenueRub ?? 0) / revenueRub : 0;
    const allocatedChannelExpensesRub = round2(profit.totalLinkedExpensesRub * share);
    const allocatedIncomeRub = round2(profit.linkedOtherIncomeRub * share);
    const lineProfitRub = round2(Number(line.revenueRub ?? 0) - Number(line.costRub ?? 0) - allocatedChannelExpensesRub + allocatedIncomeRub);
    const lineRoiPercent = Number(line.costRub ?? 0) > 0 ? round2((lineProfitRub / Number(line.costRub ?? 0)) * 100) : 0;
    return {
      ...line,
      allocatedChannelExpensesRub,
      allocatedIncomeRub,
      lineProfitRub,
      lineRoiPercent
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Продажи", to: "/sales" }, { label: sale.externalOrderId ?? sale.id }]}
        title={`Продажа · ${channel?.name ?? "Канал"}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{date(sale.saleDate)}</span>
            {sale.externalOrderId && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <span>внешний заказ {sale.externalOrderId}</span>
              </>
            )}
            {document && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link>
              </>
            )}
            {journalEntry && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <Link to={`/reports/journal/${journalEntry.id}`} className="text-[var(--color-primary)] hover:underline">журнал {journalEntry.id}</Link>
              </>
            )}
            {financialDocument && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <Link to={`/documents/${financialDocument.id}`} className="text-[var(--color-primary)] hover:underline">{financialDocument.number}</Link>
              </>
            )}
            {financialJournalEntry && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <Link to={`/reports/journal/${financialJournalEntry.id}`} className="text-[var(--color-primary)] hover:underline">фин. журнал {financialJournalEntry.id}</Link>
              </>
            )}
            {externalEvent && (
              <>
                <span className="text-[var(--color-muted-foreground)]/40">·</span>
                <Link to="/integrations/inbox" className="text-[var(--color-primary)] hover:underline">событие {externalEvent.externalId}</Link>
              </>
            )}
          </span>
        }
        badge={<StatusBadge status={sale.status} />}
        actions={
          <div className="flex gap-2">
            {sale.status === "draft" && <Button onClick={() => post.mutate()} disabled={post.isPending}><Save size={14} /> Провести</Button>}
            <Button asChild><Link to={`/sales/${sale.id}/returns/new`}><RotateCcw size={14} /> Создать возврат</Link></Button>
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

      <div className="flex flex-col gap-5">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Состав продажи</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Товар</TH><TH numeric>Кол-во</TH><TH numeric>Цена</TH><TH numeric>Выручка</TH><TH numeric>FIFO</TH><TH numeric>Расходы канала</TH><TH numeric>Прибыль</TH><TH numeric>ROI</TH></TR></THead>
              <TBody>
                {saleLinesWithProfit.map((line: any) => {
                  const product = products.find((candidate: any) => candidate.id === line.productId);
                  return (
                    <TR key={line.id}>
                      <TD><ProductCell product={product} /></TD>
                      <TD numeric>{qty(line.qty)}</TD>
                      <TD numeric>{rub(line.priceRub)}</TD>
                      <TD numeric className="font-semibold">{rub(line.revenueRub)}</TD>
                      <TD numeric>{rub(line.costRub)}</TD>
                      <TD numeric>{rub(line.allocatedChannelExpensesRub)}</TD>
                      <TD numeric className={line.lineProfitRub >= 0 ? "text-[var(--color-success)] font-semibold" : "text-[var(--color-danger)] font-semibold"}>{rub(line.lineProfitRub)}</TD>
                      <TD numeric className={line.lineRoiPercent >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>{`${line.lineRoiPercent >= 0 ? "+" : ""}${line.lineRoiPercent.toFixed(2)}%`}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
            <Kpi label="Выручка" value={rub(revenueRub)} hint={sale.status === "shipped" ? "Ждёт начисления маркетплейса" : undefined} />
            <Kpi label="FIFO-себестоимость" value={rub(sale.costAmountRub)} hint={`Валовая: ${rub(sale.grossProfitRub)}`} />
            <Kpi
              label="Расходы канала"
              value={rub(profit.totalLinkedExpensesRub)}
              hint={`Переменные ${rub(profit.variableMarketplaceExpensesRub)} · Overhead ${rub(profit.linkedChannelOverheadRub)}`}
            />
            <Kpi
              tone={profit.linkedNetProfitRub >= 0 ? "success" : "danger"}
              label="Прибыль"
              value={rub(profit.linkedNetProfitRub)}
              hint={`= ${rub(revenueRub)} − ${rub(sale.costAmountRub)} − ${rub(profit.totalLinkedExpensesRub)}`}
            />
            <Kpi
              tone={profit.roiPercent >= 0 ? "success" : "danger"}
              label="ROI"
              value={`${profit.roiPercent >= 0 ? "+" : ""}${profit.roiPercent.toFixed(2)}%`}
            />
          </CardContent>
        </Card>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-4 md:grid-cols-4">
          <MetaItem label="Точка продаж" value={warehouse?.name ?? channel?.name ?? "—"} />
          <MetaItem label="Дата продажи" value={date(sale.saleDate)} />
          <MetaItem label="Внешнее событие" value={externalEvent?.externalId ?? "—"} />
          <MetaItem label="Привязанные расходы" value={<Badge tone={hasLinkedExpenses ? "success" : "neutral"}>{hasLinkedExpenses ? "Есть" : "Нет"}</Badge>} />
          <MetaItem label="Возвраты" value={<span className="flex items-center gap-2">{returnsLabel(state.salesReturns ?? [], sale.id)}</span>} />
        </dl>
      </div>

      <Card>
        <CardContent className="py-4">
          <Tabs defaultValue="cost">
            <TabsList>
              <TabsTrigger value="cost">Себестоимость {costApplications.length > 0 && <Badge tone="neutral" size="sm">{costApplications.length}</Badge>}</TabsTrigger>
              <TabsTrigger value="finance">Финансы канала {financeEvents.length > 0 && <Badge tone="neutral" size="sm">{financeEvents.length}</Badge>}</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
            </TabsList>

            <TabsContent value="cost">
              {costApplications.length === 0 ? (
                <EmptyState icon={<Boxes size={20} />} title="Списания партий пока нет" description="Для черновика себестоимость появится после проведения. Для импорта без остатка продажа останется в статусе needs_attention." />
              ) : (
                <Table>
                  <THead><TR><TH>Товар</TH><TH>Партия</TH><TH>Источник</TH><TH numeric>Кол-во</TH><TH numeric>Себестоимость</TH></TR></THead>
                  <TBody>
                    {costApplications.map((application: any) => {
                      const lot = lots.find((candidate: any) => candidate.id === application.fromLotId);
                      const sourceDocument = sourceDocuments.find((candidate: any) => candidate.id === application.sourceDocumentId);
                      const product = products.find((candidate: any) => candidate.id === application.productId);
                      return (
                        <TR key={application.id}>
                          <TD><ProductCell product={product} size={30} /></TD>
                          <TD muted className="font-mono text-xs">{lot?.id ?? application.fromLotId}</TD>
                          <TD>{sourceDocument ? <Link to={`/documents/${sourceDocument.id}`} className="text-[var(--color-primary)] hover:underline">{sourceDocument.number}</Link> : "—"}</TD>
                          <TD numeric>{qty(application.qty)}</TD>
                          <TD numeric>{rub(application.costRub)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="finance">
              {financeEvents.length === 0 ? (
                <EmptyState icon={<ArrowRightLeft size={20} />} title="Финансов канала пока нет" description="Комиссии, логистика и удержания подтягиваются отдельным потоком и не уменьшают выручку в этой продаже." />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Info label="Переменные расходы МП" value={rub(profit.variableMarketplaceExpensesRub)} />
                    <Info label="Прибыль после переменных расходов" value={rub(profit.contributionProfitRub)} />
                    <Info label="Overhead канала" value={rub(profit.linkedChannelOverheadRub)} />
                    <Info label="Всего связанных событий" value={financeEvents.length} />
                  </div>
                  <Table>
                    <THead><TR><TH>Дата</TH><TH>Статья</TH><TH>Как учитываем</TH><TH>Операция Ozon</TH><TH numeric>Сумма</TH><TH>Статус</TH><TH>Документ</TH></TR></THead>
                    <TBody>
                      {financeEvents.map((event: any) => {
                        const sourceEvent = externalEventById.get(event.externalEventId) as any;
                        const sourcePayload = (sourceEvent?.normalizedPayload ?? sourceEvent?.rawPayload ?? null) as Record<string, unknown> | null;
                        const operationName = channelFinanceSourceOperationName({
                          operationTypeName: event.operationTypeName ?? sourcePayload?.operationTypeName,
                          comment: event.comment
                        });
                        const operationCode = channelFinanceSourceOperationCode({
                          operationType: event.operationType ?? sourcePayload?.operationType
                        });
                        return (
                        <TR key={event.id}>
                          <TD muted className="numeric text-xs">{date(event.occurredAt)}</TD>
                          <TD>
                            <div className="flex flex-wrap gap-2">
                              <Badge tone="neutral">{channelFinanceCategoryLabel(event.category)}</Badge>
                              <Badge tone={event.eventKind === "compensation" ? "success" : event.eventKind === "penalty" ? "danger" : "neutral"}>
                                {financeKindLabel(event.eventKind)}
                              </Badge>
                            </div>
                          </TD>
                          <TD muted>{channelFinanceTreatmentLabel(event.treatment)}</TD>
                          <TD className="max-w-[360px] whitespace-normal break-words">
                            <div className="flex flex-col gap-1">
                              <span>{operationName}</span>
                              <span className="font-mono text-xs text-[var(--color-muted-foreground)]">{operationCode}</span>
                            </div>
                          </TD>
                          <TD numeric className={event.eventKind === "compensation" ? "text-[var(--color-success)] font-semibold" : "font-semibold"}>
                            <div className="flex flex-col items-end gap-1">
                              <span>{rub(event.allocatedAmountRub ?? event.amountRub)}</span>
                              {(event.allocatedAmountRub ?? event.amountRub) !== event.amountRub && (
                                <span className="text-xs text-[var(--color-muted-foreground)]">из {rub(event.amountRub)}</span>
                              )}
                            </div>
                          </TD>
                          <TD><Badge tone={financeStatusTone(event.status)}>{financeStatusLabel(event.status)}</Badge></TD>
                          <TD><Link to={`/integrations/finance-events/${event.id}`} className="text-[var(--color-primary)] hover:underline">Открыть</Link></TD>
                        </TR>
                      )})}
                    </TBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="documents">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Info label="Основной документ" value={document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"} />
                <Info label="Запись журнала" value={journalEntry ? <Link to={`/reports/journal/${journalEntry.id}`} className="text-[var(--color-primary)] hover:underline">{journalEntry.id}</Link> : "—"} />
                <Info label="Внешнее событие" value={externalEvent ? externalEvent.externalId : "—"} />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <EntityDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить продажу"
        description="Удаление снимет локальную продажу, её начисление и связанные финансовые операции, чтобы потом пересоздать их синком канала."
        preview={saleDeletePreview.data}
        previewLoading={saleDeletePreview.isLoading}
        errorMessage={removeSale.isError ? mutationMessage(removeSale.error) : undefined}
        warning="Возвраты по этой продаже и уже собранные выплаты нужно удалить отдельно."
        onConfirm={() => removeSale.mutate()}
        confirmLabel="Удалить продажу"
        confirmPending={removeSale.isPending}
      />
    </div>
  );
}

export function ReturnsListPage() {
  const state = useSalesWorkspace();
  const returns = state.salesReturns ?? [];
  const sales = state.sales ?? [];
  const channels = state.salesChannels ?? [];
  const products = state.products ?? [];
  const documents = state.documents ?? [];
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState("");
  const [returnState, setReturnState] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const rows = returns
    .slice()
    .sort((left: any, right: any) => String(right.returnDate).localeCompare(String(left.returnDate)))
    .map((salesReturn: any) => {
      const documentLines = documents.length >= 0
        ? state.documentLines.filter((line: any) => line.documentId === salesReturn.documentId && line.lineType === "sales_return_line")
        : [];
      const qtyTotal = documentLines.reduce((sum: number, line: any) => sum + Number(line.qty ?? 0), 0);
      const stateCode = String((documentLines[0]?.payload as Record<string, unknown> | undefined)?.stockStateCode ?? salesReturn.stockStateCode ?? "sellable");
      const sale = sales.find((candidate: any) => candidate.id === salesReturn.saleId);
      const channel = channels.find((candidate: any) => candidate.id === salesReturn.channelId);
      const firstProductId = String((documentLines[0]?.payload as Record<string, unknown> | undefined)?.productId ?? "");
      const product = products.find((candidate: any) => candidate.id === firstProductId);
      return { salesReturn, documentLines, qtyTotal, stateCode, sale, channel, product };
    })
    .filter((row) => {
        if (channelId && row.salesReturn.channelId !== channelId) return false;
        if (status && row.salesReturn.status !== status) return false;
        if (dateFrom && row.salesReturn.returnDate < dateFrom) return false;
        if (dateTo && row.salesReturn.returnDate > dateTo) return false;
        if (returnState && row.stateCode !== returnState) return false;
        return true;
      });
  const pagedRows = useMemo(() => paginateRows<any>(rows, page, pageSize), [rows, page, pageSize]);

  const totalQty = rows.reduce((sum, row) => sum + row.qtyTotal, 0);
  const totalRefund = rows.reduce((sum, row) => sum + Number(row.salesReturn.refundRub ?? 0), 0);
  const totalRestored = rows.reduce((sum, row) => sum + Number(row.salesReturn.restoredCostRub ?? 0), 0);
  const damagedQty = rows.filter((row) => row.stateCode === "damaged").reduce((sum, row) => sum + row.qtyTotal, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Возвраты"
        subtitle="Возврат сторнирует выручку и восстанавливает себестоимость из исходной продажи, а не создает новую случайную стоимость."
        breadcrumbs={[{ label: "Продажи", to: "/sales" }, { label: "Возвраты" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to="/integrations/inbox?eventType=return"><Boxes size={14} /> Обработать события</Link></Button>
            <Button asChild><Link to={sales[0] ? `/sales/${sales[0].id}/returns/new` : "/sales"}><Plus size={14} /> Создать возврат</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" label="Количество" value={qty(totalQty)} />
        <Kpi tone="warning" label="Сумма возвратов" value={rub(totalRefund)} />
        <Kpi tone="success" label="Восстановленная себестоимость" value={rub(totalRestored)} />
        <Kpi tone="danger" label="Брак" value={qty(damagedQty)} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="w-44" aria-label="Возвраты от даты" />
          <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="w-44" aria-label="Возвраты до даты" />
          <Select value={channelId} onChange={(event) => { setChannelId(event.target.value); setPage(1); }} className="w-48">
            <option value="">Все каналы</option>
            {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </Select>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="w-40">
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="posted">Проведен</option>
            <option value="needs_attention">Нужно внимание</option>
          </Select>
          <Select value={returnState} onChange={(event) => { setReturnState(event.target.value); setPage(1); }} className="w-48">
            <option value="">Все состояния</option>
            {Object.entries(stockStateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={<RotateCcw size={20} />} title="Возвратов нет" description="Оформите возврат по продаже или обработайте внешние события канала." />
          ) : (
            <Table>
              <THead><TR><TH>Дата</TH><TH>Канал</TH><TH>Продажа</TH><TH>Товар</TH><TH numeric>Кол-во</TH><TH numeric>Возврат RUB</TH><TH>Состояние</TH><TH>Статус</TH></TR></THead>
              <TBody>
                {pagedRows.map((row) => (
                  <TR key={row.salesReturn.id} interactive>
                    <TD muted className="numeric text-xs">
                      <Link to={`/returns/${row.salesReturn.id}`} className="text-[var(--color-primary)] hover:underline">{date(row.salesReturn.returnDate)}</Link>
                    </TD>
                    <TD>{row.channel?.name ?? "—"}</TD>
                    <TD>{row.sale ? <Link to={`/sales/${row.sale.id}`} className="text-[var(--color-primary)] hover:underline">{row.sale.externalOrderId ?? row.sale.id}</Link> : "—"}</TD>
                    <TD>{row.product ? <ProductCell product={row.product} size={30} /> : "—"}</TD>
                    <TD numeric>{qty(row.qtyTotal)}</TD>
                    <TD numeric className="font-semibold">{rub(row.salesReturn.refundRub)}</TD>
                    <TD><Badge tone={row.stateCode === "damaged" ? "danger" : row.stateCode === "reserved" ? "warning" : "success"}>{stockStateLabel[row.stateCode] ?? row.stateCode}</Badge></TD>
                    <TD><StatusBadge status={row.salesReturn.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
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
      </Card>
    </div>
  );
}

export function ReturnCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useSalesWorkspace();
  const queryClient = useQueryClient();
  const salesReturn = (state.salesReturns ?? []).find((candidate: any) => candidate.id === id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const requireSalesReturn = () => {
    if (!salesReturn) throw new Error("sales_return_missing");
    return salesReturn;
  };
  const removeReturn = useMutation({
    mutationFn: () => apiDelete(`/api/returns/${requireSalesReturn().id}`),
    onSuccess: () => {
      invalidateSalesArea(queryClient);
      navigate("/returns");
    }
  });
  if (!salesReturn) return null;
  const sale = (state.sales ?? []).find((candidate: any) => candidate.id === salesReturn.saleId);
  const channel = (state.salesChannels ?? []).find((candidate: any) => candidate.id === salesReturn.channelId);
  const document = (state.documents ?? []).find((candidate: any) => candidate.id === salesReturn.documentId);
  const products = state.products ?? [];
  const lines = (state.documentLines ?? []).filter((line: any) => line.documentId === salesReturn.documentId && line.lineType === "sales_return_line");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Возвраты", to: "/returns" }, { label: salesReturn.id }]}
        title={`Возврат · ${channel?.name ?? "Канал"}`}
        subtitle={`${date(salesReturn.returnDate)} · ${sale?.externalOrderId ?? sale?.id ?? "без продажи"}`}
        badge={<StatusBadge status={salesReturn.status} />}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild><Link to={`/sales/${salesReturn.saleId}`}><ArrowLeft size={14} /> К продаже</Link></Button>
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
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Товар</TH><TH numeric>Кол-во</TH><TH numeric>Возврат RUB</TH><TH numeric>Восстановлено</TH><TH>Состояние</TH></TR></THead>
            <TBody>
              {lines.map((line: any) => {
                const payload = (line.payload ?? {}) as Record<string, unknown>;
                const product = products.find((candidate: any) => candidate.id === payload.productId);
                return (
                  <TR key={line.id}>
                    <TD><ProductCell product={product} size={30} /></TD>
                    <TD numeric>{qty(line.qty)}</TD>
                    <TD numeric>{rub(Number(payload.refundRub ?? line.amountRub ?? 0))}</TD>
                    <TD numeric>{rub(Number(payload.restoredCostRub ?? 0))}</TD>
                    <TD><Badge tone={String(payload.stockStateCode ?? salesReturn.stockStateCode) === "damaged" ? "danger" : "success"}>{stockStateLabel[String(payload.stockStateCode ?? salesReturn.stockStateCode)] ?? String(payload.stockStateCode ?? salesReturn.stockStateCode)}</Badge></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 py-4">
          <Info label="Документ" value={document?.number ?? "—"} />
          <Info label="Сумма возврата" value={rub(salesReturn.refundRub)} />
          <Info label="Восстановленная себестоимость" value={rub(salesReturn.restoredCostRub)} />
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Удалить возврат</DialogTitle>
            <DialogDescription>
              Удаление снимет локальный возврат и вернет исходное событие в очередь, чтобы потом заново материализовать его из канала.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
              Если возврат уже попал в выплату маркетплейса, удаление будет заблокировано.
            </div>
            {removeReturn.isError && <p className="text-sm text-[var(--color-danger)]">{mutationMessage(removeReturn.error)}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={() => removeReturn.mutate()} disabled={removeReturn.isPending}>
              <Trash2 size={14} /> Удалить возврат
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ReturnFormPage() {
  const { saleId, id } = useParams<{ saleId?: string; id?: string }>();
  const targetSaleId = saleId ?? id;
  const state = useSalesWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sale = (state.sales ?? []).find((candidate: any) => candidate.id === targetSaleId);
  const lines = (state.saleLines ?? []).filter((candidate: any) => candidate.saleId === targetSaleId);
  const channel = (state.salesChannels ?? []).find((candidate: any) => candidate.id === sale?.channelId);
  const products = state.products ?? [];
  const existingReturnLines = state.documentLines.filter((line: any) => line.lineType === "sales_return_line");

  const initialRows = lines.map((line: any) => {
    const alreadyReturnedQty = existingReturnLines
      .filter((candidate: any) => {
        const payload = candidate.payload as Record<string, unknown>;
        const salesReturn = state.salesReturns.find((item: any) => item.documentId === candidate.documentId);
        return payload?.saleLineId === line.id && salesReturn?.status === "posted";
      })
      .reduce((sum: number, candidate: any) => sum + Number(candidate.qty ?? 0), 0);
    return {
      saleLineId: line.id,
      productId: line.productId,
      soldQty: Number(line.qty ?? 0),
      alreadyReturnedQty,
      returnQty: "0",
      restoredCostRub: round2((line.costRub / Math.max(line.qty, 1)) * Math.max(0, line.qty - alreadyReturnedQty))
    };
  });

  const [returnDate, setReturnDate] = useState(sale?.saleDate ?? today());
  const [stockStateCode, setStockStateCode] = useState("sellable");
  const [refundOverride, setRefundOverride] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [rows, setRows] = useState(initialRows);

  const unitRevenue = (saleLineId: string) => {
    const line = lines.find((candidate: any) => candidate.id === saleLineId);
    return Number(line?.revenueRub ?? 0) / Math.max(Number(line?.qty ?? 1), 1);
  };
  // Round2 по каждой строке, затем сумма — зеркально серверному recordReturn, чтобы дефолтный сабмит проходил серверную проверку.
  const computedRefundRub = round2(rows.reduce((sum, row) => sum + round2(Number(row.returnQty || 0) * unitRevenue(row.saleLineId)), 0));
  const refundRub = refundOverride ?? String(computedRefundRub);
  const totalReturnQty = rows.reduce((sum, row) => sum + Number(row.returnQty || 0), 0);
  const submitBlockReason = totalReturnQty === 0
    ? "Укажите количество к возврату"
    : Number(refundRub) < 0
      ? "Сумма возврата не может быть отрицательной"
      : Number(refundRub) > computedRefundRub + 0.01
        ? "Сумма возврата не может превышать расчётную выручку по возвращаемым позициям"
        : null;

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => apiPost<any>(`/api/sales/${targetSaleId}/returns`, {
      returnDate,
      stockStateCode,
      comment,
      refundRub: Number(refundRub),
      post,
      lines: rows
        .filter((row) => Number(row.returnQty) > 0)
        .map((row) => ({ saleLineId: row.saleLineId, qty: Number(row.returnQty) }))
    }),
    onSuccess: (salesReturn) => {
      invalidateSalesArea(queryClient);
      navigate(`/returns/${salesReturn.id}`);
    }
  });

  if (!sale) return null;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Продажи", to: "/sales" }, { label: sale.externalOrderId ?? sale.id, to: `/sales/${sale.id}` }, { label: "Возврат" }]}
        title="Возврат по продаже"
        subtitle="Возврат восстанавливает себестоимость из исходных FIFO-списаний и возвращает товар в выбранное состояние."
        actions={<Button variant="ghost" asChild><Link to={`/sales/${sale.id}`}><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 py-5">
          <Field label="Дата возврата" required><Input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></Field>
          <Field label="Канал / точка возврата"><Input value={channel?.name ?? "—"} disabled /></Field>
          <Field label="Состояние товара" required>
            <Select value={stockStateCode} onChange={(event) => setStockStateCode(event.target.value)}>
              {Object.entries(stockStateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field
            label="Сумма возврата RUB"
            hint={refundOverride !== null && Number(refundOverride) !== computedRefundRub ? (
              <>
                Расчётная: {rub(computedRefundRub)}{" "}
                <button type="button" className="underline" onClick={() => setRefundOverride(null)}>Сбросить</button>
              </>
            ) : undefined}
          >
            <Input type="number" value={refundRub} onChange={(event) => setRefundOverride(event.target.value)} />
          </Field>
          <Field label="Комментарий" className="xl:col-span-1 md:col-span-2">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Товар</TH><TH numeric>Продано</TH><TH numeric>Уже возвращено</TH><TH numeric>Вернуть сейчас</TH><TH numeric>Возврат RUB</TH><TH numeric>Исходная себестоимость</TH><TH>Состояние</TH></TR></THead>
              <TBody>
                {rows.map((row, index) => {
                  const product = products.find((candidate: any) => candidate.id === row.productId);
                  const availableQty = round4(Math.max(0, row.soldQty - row.alreadyReturnedQty));
                  const unitRevenueRub = lines.find((candidate: any) => candidate.id === row.saleLineId)?.revenueRub / Math.max(lines.find((candidate: any) => candidate.id === row.saleLineId)?.qty ?? 1, 1);
                  const unitCostRub = lines.find((candidate: any) => candidate.id === row.saleLineId)?.costRub / Math.max(lines.find((candidate: any) => candidate.id === row.saleLineId)?.qty ?? 1, 1);
                  const returnQtyValue = Number(row.returnQty || 0);
                  return (
                    <TR key={row.saleLineId}>
                      <TD><ProductCell product={product} /></TD>
                      <TD numeric>{qty(row.soldQty)}</TD>
                      <TD numeric>{qty(row.alreadyReturnedQty)}</TD>
                      <TD numeric>
                        <Input
                          type="number"
                          min="0"
                          max={availableQty}
                          step="0.0001"
                          value={row.returnQty}
                          onChange={(event) => updateReturnRow(setRows, index, { returnQty: event.target.value })}
                        />
                      </TD>
                      <TD numeric>{rub(round2(returnQtyValue * (unitRevenueRub ?? 0)))}</TD>
                      <TD numeric>{rub(round2(returnQtyValue * (unitCostRub ?? 0)))}</TD>
                      <TD><Badge tone={stockStateCode === "damaged" ? "danger" : "success"}>{stockStateLabel[stockStateCode] ?? stockStateCode}</Badge></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader className="min-w-0">
            <div className="min-w-0">
              <CardTitle>Предпросмотр учета</CardTitle>
              <CardDescription>Сумма возврата и сторно себестоимости</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Info label="К возврату" value={rub(Number(refundRub || 0))} />
            <Info label="Кол-во" value={qty(rows.reduce((sum, row) => sum + Number(row.returnQty || 0), 0))} />
            <Info label="Себестоимость к восстановлению" value={rub(rows.reduce((sum, row) => sum + round2(Number(row.returnQty || 0) * ((lines.find((candidate: any) => candidate.id === row.saleLineId)?.costRub ?? 0) / Math.max(lines.find((candidate: any) => candidate.id === row.saleLineId)?.qty ?? 1, 1))), 0))} />
            {stockStateCode !== "sellable" && (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-muted-foreground)]">
                <AlertTriangle size={14} className="inline mr-1" />
                Товар вернется в несвободное состояние и не попадет в доступный остаток для продажи.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setRows((current) => current.map((row) => ({ ...row, returnQty: String(round4(Math.max(0, row.soldQty - row.alreadyReturnedQty))) })))}>Вернуть все доступное</Button>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => create.mutate({ post: false })} disabled={create.isPending || submitBlockReason !== null}><Save size={14} /> Сохранить черновик</Button>
            <Button size="lg" onClick={() => create.mutate({ post: true })} disabled={create.isPending || submitBlockReason !== null}><Save size={14} /> Провести возврат</Button>
          </div>
          {submitBlockReason && <p className="text-xs text-[var(--color-muted-foreground)]">{submitBlockReason}</p>}
        </div>
      </div>
    </div>
  );
}

function updateSaleLine(
  setLines: React.Dispatch<React.SetStateAction<Array<{ productId: string; qty: string; priceRub: string }>>>,
  index: number,
  patch: Partial<{ productId: string; qty: string; priceRub: string }>
) {
  setLines((current) => current.map((line, currentIndex) => currentIndex === index ? { ...line, ...patch } : line));
}

function updateReturnRow(
  setRows: React.Dispatch<React.SetStateAction<Array<{ saleLineId: string; productId: string; soldQty: number; alreadyReturnedQty: number; returnQty: string; restoredCostRub: number }>>>,
  index: number,
  patch: Partial<{ returnQty: string }>
) {
  setRows((current) => current.map((row, currentIndex) => currentIndex === index ? { ...row, ...patch } : row));
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "posted") return "success";
  if (status === "shipped") return "info";
  if (status === "needs_attention") return "warning";
  if (status === "reversed") return "danger";
  if (status === "ready") return "info";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "draft") return "Черновик";
  if (status === "shipped") return "Ждёт начисления";
  if (status === "posted") return "Проведён";
  if (status === "needs_attention") return "Нужно внимание";
  if (status === "reversed") return "Сторнирован";
  if (status === "ready") return "Готов";
  return status;
}

function financeStatusTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "posted") return "success";
  if (status === "classified") return "info";
  if (status === "needs_attention") return "warning";
  if (status === "ignored" || status === "reversed") return "danger";
  return "neutral";
}

function financeStatusLabel(status: string) {
  if (status === "new") return "Новое";
  if (status === "classified") return "Классифицировано";
  if (status === "posted") return "Проведено";
  if (status === "needs_attention") return "Нужно внимание";
  if (status === "ignored") return "Игнор";
  if (status === "reversed") return "Сторно";
  return status;
}

function financeKindLabel(kind: string) {
  if (kind === "commission") return "Комиссия";
  if (kind === "logistics") return "Логистика";
  if (kind === "penalty") return "Штраф";
  if (kind === "compensation") return "Компенсация";
  return kind;
}

function saleRevenueRub(sale: any) {
  return Number(sale?.recognizedGrossAmountRub ?? sale?.grossAmountRub ?? 0);
}

function buildSaleProfitSummary({
  grossAmountRub,
  costRub,
  grossProfitRub,
  financeEvents
}: {
  grossAmountRub: number;
  costRub: number;
  grossProfitRub: number;
  financeEvents: any[];
}) {
  const variableFinanceEvents = financeEvents.filter((event: any) => isVariableMarketplaceTreatment(event.treatment));
  const linkedChannelOperatingEvents = financeEvents.filter((event: any) => isChannelOperatingTreatment(event.treatment));
  const linkedOtherExpenseEvents = financeEvents.filter((event: any) => event.treatment === "other_expense");
  const linkedOtherIncomeEvents = financeEvents.filter((event: any) => event.treatment === "other_income");
  const linkedChannelOverheadRub = round2(linkedChannelOperatingEvents.reduce((sum: number, event: any) => sum + Number(event.allocatedAmountRub ?? event.amountRub ?? 0), 0));
  const linkedOtherExpenseRub = round2(linkedOtherExpenseEvents.reduce((sum: number, event: any) => sum + Number(event.allocatedAmountRub ?? event.amountRub ?? 0), 0));
  const linkedOtherIncomeRub = round2(linkedOtherIncomeEvents.reduce((sum: number, event: any) => sum + Number(event.allocatedAmountRub ?? event.amountRub ?? 0), 0));
  const variableMarketplaceExpensesAllocatedRub = round2(variableFinanceEvents.reduce((sum: number, event: any) => sum + Number(event.allocatedAmountRub ?? event.amountRub ?? 0), 0));
  const normalizedGrossProfitRub = round2(Number.isFinite(Number(grossProfitRub)) ? Number(grossProfitRub ?? 0) : Number(grossAmountRub ?? 0) - Number(costRub ?? 0));
  const contributionProfitRub = round2(normalizedGrossProfitRub - variableMarketplaceExpensesAllocatedRub);
  const linkedNetProfitRub = round2(contributionProfitRub - linkedChannelOverheadRub - linkedOtherExpenseRub + linkedOtherIncomeRub);
  const totalLinkedExpensesRub = round2(variableMarketplaceExpensesAllocatedRub + linkedChannelOverheadRub + linkedOtherExpenseRub);
  const roiPercent = Number(costRub ?? 0) > 0 ? round2((linkedNetProfitRub / Number(costRub ?? 0)) * 100) : 0;
  return {
    variableMarketplaceExpensesRub: variableMarketplaceExpensesAllocatedRub,
    linkedChannelOverheadRub,
    linkedOtherExpenseRub,
    linkedOtherIncomeRub,
    normalizedGrossProfitRub,
    contributionProfitRub,
    linkedNetProfitRub,
    totalLinkedExpensesRub,
    roiPercent
  };
}

function returnsLabel(returns: any[], saleId: string) {
  const count = returns.filter((candidate: any) => candidate.saleId === saleId).length;
  if (count === 0) return "Нет";
  if (count === 1) return "1 возврат";
  return `${count} возврата`;
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const normalizedPage = Math.max(1, page);
  const start = (normalizedPage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium leading-snug">{value}</dd>
    </div>
  );
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
