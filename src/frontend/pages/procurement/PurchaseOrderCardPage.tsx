import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, FileBox, FileCheck, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProductCell } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiDelete, apiGet, apiPost } from "@/api";
import { rub, qty, date, dateTime } from "@/lib/format";
import {
  allocationBasisLabel,
  documentStatusLabel,
  documentStatusTone,
  procurementCostTypeLabel,
  purchaseOrderStatusLabel,
  shortageActionLabel
} from "@/lib/i18n";
import { getPurchaseOrderMetrics } from "./metrics";
import { EntityDeleteDialog, type EntityRollbackPreview } from "@/components/entity-delete-dialog";

export function PurchaseOrderCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const order = (state.purchaseOrders ?? []).find((candidate: any) => candidate.id === id);
  if (!order) return null;

  const lines = (state.purchaseOrderLines ?? []).filter((line: any) => line.purchaseOrderId === id);
  const products = state.products ?? [];
  const counterparties = state.counterparties ?? [];
  const warehouses = state.warehouses ?? [];
  const docs = state.documents ?? [];
  const docById = new Map(docs.map((doc: any) => [doc.id, doc]));
  const journalEntries = state.journalEntries ?? [];
  const supplier = counterparties.find((counterparty: any) => counterparty.id === order.supplierId);
  const warehouse = warehouses.find((item: any) => item.id === order.destinationWarehouseId);
  const orderDocument = docs.find((doc: any) => doc.id === order.documentId);
  const receipts = (state.goodsReceipts ?? []).filter((receipt: any) => receipt.purchaseOrderId === id);
  const receiptLines = (state.goodsReceiptLines ?? []).filter((line: any) => receipts.some((receipt: any) => receipt.id === line.goodsReceiptId));
  const allocations = (state.paymentAllocations ?? []).filter((allocation: any) => allocation.purchaseOrderId === id);
  const payments = (state.payments ?? []).filter((payment: any) => allocations.some((allocation: any) => allocation.paymentId === payment.id));
  const procurementCosts = (state.procurementCosts ?? []).filter((cost: any) => cost.purchaseOrderId === id);
  const shortages = (state.shortageResolutions ?? []).filter((shortage: any) => shortage.purchaseOrderId === id);
  const shortageLines = (state.shortageResolutionLines ?? []).filter((line: any) => shortages.some((shortage: any) => shortage.id === line.shortageResolutionId));
  const versions = (state.documentVersions ?? [])
    .filter((version: any) => version.documentId === order.documentId)
    .slice()
    .sort((left: any, right: any) => Number(right.versionNo ?? 0) - Number(left.versionNo ?? 0));
  const metrics = getPurchaseOrderMetrics(state, order.id);
  const hasDependencies = payments.length > 0 || receipts.length > 0;
  const isEditable = !hasDependencies && (order.status === "draft" || order.status === "ordered");
  const isCancellable = order.status !== "cancelled" && !hasDependencies;
  const canPost = order.status === "draft" && !hasDependencies;

  const receiptQtyByReceiptId = metrics.receiptQtyByReceiptId;
  const costingRows = useMemo(
    () => purchaseOrderCostingRows(state, order.id),
    [order.id, state]
  );
  const costingTotals = useMemo(() => purchaseOrderCostingTotals(costingRows), [costingRows]);
  const costingColumns = useMemo(() => purchaseOrderCostingColumns(costingTotals), [costingTotals]);
  const receiptProgressHint = metrics.closedShortageQty > 0
    ? `Принято ${qty(metrics.receivedQty)} шт · недопоставка закрыта ${qty(metrics.closedShortageQty)} шт`
    : `Принято ${qty(metrics.receivedQty)} шт`;
  const capitalizedHintParts = [
    `Товар ${rub(metrics.totalReceivedGoodsRub)}`,
    procurementCosts.length > 0 ? `расходы ${rub(metrics.totalProcurementCostsRub)}` : undefined,
    metrics.inventoryGapRub > 0 ? `вне себестоимости ${rub(metrics.inventoryGapRub)}` : undefined,
    metrics.inventoryGapRub < 0 ? `не оплачено ${rub(Math.abs(metrics.inventoryGapRub))}` : undefined
  ].filter(Boolean);

  const openShortageQuery = useQuery({
    queryKey: ["purchase-order-shortage-preview", id],
    queryFn: () => apiGet<any>(`/api/procurement/purchase-orders/${id}/shortages/preview`),
    enabled: Boolean(id)
  });

  const relatedDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    if (orderDocument?.id) ids.add(orderDocument.id);
    payments.forEach((payment: any) => payment.documentId && ids.add(payment.documentId));
    receipts.forEach((receipt: any) => receipt.documentId && ids.add(receipt.documentId));
    procurementCosts.forEach((cost: any) => cost.documentId && ids.add(cost.documentId));
    shortages.forEach((shortage: any) => shortage.documentId && ids.add(shortage.documentId));
    return Array.from(ids);
  }, [orderDocument?.id, payments, procurementCosts, receipts, shortages]);
  const relatedDocuments = relatedDocumentIds
    .map((documentId) => docById.get(documentId))
    .filter(Boolean)
    .sort((left: any, right: any) => String(right.accountingDate).localeCompare(String(left.accountingDate)));

  const [deleteTarget, setDeleteTarget] = useState<null | { kind: "payment" | "goods_receipt" | "procurement_cost"; id: string; label: string }>(null);
  const [receiptCorrection, setReceiptCorrection] = useState<null | {
    receiptId: string;
    purchaseOrderLineId: string;
    newQtyReceived: string;
    reason: string;
  }>(null);
  const [costCorrection, setCostCorrection] = useState<null | {
    costId: string;
    newAmountRub: string;
    reason: string;
  }>(null);

  const selectedReceipt = receipts.find((receipt: any) => receipt.id === receiptCorrection?.receiptId);
  const selectedReceiptLines = receiptCorrection
    ? receiptLines.filter((line: any) => line.goodsReceiptId === receiptCorrection.receiptId)
    : [];
  const selectedReceiptLine = selectedReceiptLines.find((line: any) => line.purchaseOrderLineId === receiptCorrection?.purchaseOrderLineId);
  const selectedCost = procurementCosts.find((cost: any) => cost.id === costCorrection?.costId);

  const postOrder = useMutation({
    mutationFn: () => apiPost(`/api/procurement/purchase-orders/${id}/post`),
    onSuccess: () => {
      queryClient.invalidateQueries();
    }
  });
  const deletePreviewPath = (target: { kind: string; id: string }) =>
    target.kind === "payment" ? `/api/payments/${target.id}/delete-preview`
      : target.kind === "goods_receipt" ? `/api/procurement/receipts/${target.id}/delete-preview`
        : `/api/procurement/costs/${target.id}/delete-preview`;
  const deletePath = (target: { kind: string; id: string }) =>
    target.kind === "payment" ? `/api/payments/${target.id}`
      : target.kind === "goods_receipt" ? `/api/procurement/receipts/${target.id}`
        : `/api/procurement/costs/${target.id}`;
  const deletePreview = useQuery({
    queryKey: ["po-delete-preview", deleteTarget?.kind, deleteTarget?.id],
    queryFn: () => apiGet<EntityRollbackPreview>(deletePreviewPath(deleteTarget!)),
    enabled: Boolean(deleteTarget)
  });
  const deleteEntity = useMutation({
    mutationFn: () => apiDelete(deletePath(deleteTarget!)),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDeleteTarget(null);
    }
  });
  const applyReceiptCorrection = useMutation({
    mutationFn: () => {
      if (!receiptCorrection) throw new Error("Выберите приемку для исправления");
      return apiPost(`/api/receipts/${receiptCorrection.receiptId}/correct-quantity`, {
        purchaseOrderLineId: receiptCorrection.purchaseOrderLineId,
        newQtyReceived: Number(receiptCorrection.newQtyReceived),
        reason: receiptCorrection.reason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setReceiptCorrection(null);
    }
  });
  const applyCostCorrection = useMutation({
    mutationFn: () => {
      if (!costCorrection) throw new Error("Выберите расход для исправления");
      return apiPost(`/api/procurement-costs/${costCorrection.costId}/correct`, {
        newAmountRub: Number(costCorrection.newAmountRub),
        reason: costCorrection.reason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setCostCorrection(null);
    }
  });
  const postPayment = useMutation({
    mutationFn: (paymentId: string) => apiPost(`/api/payments/${paymentId}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const postReceipt = useMutation({
    mutationFn: (receiptId: string) => apiPost(`/api/procurement/receipts/${receiptId}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const postCost = useMutation({
    mutationFn: (costId: string) => apiPost(`/api/procurement/costs/${costId}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const postShortage = useMutation({
    mutationFn: (shortageId: string) => apiPost(`/api/procurement/shortages/${shortageId}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Поставки", to: "/procurement" }, { label: orderDocument?.number ?? "Заказ" }]}
        title={orderDocument?.number ?? "Заказ поставщику"}
        subtitle={`${supplier?.name ?? "Поставщик не найден"} · ${order.supplierCurrency}`}
        badge={<Badge tone={order.status === "ordered" ? "info" : order.status === "cancelled" ? "danger" : "neutral"}>{purchaseOrderStatusLabel[order.status]}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" asChild><Link to="/procurement"><ArrowLeft size={14} /> К списку</Link></Button>
            {isEditable ? (
              <Button variant="secondary" asChild><Link to={`/procurement/purchase-orders/${id}/edit`}><Pencil size={14} /> Редактировать</Link></Button>
            ) : (
              <Button variant="secondary" disabled><Pencil size={14} /> Редактировать</Button>
            )}
            {canPost && (
              <Button onClick={() => postOrder.mutate()} disabled={postOrder.isPending}>
                <FileCheck size={14} /> Провести заказ
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" icon={<FileBox size={18} />} label="Заказано" value={`${qty(order.totalQty)} шт`} hint={`${order.totalSupplierAmount} ${order.supplierCurrency}`} />
        <Kpi tone="info" icon={<Wallet size={18} />} label="Оплачено" value={rub(metrics.totalPaidRub)} hint="Товар и расходы поставки" />
        <Kpi
          tone="success"
          icon={<FileCheck size={18} />}
          label="Закрыто по количеству"
          value={`${qty(metrics.completedQty)} / ${qty(metrics.totalOrderedQty)} шт`}
          hint={receiptProgressHint}
        />
        <Kpi
          tone="neutral"
          icon={<AlertTriangle size={18} />}
          label="В себестоимости"
          value={rub(metrics.totalCapitalizedRub)}
          hint={capitalizedHintParts.join(" · ")}
        />
      </div>

      {hasDependencies && (
        <Card>
          <CardContent className="py-4 text-sm text-[var(--color-muted-foreground)]">
            Исходный заказ уже связан с оплатами или приёмками. Состав и суммы базового документа больше не переписываются: фактические изменения оформляются через приёмки, расходы закупки и разбор недопоставок.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Tabs defaultValue="lines">
          <TabsList>
            <TabsTrigger value="lines">Состав {lines.length > 0 && <Badge tone="neutral" size="sm">{lines.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="payments">Оплаты {payments.length > 0 && <Badge tone="neutral" size="sm">{payments.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="receipts">Приемки {receipts.length > 0 && <Badge tone="neutral" size="sm">{receipts.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="costs">Расходы {procurementCosts.length > 0 && <Badge tone="neutral" size="sm">{procurementCosts.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="costing">Себестоимость {costingRows.length > 0 && <Badge tone="neutral" size="sm">{costingRows.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="shortages">Расхождения {(openShortageQuery.data?.lines?.length ?? shortages.length) > 0 && <Badge tone="neutral" size="sm">{openShortageQuery.data?.lines?.length ?? shortages.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="documents">Документы {relatedDocuments.length > 0 && <Badge tone="neutral" size="sm">{relatedDocuments.length}</Badge>}</TabsTrigger>
          </TabsList>

          <TabsContent value="lines">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Состав заказа</CardTitle>
                  <CardDescription>Исходное ожидание от поставщика. После появления зависимых документов редактирование закрывается.</CardDescription>
                </div>
                {isEditable ? (
                  <Button size="sm" variant="secondary" asChild><Link to={`/procurement/purchase-orders/${id}/edit`}><Pencil size={14} /> Редактировать</Link></Button>
                ) : undefined}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR><TH>Товар</TH><TH numeric>Заказано</TH><TH numeric>Цена</TH><TH numeric>Сумма</TH><TH>Комментарий</TH></TR>
                  </THead>
                  <TBody>
                    {lines.map((line: any) => (
                      <TR key={line.id}>
                        <TD><ProductCell product={products.find((product: any) => product.id === line.productId)} /></TD>
                        <TD numeric className="font-semibold">{qty(line.qtyOrdered)}</TD>
                        <TD numeric>{line.supplierUnitPrice} {order.supplierCurrency}</TD>
                        <TD numeric className="font-semibold">{line.supplierAmount} {order.supplierCurrency}</TD>
                        <TD muted><span className="text-xs">{line.lineNote ?? "—"}</span></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Оплаты поставщику</CardTitle>
                  <CardDescription>Фактические денежные выплаты, которые формируют аванс и позже зачитываются в себестоимость приемок.</CardDescription>
                </div>
                {order.status !== "cancelled" ? (
                  <Button size="sm" asChild><Link to={`/procurement/purchase-orders/${id}/payments/new`}><Plus size={14} /> Создать оплату</Link></Button>
                ) : (
                  <Button size="sm" disabled><Plus size={14} /> Создать оплату</Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {payments.length === 0 ? (
                  <EmptyState
                    icon={<Wallet size={20} />}
                    title="Оплат пока нет"
                    description="Когда появится реальная выплата поставщику, она будет связана с этим заказом и начнет формировать аванс."
                  />
                ) : (
                  <Table>
                    <THead>
                      <TR><TH>Дата</TH><TH>Документ</TH><TH numeric>Сумма</TH><TH>Статус</TH><TH numeric>Проводок</TH><TH>Действие</TH></TR>
                    </THead>
                    <TBody>
                      {payments
                        .slice()
                        .sort((left: any, right: any) => String(right.paidAt).localeCompare(String(left.paidAt)))
                        .map((payment: any) => {
                          const document: any = docById.get(payment.documentId);
                          return (
                            <TR key={payment.id}>
                              <TD muted className="numeric">{date(payment.paidAt)}</TD>
                              <TD>
                                {document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"}
                              </TD>
                              <TD numeric className="font-semibold">{rub(payment.amountRub)}</TD>
                              <TD>{document ? <Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge> : "—"}</TD>
                              <TD numeric>{journalEntries.filter((entry: any) => entry.documentId === payment.documentId).length}</TD>
                              <TD>
                                <div className="flex items-center gap-2">
                                  {document?.status === "draft" && (
                                    <Button size="sm" variant="secondary" onClick={() => postPayment.mutate(payment.id)} disabled={postPayment.isPending}>
                                      Провести
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ kind: "payment", id: payment.id, label: `оплату ${document?.number ?? ""}`.trim() })}>
                                    <Trash2 size={14} /> Удалить
                                  </Button>
                                </div>
                              </TD>
                            </TR>
                          );
                        })}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Приемки по заказу</CardTitle>
                  <CardDescription>Фиксируют фактически принятое количество. Если нашли недостачу после проводки, исправление делается отдельным документом, а не правкой строки заказа.</CardDescription>
                </div>
                {order.status !== "cancelled" ? (
                  <Button size="sm" asChild><Link to={`/procurement/purchase-orders/${id}/receipts/new`}><Plus size={14} /> Создать приемку</Link></Button>
                ) : (
                  <Button size="sm" disabled><Plus size={14} /> Создать приемку</Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {receipts.length === 0 ? (
                  <EmptyState
                    icon={<FileCheck size={20} />}
                    title="Приемок пока нет"
                    description="Как только товар реально поступит на склад, создайте приемку и распределите оплаченный товарный аванс."
                  />
                ) : (
                  <Table>
                    <THead>
                      <TR><TH>Дата</TH><TH>Документ</TH><TH>Склад</TH><TH numeric>Кол-во</TH><TH numeric>Стоимость</TH><TH>Статус</TH><TH numeric>Партий</TH><TH numeric>Проводок</TH><TH>Действие</TH></TR>
                    </THead>
                    <TBody>
                      {receipts
                        .slice()
                        .sort((left: any, right: any) => String(right.receiptDate).localeCompare(String(left.receiptDate)))
                        .map((receipt: any) => {
                          const document: any = docById.get(receipt.documentId);
                          const receiptLots = (state.inventoryLots ?? []).filter((lot: any) => lot.sourceDocumentId === receipt.documentId);
                          const receiptWarehouse = warehouses.find((item: any) => item.id === receipt.warehouseId);
                          return (
                            <TR key={receipt.id}>
                              <TD muted className="numeric">{date(receipt.receiptDate)}</TD>
                              <TD>
                                {document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"}
                              </TD>
                              <TD>{receiptWarehouse?.name ?? "—"}</TD>
                              <TD numeric className="font-semibold">{qty(receiptQtyByReceiptId.get(receipt.id) ?? 0)} шт</TD>
                              <TD numeric>{rub(receipt.goodsCostRubTotal)}</TD>
                              <TD>{document ? <Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge> : "—"}</TD>
                              <TD numeric>{receiptLots.length}</TD>
                              <TD numeric>{journalEntries.filter((entry: any) => entry.documentId === receipt.documentId).length}</TD>
                              <TD>
                                <div className="flex flex-col items-start gap-2">
                                  {document?.status === "draft" ? (
                                    <Button size="sm" variant="secondary" onClick={() => postReceipt.mutate(receipt.id)} disabled={postReceipt.isPending}>
                                      Провести
                                    </Button>
                                  ) : (
                                    <>
                                      <Button
                                        size="sm"
                                        onClick={() => navigate(`/procurement/receipts/${receipt.id}/dispatch`)}
                                      >
                                        Отправить в канал
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => openReceiptCorrection(receipt.id)}
                                        disabled={selectedReceiptLines.length === 0 && receiptLines.filter((line: any) => line.goodsReceiptId === receipt.id).length === 0}
                                      >
                                        Исправить приемку
                                      </Button>
                                    </>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ kind: "goods_receipt", id: receipt.id, label: `приёмку ${document?.number ?? ""}`.trim() })}>
                                    <Trash2 size={14} /> Удалить
                                  </Button>
                                </div>
                              </TD>
                            </TR>
                          );
                        })}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="costs">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Дополнительные расходы закупки</CardTitle>
                  <CardDescription>Доставка, упаковка и прочие затраты после приемки увеличивают себестоимость партий и уже проданных единиц.</CardDescription>
                </div>
                {order.status !== "cancelled" ? (
                  <Button size="sm" asChild><Link to={`/procurement/purchase-orders/${id}/costs/new`}><Plus size={14} /> Добавить расход</Link></Button>
                ) : (
                  <Button size="sm" disabled><Plus size={14} /> Добавить расход</Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {procurementCosts.length === 0 ? (
                  <EmptyState
                    icon={<AlertTriangle size={20} />}
                    title="Расходов поставки пока нет"
                    description="Добавьте доставку, упаковку или другие расходы, чтобы довести фактическую себестоимость партий до продажного состояния."
                  />
                ) : (
                  <Table>
                    <THead>
                      <TR><TH>Дата</TH><TH>Документ</TH><TH>Тип</TH><TH>База</TH><TH numeric>Сумма</TH><TH>Статус</TH><TH numeric>Проводок</TH><TH>Действие</TH></TR>
                    </THead>
                    <TBody>
                      {procurementCosts
                        .slice()
                        .sort((left: any, right: any) => String(right.costDate).localeCompare(String(left.costDate)))
                        .map((cost: any) => {
                          const document: any = docById.get(cost.documentId);
                          return (
                            <TR key={cost.id}>
                              <TD muted className="numeric">{date(cost.costDate)}</TD>
                              <TD>
                                {document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"}
                              </TD>
                              <TD>{procurementCostTypeLabel[cost.costType] ?? cost.costType}</TD>
                              <TD muted>{allocationBasisLabel[cost.allocationBasis] ?? cost.allocationBasis}</TD>
                              <TD numeric className="font-semibold">{rub(cost.amountRub)}</TD>
                              <TD>{document ? <Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge> : "—"}</TD>
                              <TD numeric>{journalEntries.filter((entry: any) => entry.documentId === cost.documentId).length}</TD>
                              <TD>
                                <div className="flex items-center gap-2">
                                  {document?.status === "draft" ? (
                                    <Button size="sm" variant="secondary" onClick={() => postCost.mutate(cost.id)} disabled={postCost.isPending}>
                                      Провести
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="secondary" onClick={() => openCostCorrection(cost.id)}>
                                      Исправить расход
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ kind: "procurement_cost", id: cost.id, label: `расход ${document?.number ?? ""}`.trim() })}>
                                    <Trash2 size={14} /> Удалить
                                  </Button>
                                </div>
                              </TD>
                            </TR>
                          );
                        })}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="costing">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Себестоимость товаров</CardTitle>
                  <CardDescription>Из проведённых приемок и расходов поставки. В строках товаров — за штуку, в итоге — вся поставка.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {costingRows.length === 0 ? (
                  <EmptyState
                    icon={<FileBox size={20} />}
                    title="Себестоимость пока не сформирована"
                    description="Проведите приемку, чтобы здесь появился разбор по товарам."
                  />
                ) : (
                  <Table className="table-fixed">
                    <THead>
                      <TR>
                        <TH className="w-[30%]">Позиция</TH>
                        <TH numeric className="w-[10%]">Штук</TH>
                        {costingColumns.map((column) => (
                          <TH key={column.key} numeric>{column.label}</TH>
                        ))}
                        <TH numeric>Итого за шт.</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {costingRows.map((row) => (
                        <TR key={row.productId}>
                          <TD><ProductCell product={row.product} /></TD>
                          <TD numeric className="font-semibold">{qty(row.receivedQty)}</TD>
                          {costingColumns.map((column) => (
                            <TD key={column.key} numeric>{formatRubPerUnit(costingColumnUnitRub(row, column))}</TD>
                          ))}
                          <TD numeric className="font-semibold">{formatRubPerUnit(row.unitCostRub)}</TD>
                        </TR>
                      ))}
                      <TR className="bg-[var(--color-muted)]/30">
                        <TD>
                          <div className="font-semibold">Итого по поставке</div>
                        </TD>
                        <TD numeric className="font-semibold">{qty(costingTotals.receivedQty)}</TD>
                        {costingColumns.map((column) => (
                          <TD key={column.key} numeric className="font-semibold">{rub(costingColumnTotalRub(costingTotals, column))}</TD>
                        ))}
                        <TD numeric className="font-semibold">{rub(costingTotals.totalRub)}</TD>
                      </TR>
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shortages">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Расхождения и недопоставки</CardTitle>
                  <CardDescription>Остаток между заказанным и фактически принятым количеством закрывается отдельным решением: ждать поставщика, выставить претензию или списать в потери.</CardDescription>
                </div>
                {order.status !== "cancelled" ? (
                  <Button size="sm" asChild><Link to={`/procurement/purchase-orders/${id}/shortages/new`}><AlertTriangle size={14} /> Разобрать расхождения</Link></Button>
                ) : (
                  <Button size="sm" disabled><AlertTriangle size={14} /> Разобрать расхождения</Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <InlineMetric label="Заказано" value={`${qty(metrics.totalOrderedQty)} шт`} />
                  <InlineMetric label="Принято" value={`${qty(metrics.receivedQty)} шт`} />
                  <InlineMetric label="Открытая недопоставка" value={`${qty((openShortageQuery.data?.lines ?? []).reduce((sum: number, line: any) => sum + Number(line.qtyShortage ?? 0), 0))} шт`} />
                  <InlineMetric label="Закрыто решениями" value={`${qty(metrics.closedShortageQty)} шт`} />
                </div>

                {(openShortageQuery.data?.lines ?? []).length > 0 ? (
                  <div className="-mx-5">
                    <Table>
                      <THead>
                        <TR><TH>Товар</TH><TH numeric>Заказано</TH><TH numeric>Принято</TH><TH numeric>Недостача</TH><TH numeric>Оплаченная доля</TH></TR>
                      </THead>
                      <TBody>
                        {(openShortageQuery.data?.lines ?? []).map((line: any) => (
                          <TR key={line.purchaseOrderLineId}>
                            <TD><ProductCell product={products.find((product: any) => product.id === line.productId)} /></TD>
                            <TD numeric muted>{qty(line.qtyOrdered)}</TD>
                            <TD numeric muted>{qty(line.qtyReceived)}</TD>
                            <TD numeric className="font-semibold">{qty(line.qtyShortage)}</TD>
                            <TD numeric>{rub(line.paidShareRub)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileCheck size={20} />}
                    title="Открытых расхождений нет"
                    description="Заказ либо принят полностью, либо все недопоставки уже разобраны отдельными решениями."
                    className="border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]"
                  />
                )}

                {shortages.length > 0 && (
                  <div className="border-t border-[var(--color-border)] pt-5">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold">История решений</h3>
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Каждое решение фиксируется отдельным документом и не переписывает уже проведенные приемки.</p>
                    </div>
                    <Table>
                      <THead>
                        <TR><TH>Дата</TH><TH>Документ</TH><TH>Причина</TH><TH>Статус</TH><TH>Действие</TH><TH numeric>Кол-во</TH><TH numeric>Сумма</TH></TR>
                      </THead>
                      <TBody>
                        {shortages
                          .slice()
                          .sort((left: any, right: any) => String(right.resolvedAt).localeCompare(String(left.resolvedAt)))
                          .map((shortage: any) => {
                            const document: any = docById.get(shortage.documentId);
                            const linesForShortage = shortageLines.filter((line: any) => line.shortageResolutionId === shortage.id);
                            return (
                              <TR key={shortage.id}>
                                <TD muted className="numeric">{date(shortage.resolvedAt)}</TD>
                                <TD>{document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link> : "—"}</TD>
                                <TD>{shortage.reason}</TD>
                                <TD>{document ? <Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge> : "—"}</TD>
                                <TD>
                                  {document?.status === "draft" ? (
                                    <Button size="sm" variant="secondary" onClick={() => postShortage.mutate(shortage.id)} disabled={postShortage.isPending}>
                                      Провести
                                    </Button>
                                  ) : (
                                    <div className="text-xs text-[var(--color-muted-foreground)]">
                                      {Array.from(new Set(linesForShortage.map((line: any) => shortageActionLabel[line.action] ?? line.action))).join(", ")}
                                    </div>
                                  )}
                                </TD>
                                <TD numeric className="font-semibold">{qty(linesForShortage.reduce((sum: number, line: any) => sum + Number(line.qtyShortage ?? 0), 0))}</TD>
                                <TD numeric>{rub(linesForShortage.reduce((sum: number, line: any) => sum + Number(line.paidShareRub ?? 0), 0))}</TD>
                              </TR>
                            );
                          })}
                      </TBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Связанные документы</CardTitle>
                  <CardDescription>Вкладка собирает исходный заказ и все документы, которые появились на его основе.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR><TH>Дата</TH><TH>Документ</TH><TH>Тип</TH><TH>Статус</TH><TH>Связь</TH><TH numeric>Проводок</TH></TR>
                  </THead>
                  <TBody>
                    {relatedDocuments.map((document: any) => (
                      <TR key={document.id}>
                        <TD muted className="numeric">{date(document.accountingDate)}</TD>
                        <TD><Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline">{document.number}</Link></TD>
                        <TD>{documentTypeLabel(document.documentType)}</TD>
                        <TD><Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge></TD>
                        <TD muted>{documentRelationLabel(document.id, order, payments, receipts, procurementCosts, shortages)}</TD>
                        <TD numeric>{journalEntries.filter((entry: any) => entry.documentId === document.id).length}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>

                {versions.length > 0 && (
                  <div className="border-t border-[var(--color-border)] px-5 py-4">
                    <h3 className="text-sm font-semibold">История версий заказа</h3>
                    <div className="mt-3 flex flex-col gap-2">
                      {versions.map((version: any) => (
                        <div key={version.id} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm">
                          <div>
                            <div className="font-medium">Версия {version.versionNo}</div>
                            <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{version.reason}</div>
                          </div>
                          <div className="text-xs text-[var(--color-muted-foreground)] numeric">{dateTime(version.createdAt)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-3 text-sm">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Контекст заказа</CardTitle>
                <CardDescription>Ключевые признаки для принятия следующего действия без открытия отдельных документов.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 py-4">
              <Stat label="Поставщик" value={supplier?.name ?? "—"} />
              <Stat label="Склад назначения" value={warehouse?.name ?? "—"} />
              <Stat label="Дата заказа" value={date(order.orderedAt)} />
              <Stat label="Статус" value={purchaseOrderStatusLabel[order.status] ?? order.status} />
              <Stat label="Оплат" value={payments.length} />
              <Stat label="Приемок" value={receipts.length} />
              <Stat label="Расходов" value={procurementCosts.length} />
              <Stat label="Версий документа" value={versions.length} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Следующий шаг</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {order.status === "draft" && <p>Сначала проведите заказ, чтобы зафиксировать исходное ожидание и дальше строить по нему оплаты и приемки.</p>}
              {order.status === "ordered" && payments.length === 0 && <p>По заказу еще нет оплат. Следующий логичный шаг — зафиксировать аванс поставщику.</p>}
              {payments.length > 0 && receipts.length === 0 && <p>Оплаты уже есть. Теперь можно создавать приемки и распределять оплаченный товарный аванс в себестоимость.</p>}
              {receipts.length > 0 && (openShortageQuery.data?.lines ?? []).length > 0 && <p>После приемок осталась недопоставка. Зафиксируйте решение отдельно, не переписывая строки исходного заказа.</p>}
              {receipts.length > 0 && procurementCosts.length === 0 && (openShortageQuery.data?.lines ?? []).length === 0 && <p>Товар принят. Если были доставка, упаковка или другие доводящие затраты, добавьте их отдельными расходами закупки.</p>}
              {receipts.length > 0 && procurementCosts.length > 0 && (openShortageQuery.data?.lines ?? []).length === 0 && <p>Заказ выглядит закрытым: количество разобрано, расходы капитализированы. Дальше работа продолжается уже через склад и продажи.</p>}
            </CardContent>
          </Card>
        </aside>
      </div>

      <EntityDeleteDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Удалить ${deleteTarget?.label ?? "запись"}?`}
        description="Удаление возможно, только если от записи ничего не зависит дальше. Иначе сначала удалите зависимые документы."
        preview={deletePreview.data}
        previewLoading={deletePreview.isLoading}
        errorMessage={deletePreview.error instanceof Error ? deletePreview.error.message : undefined}
        onConfirm={() => deleteEntity.mutate()}
        confirmLabel="Удалить"
        confirmPending={deleteEntity.isPending}
      />

      <Dialog open={Boolean(receiptCorrection)} onOpenChange={(open) => !open && setReceiptCorrection(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Исправить приемку</DialogTitle>
            <DialogDescription>Исправление создает отдельный документ коррекции и не переписывает исходную проведенную приемку.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {receiptCorrection && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Документ приемки">
                    <Input value={(docById.get(selectedReceipt?.documentId) as any)?.number ?? selectedReceipt?.id ?? ""} readOnly disabled />
                  </Field>
                  <Field label="Дата приемки">
                    <Input value={selectedReceipt?.receiptDate ?? ""} readOnly disabled />
                  </Field>
                  <Field label="Строка приемки" className="md:col-span-2">
                    <Select
                      value={receiptCorrection.purchaseOrderLineId}
                      onChange={(event) => {
                        const nextLine = selectedReceiptLines.find((line: any) => line.purchaseOrderLineId === event.target.value);
                        setReceiptCorrection((current) => current ? {
                          ...current,
                          purchaseOrderLineId: event.target.value,
                          newQtyReceived: String(nextLine?.qtyReceived ?? current.newQtyReceived)
                        } : current);
                      }}
                    >
                      {selectedReceiptLines.map((line: any) => {
                        const product = products.find((item: any) => item.id === line.productId);
                        return (
                          <option key={line.purchaseOrderLineId} value={line.purchaseOrderLineId}>
                            {product?.sku ?? line.productId} · {product?.name ?? "Строка"} · {qty(line.qtyReceived)} шт
                          </option>
                        );
                      })}
                    </Select>
                  </Field>
                  <Field label="Текущее количество">
                    <Input value={String(selectedReceiptLine?.qtyReceived ?? "")} readOnly disabled />
                  </Field>
                  <Field label="Новое количество" required>
                    <Input
                      aria-label="Новое количество"
                      type="number"
                      value={receiptCorrection.newQtyReceived}
                      onChange={(event) => setReceiptCorrection((current) => current ? { ...current, newQtyReceived: event.target.value } : current)}
                    />
                  </Field>
                </div>
                <Field label="Причина исправления" required>
                  <Textarea
                    value={receiptCorrection.reason}
                    onChange={(event) => setReceiptCorrection((current) => current ? { ...current, reason: event.target.value } : current)}
                  />
                </Field>
                {applyReceiptCorrection.isError && <p className="text-sm text-[var(--color-danger)]">{mutationMessage(applyReceiptCorrection.error)}</p>}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceiptCorrection(null)}>Закрыть</Button>
            <Button
              onClick={() => applyReceiptCorrection.mutate()}
              disabled={
                applyReceiptCorrection.isPending ||
                !receiptCorrection ||
                !receiptCorrection.reason.trim() ||
                !selectedReceiptLine ||
                Number(receiptCorrection.newQtyReceived) >= Number(selectedReceiptLine.qtyReceived) ||
                Number(receiptCorrection.newQtyReceived) < 0
              }
            >
              Применить исправление
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(costCorrection)} onOpenChange={(open) => !open && setCostCorrection(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Исправить расход закупки</DialogTitle>
            <DialogDescription>Исправление меняет сумму расхода через отдельную коррекцию и запускает пересчет себестоимости.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            {costCorrection && (
              <>
                <Field label="Текущая сумма">
                  <Input value={selectedCost ? String(selectedCost.amountRub) : ""} readOnly disabled />
                </Field>
                <Field label="Новая сумма" required>
                  <Input
                    aria-label="Новая сумма расхода"
                    type="number"
                    value={costCorrection.newAmountRub}
                    onChange={(event) => setCostCorrection((current) => current ? { ...current, newAmountRub: event.target.value } : current)}
                  />
                </Field>
                <Field label="Причина исправления" required>
                  <Textarea
                    value={costCorrection.reason}
                    onChange={(event) => setCostCorrection((current) => current ? { ...current, reason: event.target.value } : current)}
                  />
                </Field>
                {applyCostCorrection.isError && <p className="text-sm text-[var(--color-danger)]">{mutationMessage(applyCostCorrection.error)}</p>}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCostCorrection(null)}>Закрыть</Button>
            <Button
              onClick={() => applyCostCorrection.mutate()}
              disabled={applyCostCorrection.isPending || !costCorrection?.reason.trim() || Number(costCorrection?.newAmountRub ?? "") < 0}
            >
              Применить исправление
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function openReceiptCorrection(receiptId: string) {
    const firstLine = receiptLines.find((line: any) => line.goodsReceiptId === receiptId);
    if (!firstLine) return;
    setReceiptCorrection({
      receiptId,
      purchaseOrderLineId: firstLine.purchaseOrderLineId,
      newQtyReceived: String(firstLine.qtyReceived),
      reason: "Уточнили фактически принятое количество"
    });
  }

  function openCostCorrection(costId: string) {
    const cost = procurementCosts.find((candidate: any) => candidate.id === costId);
    if (!cost) return;
    setCostCorrection({
      costId,
      newAmountRub: String(cost.amountRub),
      reason: "Уточнили фактическую сумму расхода"
    });
  }
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-semibold mt-1 numeric">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-semibold mt-0.5 numeric">{value}</div>
    </div>
  );
}

function documentRelationLabel(documentId: string, order: any, payments: any[], receipts: any[], procurementCosts: any[], shortages: any[]) {
  if (documentId === order.documentId) return "Исходный заказ";
  if (payments.some((payment) => payment.documentId === documentId)) return "Оплата";
  if (receipts.some((receipt) => receipt.documentId === documentId)) return "Приемка";
  if (procurementCosts.some((cost) => cost.documentId === documentId)) return "Расход закупки";
  if (shortages.some((shortage) => shortage.documentId === documentId)) return "Разбор недопоставки";
  return "Связанный документ";
}

function documentTypeLabel(documentType: string | undefined) {
  const labels: Record<string, string> = {
    purchase_order: "Заказ поставщику",
    payment: "Платеж",
    goods_receipt: "Приемка",
    procurement_cost: "Расход закупки",
    shortage_resolution: "Недопоставка",
    correction: "Коррекция"
  };
  if (!documentType) return "—";
  return labels[documentType] ?? documentType;
}

type CostComponent = {
  type: string;
  label: string;
  amountRub: number;
};

type CostingColumn = {
  key: string;
  type: "goods" | "procurement_cost";
  label: string;
};

type PurchaseOrderCostingRow = {
  productId: string;
  product: any;
  receivedQty: number;
  goodsRub: number;
  procurementCostRub: number;
  totalRub: number;
  goodsUnitCostRub: number | null;
  unitCostRub: number | null;
  costByType: Map<string, number>;
  costComponents: CostComponent[];
};

function purchaseOrderCostingRows(state: any, purchaseOrderId: string): PurchaseOrderCostingRow[] {
  const documents = state.documents ?? [];
  const postedDocumentIds = new Set(
    documents.filter((document: any) => document.status === "posted").map((document: any) => document.id)
  );
  const products = state.products ?? [];
  const productById = new Map(products.map((product: any) => [product.id, product]));
  const receipts = (state.goodsReceipts ?? [])
    .filter((receipt: any) => receipt.purchaseOrderId === purchaseOrderId && postedDocumentIds.has(receipt.documentId));
  const receiptIds = new Set(receipts.map((receipt: any) => receipt.id));
  const receiptLines = (state.goodsReceiptLines ?? []).filter((line: any) => receiptIds.has(line.goodsReceiptId));
  const receiptLineIds = new Set(receiptLines.map((line: any) => line.id));
  const lotIds = new Set(
    (state.inventoryLots ?? [])
      .filter((lot: any) => receiptLineIds.has(lot.sourceLineId))
      .map((lot: any) => lot.id)
  );
  const procurementCosts = (state.procurementCosts ?? [])
    .filter((cost: any) => cost.purchaseOrderId === purchaseOrderId && postedDocumentIds.has(cost.documentId));
  const procurementCostById = new Map(procurementCosts.map((cost: any) => [cost.id, cost]));
  const rows = new Map<string, PurchaseOrderCostingRow>();

  const ensureRow = (productId: string): PurchaseOrderCostingRow => {
    const existing = rows.get(productId);
    if (existing) return existing;
    const product = productById.get(productId);
    const row: PurchaseOrderCostingRow = {
      productId,
      product,
      receivedQty: 0,
      goodsRub: 0,
      procurementCostRub: 0,
      totalRub: 0,
      goodsUnitCostRub: null,
      unitCostRub: null,
      costByType: new Map(),
      costComponents: []
    };
    rows.set(productId, row);
    return row;
  };

  receiptLines.forEach((line: any) => {
    const row = ensureRow(line.productId);
    row.receivedQty = round4(row.receivedQty + Number(line.qtyReceived ?? 0));
    row.goodsRub = round2(row.goodsRub + Number(line.allocatedGoodsCostRub ?? 0));
  });

  (state.procurementCostLines ?? [])
    .filter((line: any) => procurementCostById.has(line.procurementCostId))
    .filter((line: any) => !line.lotId || lotIds.has(line.lotId))
    .forEach((line: any) => {
      const cost: any = procurementCostById.get(line.procurementCostId);
      const costType = String(cost?.costType ?? "other");
      const amountRub = Number(line.allocatedAmountRub ?? 0);
      const row = ensureRow(line.productId);
      row.procurementCostRub = round2(row.procurementCostRub + amountRub);
      row.costByType.set(costType, round2((row.costByType.get(costType) ?? 0) + amountRub));
    });

  return Array.from(rows.values())
    .map((row) => finalizeCostingRow(row))
    .sort((left, right) => String(left.product?.name ?? left.productId).localeCompare(String(right.product?.name ?? right.productId), "ru"));
}

function purchaseOrderCostingTotals(rows: PurchaseOrderCostingRow[]) {
  const totals: PurchaseOrderCostingRow = {
    productId: "total",
    product: undefined,
    receivedQty: 0,
    goodsRub: 0,
    procurementCostRub: 0,
    totalRub: 0,
    goodsUnitCostRub: null,
    unitCostRub: null,
    costByType: new Map(),
    costComponents: []
  };

  rows.forEach((row) => {
    totals.receivedQty = round4(totals.receivedQty + row.receivedQty);
    totals.goodsRub = round2(totals.goodsRub + row.goodsRub);
    totals.procurementCostRub = round2(totals.procurementCostRub + row.procurementCostRub);
    row.costByType.forEach((amountRub, type) => {
      totals.costByType.set(type, round2((totals.costByType.get(type) ?? 0) + amountRub));
    });
  });

  return finalizeCostingRow(totals);
}

function purchaseOrderCostingColumns(totals: PurchaseOrderCostingRow): CostingColumn[] {
  return [
    { key: "goods", type: "goods", label: "Товар" },
    ...totals.costComponents.map((component) => ({
      key: `cost:${component.type}`,
      type: "procurement_cost" as const,
      label: component.label
    }))
  ];
}

function costingColumnUnitRub(row: PurchaseOrderCostingRow, column: CostingColumn) {
  if (row.receivedQty <= 0) return null;
  if (column.type === "goods") return row.goodsUnitCostRub;
  const costType = column.key.replace("cost:", "");
  return round6((row.costByType.get(costType) ?? 0) / row.receivedQty);
}

function costingColumnTotalRub(row: PurchaseOrderCostingRow, column: CostingColumn) {
  if (column.type === "goods") return row.goodsRub;
  const costType = column.key.replace("cost:", "");
  return row.costByType.get(costType) ?? 0;
}

function finalizeCostingRow(row: PurchaseOrderCostingRow): PurchaseOrderCostingRow {
  row.totalRub = round2(row.goodsRub + row.procurementCostRub);
  row.goodsUnitCostRub = row.receivedQty > 0 ? round6(row.goodsRub / row.receivedQty) : null;
  row.unitCostRub = row.receivedQty > 0 ? round6(row.totalRub / row.receivedQty) : null;
  row.costComponents = Array.from(row.costByType.entries())
    .map(([type, amountRub]) => ({
      type,
      label: procurementCostTypeLabel[type] ?? type,
      amountRub
    }))
    .filter((component) => Math.abs(component.amountRub) >= 0.01)
    .sort((left, right) => Math.abs(right.amountRub) - Math.abs(left.amountRub));
  return row;
}

function formatRubPerUnit(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${rub(value, { precise: true })}/шт`;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function round6(value: number) {
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}

function mutationMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось применить изменение";
}
