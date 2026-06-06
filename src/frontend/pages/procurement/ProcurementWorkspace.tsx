import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Wallet, FileCheck, Plus, Search, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { useCollection } from "@/lib/use-collection";
import { rub, qty, date } from "@/lib/format";
import { purchaseOrderStatusLabel } from "@/lib/i18n";
import { getPurchaseOrderMetrics } from "./metrics";
import { paginateRows } from "@/lib/pagination";

export function ProcurementWorkspace() {
  const orders = useCollection<any[]>("purchaseOrders") ?? [];
  const lines = useCollection<any[]>("purchaseOrderLines") ?? [];
  const counterparties = useCollection<any[]>("counterparties") ?? [];
  const docs = useCollection<any[]>("documents") ?? [];
  const procurementCosts = useCollection<any[]>("procurementCosts") ?? [];
  const goodsReceipts = useCollection<any[]>("goodsReceipts") ?? [];
  const goodsReceiptLines = useCollection<any[]>("goodsReceiptLines") ?? [];
  const payments = useCollection<any[]>("payments") ?? [];
  const paymentAllocations = useCollection<any[]>("paymentAllocations") ?? [];
  const shortageResolutions = useCollection<any[]>("shortageResolutions") ?? [];
  const shortageResolutionLines = useCollection<any[]>("shortageResolutionLines") ?? [];
  const metricsState = { documents: docs, goodsReceipts, goodsReceiptLines, payments, paymentAllocations, procurementCosts, purchaseOrderLines: lines, shortageResolutions, shortageResolutionLines };

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [currency, setCurrency] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const enriched = orders.map((o: any) => {
    const orderLines = lines.filter((l: any) => l.purchaseOrderId === o.id);
    const supplier = counterparties.find((c: any) => c.id === o.supplierId);
    const doc = docs.find((d: any) => d.id === o.documentId);
    const metrics = getPurchaseOrderMetrics(metricsState as any, o.id);
    return { order: o, doc, supplier, lines: orderLines, metrics };
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return enriched.filter((row: any) => {
      if (status && row.order.status !== status) return false;
      if (currency && row.order.supplierCurrency !== currency) return false;
      if (q && !`${row.doc?.number ?? ""} ${row.supplier?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enriched, search, status, currency]);

  useEffect(() => {
    setPage(1);
  }, [search, status, currency]);

  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);

  const totalQtyOrdered = orders.reduce((s: number, o: any) => s + (o.totalQty ?? 0), 0);
  const totalPaid = enriched.reduce((sum: number, row: any) => sum + row.metrics.totalPaidRub, 0);
  const totalCompletedQty = enriched.reduce((sum: number, row: any) => sum + row.metrics.completedQty, 0);
  const totalReceivedQty = enriched.reduce((sum: number, row: any) => sum + row.metrics.receivedQty, 0);
  const totalClosedShortageQty = enriched.reduce((sum: number, row: any) => sum + row.metrics.closedShortageQty, 0);
  const procCosts = procurementCosts.reduce((s: number, c: any) => s + c.amountRub, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Поставки"
        subtitle="Заказ поставщику, оплаты, приёмки, дополнительные расходы и недопоставки"
        actions={
          <Button asChild>
            <Link to="/procurement/purchase-orders/new"><Plus size={14} /> Новый заказ</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" icon={<ClipboardList size={18} />} label="Заказов" value={orders.length} hint={`${qty(totalQtyOrdered)} единиц`} />
        <Kpi tone="info" icon={<Wallet size={18} />} label="Оплачено" value={rub(totalPaid)} hint="Товар и расходы поставки" />
        <Kpi
          tone="success"
          icon={<FileCheck size={18} />}
          label="Закрыто по количеству"
          value={`${qty(totalCompletedQty)} / ${qty(totalQtyOrdered)} шт`}
          hint={totalClosedShortageQty > 0 ? `Фактически принято ${qty(totalReceivedQty)} шт · недопоставки закрыты ${qty(totalClosedShortageQty)} шт` : undefined}
        />
        <Kpi tone={procCosts > 0 ? "warning" : "neutral"} icon={<AlertTriangle size={18} />} label="Расходы поставки" value={rub(procCosts)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input className="pl-9" placeholder="Поиск по номеру или поставщику" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="">Все статусы</option>
              {Object.entries(purchaseOrderStatusLabel).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-32">
              <option value="">Все валюты</option>
              <option value="RUB">RUB</option>
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
            </Select>
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Номер</TH>
                <TH>Поставщик</TH>
                <TH>Дата</TH>
                <TH className="w-20">Валюта</TH>
                <TH numeric>Сумма</TH>
                <TH numeric>Заказано</TH>
                <TH numeric>Оплачено</TH>
                <TH numeric>Закрыто, шт</TH>
                <TH>Статус</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.length === 0 && (
                <TR><TD colSpan={9} className="text-center py-10 text-[var(--color-muted-foreground)]">Заказов пока нет</TD></TR>
              )}
              {paged.map((row: any) => (
                <TR key={row.order.id} interactive>
                  <TD>
                    <div className="flex flex-col gap-0.5">
                      <Link to={`/procurement/purchase-orders/${row.order.id}`} className="text-[var(--color-primary)] font-mono font-semibold text-sm hover:underline">
                        {row.doc?.number ?? row.order.id}
                      </Link>
                      {row.order.status === "draft" && (
                        <Link
                          to={`/procurement/purchase-orders/${row.order.id}/edit`}
                          className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                        >
                          Продолжить черновик
                        </Link>
                      )}
                    </div>
                  </TD>
                  <TD>{row.supplier?.name ?? "—"}</TD>
                  <TD muted className="numeric">{date(row.order.orderedAt)}</TD>
                  <TD muted><Badge tone="neutral" size="sm">{row.order.supplierCurrency}</Badge></TD>
                  <TD numeric className="font-semibold">{row.order.totalSupplierAmount}</TD>
                  <TD numeric>{qty(row.order.totalQty)} шт</TD>
                  <TD numeric>{rub(row.metrics.totalPaidRub)}</TD>
                  <TD numeric className="font-semibold">{qty(row.metrics.completedQty)} / {qty(row.metrics.totalOrderedQty)}</TD>
                  <TD>
                    <Badge tone={row.order.status === "ordered" ? "info" : row.order.status === "closed" ? "success" : "neutral"}>
                      {purchaseOrderStatusLabel[row.order.status] ?? row.order.status}
                    </Badge>
                  </TD>
                </TR>
              ))}
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
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
