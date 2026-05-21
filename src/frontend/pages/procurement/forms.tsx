import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ProductCell } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiGet, apiPatch, apiPost } from "@/api";
import { rub, qty } from "@/lib/format";
import { allocationBasisLabel, procurementCostTypeLabel, shortageActionLabel } from "@/lib/i18n";

const today = () => new Date().toISOString().slice(0, 10);

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const products = state.products ?? [];
  const counterparties = state.counterparties ?? [];
  const warehouses = (state.warehouses ?? []).filter((w: any) => w.warehouseType !== "sales_point");
  const defaultWarehouseId = warehouses.find((warehouse: any) => warehouse.warehouseType === "own")?.id ?? warehouses[0]?.id ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const order = (state.purchaseOrders ?? []).find((candidate: any) => candidate.id === id);
  const existingLines = (state.purchaseOrderLines ?? []).filter((line: any) => line.purchaseOrderId === id);
  const existingPayments = (state.paymentAllocations ?? []).filter((allocation: any) => allocation.purchaseOrderId === id);
  const existingReceipts = (state.goodsReceipts ?? []).filter((receipt: any) => receipt.purchaseOrderId === id);
  const isEditing = Boolean(id);
  const isEditable = !isEditing || (order && order.status !== "cancelled" && existingPayments.length === 0 && existingReceipts.length === 0);

  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState("Shenzhen Good Supply");
  const [orderedAt, setOrderedAt] = useState(state.accountingPolicy?.accountingStartDate ?? today());
  const [supplierCurrency, setSupplierCurrency] = useState("CNY");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(defaultWarehouseId);
  const [comment, setComment] = useState("Закупка партии аксессуаров");
  const [lines, setLines] = useState([
    { productId: products[0]?.id ?? "", qtyOrdered: 300, supplierUnitPrice: 9.5, lineNote: "" }
  ]);
  const [hydratedOrderId, setHydratedOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing || !order || hydratedOrderId === order.id) return;
    setSupplierId(order.supplierId ?? "");
    setSupplierName(counterparties.find((item: any) => item.id === order.supplierId)?.name ?? "");
    setOrderedAt(order.orderedAt ?? today());
    setSupplierCurrency(order.supplierCurrency ?? "CNY");
    setDestinationWarehouseId(order.destinationWarehouseId ?? defaultWarehouseId);
    setComment(order.comment ?? "");
    setLines(existingLines.map((line: any) => ({
      productId: line.productId,
      qtyOrdered: line.qtyOrdered,
      supplierUnitPrice: line.supplierUnitPrice,
      lineNote: line.lineNote ?? ""
    })));
    setHydratedOrderId(order.id);
  }, [counterparties, defaultWarehouseId, existingLines, hydratedOrderId, isEditing, order]);

  const totalQty = lines.reduce((s, l) => s + Number(l.qtyOrdered || 0), 0);
  const totalAmount = lines.reduce((s, l) => s + Number(l.qtyOrdered || 0) * Number(l.supplierUnitPrice || 0), 0);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        supplierId: supplierId || undefined,
        supplierName: supplierId ? undefined : supplierName,
        orderedAt,
        supplierCurrency,
        destinationWarehouseId,
        comment,
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: Number(l.qtyOrdered),
          supplierUnitPrice: Number(l.supplierUnitPrice),
          lineNote: l.lineNote || undefined
        }))
      };
      if (isEditing) {
        return apiPatch(`/api/procurement/purchase-orders/${id}`, payload);
      }
      return apiPost("/api/procurement/purchase-orders", payload);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries();
      navigate(`/procurement/purchase-orders/${data.id}`);
    }
  });

  if (isEditing && !order) return null;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: "Поставки", to: "/procurement" },
          ...(isEditing ? [{ label: order?.documentId ? "Заказ" : "Редактирование", to: `/procurement/purchase-orders/${id}` }, { label: "Редактирование" }] : [{ label: "Новый заказ" }])
        ]}
        title={isEditing ? "Редактировать заказ поставщику" : "Новый заказ поставщику"}
        subtitle={
          isEditing
            ? "Меняйте шапку и состав заказа, пока по нему нет оплат и приёмок."
            : "Заявка не создаёт проводок: это управленческий документ ожидания товара"
        }
        actions={<Button variant="ghost" asChild><Link to={isEditing ? `/procurement/purchase-orders/${id}` : "/procurement"}><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      {isEditing && !isEditable && (
        <Card>
          <CardContent className="py-4 text-sm text-[var(--color-muted-foreground)]">
            Этот заказ уже связан с оплатами или приёмками. Исходные строки больше не редактируются: фактические изменения нужно проводить через приёмки, расходы и недопоставки.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Шапка заказа</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Поставщик">
                <Select aria-label="Поставщик" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!isEditable}>
                  <option value="">Новый поставщик</option>
                  {counterparties.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              {!supplierId && (
                <Field label="Название нового поставщика" required>
                  <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={!isEditable} />
                </Field>
              )}
              <Field label="Дата заказа" required>
                <Input aria-label="Дата заказа" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} disabled={!isEditable} />
              </Field>
              <Field label="Валюта поставщика" required>
                <Select aria-label="Валюта поставщика" value={supplierCurrency} onChange={(e) => setSupplierCurrency(e.target.value)} disabled={!isEditable}>
                  <option value="RUB">RUB · ₽</option>
                  <option value="CNY">CNY · юань</option>
                  <option value="USD">USD · $</option>
                </Select>
              </Field>
              <Field label="Склад назначения" required>
                <Select value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)} disabled={!isEditable}>
                  {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Комментарий для поставки"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={!isEditable} /></Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Строки заказа</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLines([...lines, { productId: products[0]?.id ?? "", qtyOrdered: 1, supplierUnitPrice: 0, lineNote: "" }])}
                disabled={!isEditable}
              >
                <Plus size={13} /> Добавить
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR><TH>Товар</TH><TH numeric>Кол-во</TH><TH numeric>Цена</TH><TH numeric>Сумма</TH><TH>Комментарий</TH><TH className="w-12"></TH></TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => (
                    <TR key={i}>
                      <TD>
                        <Select aria-label={`Товар ${i + 1}`} value={l.productId} onChange={(e) => updateLine(i, "productId", e.target.value)} disabled={!isEditable}>
                          {products.map((p: any) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                        </Select>
                      </TD>
                      <TD>
                        <Input aria-label={`Количество ${i + 1}`} type="number" value={l.qtyOrdered} onChange={(e) => updateLine(i, "qtyOrdered", e.target.value)} className="text-right" disabled={!isEditable} />
                      </TD>
                      <TD>
                        <Input aria-label={`Цена поставщика ${i + 1}`} type="number" step="0.01" value={l.supplierUnitPrice} onChange={(e) => updateLine(i, "supplierUnitPrice", e.target.value)} className="text-right" disabled={!isEditable} />
                      </TD>
                      <TD numeric className="font-semibold">{(Number(l.qtyOrdered) * Number(l.supplierUnitPrice)).toFixed(2)}</TD>
                      <TD>
                        <Input aria-label={`Комментарий строки ${i + 1}`} value={l.lineNote} onChange={(e) => updateLine(i, "lineNote", e.target.value)} placeholder="Цвет, размер" disabled={!isEditable} />
                      </TD>
                      <TD>
                        <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={!isEditable || lines.length === 1}>
                          <Trash2 size={14} />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-3 sticky top-20 h-fit">
          <Card>
            <CardHeader><CardTitle>Итог</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span className="text-[var(--color-muted-foreground)]">Кол-во</span><span className="numeric font-semibold">{totalQty} шт</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted-foreground)]">Сумма</span><span className="numeric font-semibold">{totalAmount.toFixed(2)} {supplierCurrency}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-muted-foreground)]">Строк</span><span>{lines.length}</span></div>
              {isEditing && (
                <>
                  <div className="flex justify-between"><span className="text-[var(--color-muted-foreground)]">Оплат</span><span>{existingPayments.length}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-muted-foreground)]">Приёмок</span><span>{existingReceipts.length}</span></div>
                </>
              )}
              <div className="rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] border border-[oklch(0.85_0.1_70)] p-2 text-xs leading-relaxed mt-1">
                {isEditing
                  ? isEditable
                    ? "После сохранения вернётесь в карточку поставки. Если заказ уже оформлен, история версий сохранится."
                    : "После появления оплат или приёмок состав заказа фиксируется, а расхождения оформляются отдельными документами."
                  : "После сохранения можно провести оплату или приёмку. Отдельный шаг отправки из Китая не обязателен для учёта."}
              </div>
            </CardContent>
          </Card>
          {save.isError && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
              <AlertTriangle size={14} className="inline mr-1 align-[-2px]" />
              {mutationMessage(save.error)}
            </div>
          )}
          <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending || !isEditable}>
            <Save size={14} /> {isEditing ? "Сохранить изменения" : "Создать и отправить поставщику"}
          </Button>
        </aside>
      </div>
    </div>
  );

  function updateLine(i: number, field: string, value: any) {
    const next = lines.slice();
    next[i] = { ...next[i], [field]: value } as any;
    setLines(next);
  }
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}

export function SupplierPaymentFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const purchaseOrders = (state.purchaseOrders ?? []).filter((candidate: any) => candidate.status !== "cancelled");
  const docs = state.documents ?? [];
  const counterparties = state.counterparties ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [purchaseOrderId, setPurchaseOrderId] = useState(id ?? purchaseOrders[0]?.id ?? "");
  const order = purchaseOrders.find((o: any) => o.id === purchaseOrderId);

  const [paidAt, setPaidAt] = useState(order?.orderedAt ?? state.accountingPolicy?.accountingStartDate ?? today());
  const [amountRub, setAmountRub] = useState("130000");
  const [comment, setComment] = useState("Оплата товара поставщику");
  useEffect(() => {
    if (id && id !== purchaseOrderId) {
      setPurchaseOrderId(id);
      return;
    }
    if (!id && !purchaseOrderId && purchaseOrders[0]?.id) {
      setPurchaseOrderId(purchaseOrders[0].id);
    }
  }, [id, purchaseOrderId, purchaseOrders]);
  useEffect(() => {
    if (!order) return;
    setPaidAt((current) => current || order.orderedAt || state.accountingPolicy?.accountingStartDate || today());
  }, [order, state.accountingPolicy?.accountingStartDate]);

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => {
      if (!purchaseOrderId) throw new Error("Выберите заказ поставщику");
      return apiPost(`/api/procurement/purchase-orders/${purchaseOrderId}/payments`, {
        paidAt,
        amountRub: Number(amountRub),
        comment,
        post
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate(purchaseOrderId ? `/procurement/purchase-orders/${purchaseOrderId}` : "/money");
    }
  });

  const supplier = order ? counterparties.find((c: any) => c.id === order.supplierId) : null;
  const doc = order ? docs.find((d: any) => d.id === order.documentId) : null;

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={id
          ? [{ label: "Поставки", to: "/procurement" }, { label: doc?.number ?? "Заказ", to: `/procurement/purchase-orders/${id}` }, { label: "Оплата" }]
          : [{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Оплата поставщику" }]}
        title="Оплата поставщику"
        subtitle="Оплата товара ложится на аванс поставщику. В себестоимость попадает при приёмке."
        actions={id ? <Button variant="ghost" asChild><Link to={`/procurement/purchase-orders/${id}`}><ArrowLeft size={14} /> К заказу</Link></Button> : undefined}
      />
      <Card>
        <CardHeader><CardTitle>Платёж</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!id && (
            <Field label="Заказ поставщику" required>
              <Select value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
                {purchaseOrders.map((candidate: any) => {
                  const candidateDoc = docs.find((item: any) => item.id === candidate.documentId);
                  const candidateSupplier = counterparties.find((item: any) => item.id === candidate.supplierId);
                  return (
                    <option key={candidate.id} value={candidate.id}>
                      {(candidateDoc?.number ?? candidate.id)} · {candidateSupplier?.name ?? "Без поставщика"}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
          <Field label="Заказ">
            <Input value={`${doc?.number ?? ""} · ${supplier?.name ?? ""} · ${order?.totalQty ?? 0} шт`} readOnly disabled />
          </Field>
          <Field label="Дата оплаты" required>
            <Input aria-label="Дата оплаты" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Сумма в рублях" required hint="Включая комиссию банка">
            <Input type="number" value={amountRub} onChange={(e) => setAmountRub(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Комментарий">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Предпросмотр проводки</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Счёт</TH><TH numeric>Дебет</TH><TH numeric>Кредит</TH></TR></THead>
            <TBody>
              <TR><TD><span className="font-mono">60.02</span> · Авансы поставщикам</TD><TD numeric className="font-semibold">{rub(Number(amountRub))}</TD><TD numeric muted>—</TD></TR>
              <TR><TD><span className="font-mono">51</span> · Расчётный счёт</TD><TD numeric muted>—</TD><TD numeric className="font-semibold">{rub(Number(amountRub))}</TD></TR>
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="lg" variant="secondary" onClick={() => create.mutate({ post: false })} disabled={create.isPending || !purchaseOrderId}>
          <Save size={14} /> Сохранить черновик
        </Button>
        <Button size="lg" onClick={() => create.mutate({ post: true })} disabled={create.isPending || !purchaseOrderId}>
          <Save size={14} /> Провести оплату
        </Button>
      </div>
    </div>
  );
}

export function GoodsReceiptFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const order = (state.purchaseOrders ?? []).find((o: any) => o.id === id);
  const orderLines = (state.purchaseOrderLines ?? []).filter((l: any) => l.purchaseOrderId === id);
  const receiptLines = state.goodsReceiptLines ?? [];
  const receipts = state.goodsReceipts ?? [];
  const documents = state.documents ?? [];
  const receiptWarehouses = (state.warehouses ?? []).filter((warehouse: any) => warehouse.warehouseType === "own");
  const products = state.products ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const defaultReceiptWarehouseId = receiptWarehouses.find((warehouse: any) => warehouse.id === order?.destinationWarehouseId)?.id
    ?? receiptWarehouses[0]?.id
    ?? "";

  const [receiptDate, setReceiptDate] = useState(order?.orderedAt ?? state.accountingPolicy?.accountingStartDate ?? today());
  const [warehouseId, setWarehouseId] = useState(defaultReceiptWarehouseId);
  const [costRubTotal, setCostRubTotal] = useState("");
  const [manualReason, setManualReason] = useState("");
  useEffect(() => {
    setWarehouseId(defaultReceiptWarehouseId);
  }, [defaultReceiptWarehouseId]);
  const postedReceiptIds = new Set(
    receipts
      .filter((receipt: any) => receipt.status === "posted")
      .filter((receipt: any) => documents.find((document: any) => document.id === receipt.documentId)?.status === "posted")
      .map((receipt: any) => receipt.id)
  );
  const receivableLines = orderLines
    .map((line: any) => {
      const received = receiptLines
        .filter((receiptLine: any) => receiptLine.purchaseOrderLineId === line.id && postedReceiptIds.has(receiptLine.goodsReceiptId))
        .reduce((sum: number, receiptLine: any) => sum + Number(receiptLine.qtyReceived ?? 0), 0);
      return {
        ...line,
        qtyPreviouslyReceived: received,
        qtyRemainingToReceive: Math.max(0, Number(line.qtyOrdered ?? 0) - received)
      };
    })
    .filter((line: any) => line.qtyRemainingToReceive > 0);
  const [items, setItems] = useState(
    receivableLines.map((l: any) => ({ purchaseOrderLineId: l.id, qtyReceived: l.qtyRemainingToReceive }))
  );
  const previewInputLines = useMemo(
    () => receivableLines
      .map((line: any, index: number) => ({
        purchaseOrderLineId: line.id,
        qtyReceived: Number(items[index]?.qtyReceived ?? 0)
      }))
      .filter((line) => line.qtyReceived > 0),
    [items, receivableLines]
  );
  const manualGoodsCostRub = costRubTotal.trim().length > 0 ? Number(costRubTotal) : undefined;
  const receiptPreviewQuery = useQuery({
    queryKey: ["procurement-receipt-preview", id, JSON.stringify(previewInputLines), manualGoodsCostRub ?? null],
    queryFn: () => apiPost<any>(`/api/procurement/purchase-orders/${id}/receipt-preview`, {
      lines: previewInputLines,
      ...(manualGoodsCostRub !== undefined ? { goodsCostRubTotal: manualGoodsCostRub } : {})
    }),
    enabled: Boolean(id && previewInputLines.length > 0)
  });
  const previewLineByPurchaseOrderLineId = useMemo(
    () => new Map((receiptPreviewQuery.data?.lines ?? []).map((line: any) => [line.purchaseOrderLineId, line])),
    [receiptPreviewQuery.data]
  );
  const effectiveGoodsCostRub = manualGoodsCostRub ?? receiptPreviewQuery.data?.suggestedGoodsCostRub ?? 0;
  const availableAdvanceRub = receiptPreviewQuery.data
    ? round2(Number(receiptPreviewQuery.data.linkedGoodsPaymentRub ?? 0) - Number(receiptPreviewQuery.data.previousReceiptCostRub ?? 0))
    : 0;
  const setoffRub = round2(Math.min(Math.max(0, effectiveGoodsCostRub), Math.max(0, availableAdvanceRub)));
  const payableRub = round2(Math.max(0, effectiveGoodsCostRub - setoffRub));

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => {
      const manualCost = manualGoodsCostRub !== undefined;
      return apiPost(`/api/procurement/purchase-orders/${id}/receipts`, {
        receiptDate,
        warehouseId,
        lines: previewInputLines,
        post,
        ...(manualCost ? {
          source: "manual",
          goodsCostRubTotal: manualGoodsCostRub,
          manualCostReason: manualReason || undefined
        } : {})
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate(`/procurement/purchase-orders/${id}`);
    }
  });

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Поставки", to: "/procurement" }, { label: "Заказ", to: `/procurement/purchase-orders/${id}` }, { label: "Приёмка" }]}
        title="Приёмка товара"
        subtitle="Пользователь вводит фактически принятое количество. Рублёвая стоимость берётся из оплат и не редактируется без причины."
        actions={<Button variant="ghost" asChild><Link to={`/procurement/purchase-orders/${id}`}><ArrowLeft size={14} /> К заказу</Link></Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Параметры</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Дата приёмки" required>
                <Input aria-label="Дата приёмки" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </Field>
              <Field label="Склад приёмки" required hint="Приёмка оформляется на собственный склад">
                <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  {receiptWarehouses.map((warehouse: any) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Стоимость товаров к распределению" hint="Пусто — рассчитать из оплат поставщику">
                <Input type="number" value={costRubTotal} onChange={(e) => setCostRubTotal(e.target.value)} placeholder="Автоматически" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Причина ручного изменения стоимости" hint="Обязательна, если вы вручную меняете RUB-сумму">
                  <Textarea value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          {create.isError && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
              <AlertTriangle size={14} className="inline mr-1 align-[-2px]" />
              {mutationMessage(create.error)}
            </div>
          )}

          <Card>
            <CardHeader><CardTitle>Принимаемые позиции</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Товар</TH>
                    <TH numeric>Заказано</TH>
                    <TH numeric>Уже принято</TH>
                    <TH numeric>Осталось</TH>
                    <TH numeric>Принимаем</TH>
                    <TH numeric>Цена пост.</TH>
                    <TH numeric>База</TH>
                    <TH numeric>Распределено</TH>
                    <TH numeric>Себест./шт</TH>
                  </TR>
                </THead>
                <TBody>
                  {receivableLines.map((line: any, index: number) => {
                    const product = products.find((p: any) => p.id === line.productId);
                    const previewLine: any = previewLineByPurchaseOrderLineId.get(line.id);
                    return (
                      <TR key={line.id}>
                        <TD><ProductCell product={product} /></TD>
                        <TD numeric muted>{qty(line.qtyOrdered)}</TD>
                        <TD numeric muted>{qty(line.qtyPreviouslyReceived)}</TD>
                        <TD numeric muted>{qty(line.qtyRemainingToReceive)}</TD>
                        <TD>
                          <Input
                            aria-label={`Принимаем: ${product?.name ?? line.id}`}
                            type="number"
                            value={items[index]?.qtyReceived ?? line.qtyRemainingToReceive}
                            onChange={(e) => {
                              const next = items.slice();
                              next[index] = { purchaseOrderLineId: line.id, qtyReceived: Number(e.target.value) };
                              setItems(next);
                            }}
                            className="text-right"
                          />
                        </TD>
                        <TD numeric>{line.supplierUnitPrice} {order?.supplierCurrency}</TD>
                        <TD numeric muted>{previewLine ? `${line.supplierUnitPrice * Number(previewLine.qtyReceived ?? 0)} ${order?.supplierCurrency}` : "—"}</TD>
                        <TD numeric className="font-semibold">{previewLine ? rub(previewLine.allocatedGoodsCostRub) : "—"}</TD>
                        <TD numeric>{previewLine ? formatRubPerUnit(previewLine.unitCostRub) : "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Предпросмотр проводки</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead><TR><TH>Счёт</TH><TH numeric>Дебет</TH><TH numeric>Кредит</TH></TR></THead>
                <TBody>
                  <TR>
                    <TD><span className="font-mono">41.01</span> · Поступление товара на склад</TD>
                    <TD numeric className="font-semibold">{rub(effectiveGoodsCostRub)}</TD>
                    <TD numeric muted>—</TD>
                  </TR>
                  <TR>
                    <TD><span className="font-mono">60.01</span> · Задолженность поставщику</TD>
                    <TD numeric muted>—</TD>
                    <TD numeric className="font-semibold">{rub(effectiveGoodsCostRub)}</TD>
                  </TR>
                  {setoffRub > 0 && (
                    <>
                      <TR>
                        <TD><span className="font-mono">60.01</span> · Зачёт аванса</TD>
                        <TD numeric className="font-semibold">{rub(setoffRub)}</TD>
                        <TD numeric muted>—</TD>
                      </TR>
                      <TR>
                        <TD><span className="font-mono">60.02</span> · Авансы поставщикам</TD>
                        <TD numeric muted>—</TD>
                        <TD numeric className="font-semibold">{rub(setoffRub)}</TD>
                      </TR>
                    </>
                  )}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 h-fit">
          <Card>
            <CardHeader><CardTitle>Сводка приёмки</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SummaryRow label="Принять сейчас" value={`${qty(previewInputLines.reduce((sum, line) => sum + Number(line.qtyReceived ?? 0), 0))} шт`} />
              <SummaryRow label="Стоимость товара" value={rub(effectiveGoodsCostRub)} />
              <SummaryRow label="Связано оплат" value={rub(receiptPreviewQuery.data?.linkedGoodsPaymentRub ?? 0)} />
              <SummaryRow label="Уже принято ранее" value={rub(receiptPreviewQuery.data?.previousReceiptCostRub ?? 0)} />
              <SummaryRow label="Аванс под эту приёмку" value={rub(availableAdvanceRub)} />
              <SummaryRow label="Останется аванс" value={rub(receiptPreviewQuery.data?.remainingAdvanceRub ?? 0)} />
              <SummaryRow label="Останется к оплате" value={rub(payableRub)} />
              {manualGoodsCostRub !== undefined && receiptPreviewQuery.data && (
                <SummaryRow
                  label="Отклонение от авторасчёта"
                  value={rub(round2(manualGoodsCostRub - Number(receiptPreviewQuery.data.suggestedGoodsCostRub ?? 0)))}
                />
              )}
              {receiptPreviewQuery.isLoading && (
                <p className="text-xs text-[var(--color-muted-foreground)]">Пересчитываем распределение стоимости…</p>
              )}
              {receiptPreviewQuery.isError && (
                <p className="text-xs text-[var(--color-danger)]">Не удалось пересчитать себестоимость приёмки.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-2">
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              onClick={() => create.mutate({ post: false })}
              disabled={create.isPending || !warehouseId || previewInputLines.length === 0 || (manualGoodsCostRub !== undefined && !manualReason.trim())}
            >
              <Save size={14} /> Сохранить черновик
            </Button>
            <Button
              size="lg"
              className="w-full"
              onClick={() => create.mutate({ post: true })}
              disabled={create.isPending || !warehouseId || previewInputLines.length === 0 || (manualGoodsCostRub !== undefined && !manualReason.trim())}
            >
              <Save size={14} /> Провести приемку
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ProcurementCostFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const purchaseOrders = (state.purchaseOrders ?? []).filter((candidate: any) => candidate.status !== "cancelled");
  const documents = state.documents ?? [];
  const counterparties = state.counterparties ?? [];
  const [purchaseOrderId, setPurchaseOrderId] = useState(id ?? purchaseOrders[0]?.id ?? "");
  const selectedOrderId = id ?? purchaseOrderId;
  const order = purchaseOrders.find((candidate: any) => candidate.id === selectedOrderId);
  const orderDocument = order ? documents.find((candidate: any) => candidate.id === order.documentId) : undefined;
  const supplier = order ? counterparties.find((candidate: any) => candidate.id === order.supplierId) : undefined;
  const products = state.products ?? [];
  const lots = state.inventoryLots ?? [];
  const warehouses = state.warehouses ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [costType, setCostType] = useState("delivery");
  const [allocationBasis, setAllocationBasis] = useState("by_cost");
  const [costDate, setCostDate] = useState(order?.orderedAt ?? state.accountingPolicy?.accountingStartDate ?? today());
  const [amountRub, setAmountRub] = useState("25000");
  const [paidImmediately, setPaidImmediately] = useState("true");
  const [comment, setComment] = useState("Доставка до Москвы");
  useEffect(() => {
    if (id) {
      setPurchaseOrderId(id);
      return;
    }
    if (!purchaseOrderId && purchaseOrders[0]?.id) {
      setPurchaseOrderId(purchaseOrders[0].id);
    }
  }, [id, purchaseOrderId, purchaseOrders]);
  useEffect(() => {
    if (!order) return;
    setCostDate((current) => current || order.orderedAt || state.accountingPolicy?.accountingStartDate || today());
  }, [order, state.accountingPolicy?.accountingStartDate]);
  const amountRubNumber = Number(amountRub);
  const procurementCostPreviewQuery = useQuery({
    queryKey: ["procurement-cost-preview", selectedOrderId, allocationBasis, amountRubNumber],
    queryFn: () => apiPost<any>(`/api/procurement/purchase-orders/${selectedOrderId}/costs/preview`, {
      allocationBasis,
      amountRub: amountRubNumber
    }),
    enabled: Boolean(selectedOrderId && amountRubNumber > 0)
  });
  const previewAllocatedRub = round2(
    (procurementCostPreviewQuery.data?.lines ?? []).reduce((sum: number, line: any) => sum + Number(line.allocatedAmountRub ?? 0), 0)
  );
  const previewRoundingRub = procurementCostPreviewQuery.data
    ? round2(Number(procurementCostPreviewQuery.data.amountRub ?? 0) - previewAllocatedRub)
    : 0;

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) => {
      if (!selectedOrderId) throw new Error("Выберите заказ поставщику");
      return apiPost(`/api/procurement/purchase-orders/${selectedOrderId}/costs`, {
        costType,
        allocationBasis,
        costDate,
        amountRub: Number(amountRub),
        paidImmediately: paidImmediately === "true",
        comment,
        post
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate(id ? `/procurement/purchase-orders/${selectedOrderId}` : "/money?view=outgoing&type=procurement_cost");
    }
  });

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={id
          ? [{ label: "Поставки", to: "/procurement" }, { label: "Заказ", to: `/procurement/purchase-orders/${selectedOrderId}` }, { label: "Доп. расход" }]
          : [{ label: "Деньги и расчеты", to: "/money" }, { label: "Новая операция" }, { label: "Расход поставки" }]}
        title="Дополнительный расход поставки"
        subtitle="Доставка, упаковка, таможня и сертификация увеличивают себестоимость остатков и проданных единиц"
        actions={id ? <Button variant="ghost" asChild><Link to={`/procurement/purchase-orders/${selectedOrderId}`}><ArrowLeft size={14} /> К заказу</Link></Button> : undefined}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
              {!id && (
                <>
                  <Field label="Заказ поставщику" required>
                    <Select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}>
                      {purchaseOrders.map((candidate: any) => {
                        const candidateDocument = documents.find((item: any) => item.id === candidate.documentId);
                        const candidateSupplier = counterparties.find((item: any) => item.id === candidate.supplierId);
                        return (
                          <option key={candidate.id} value={candidate.id}>
                            {(candidateDocument?.number ?? candidate.id)} · {candidateSupplier?.name ?? "Без поставщика"}
                          </option>
                        );
                      })}
                    </Select>
                  </Field>
                  <Field label="Основание">
                    <Input value={[orderDocument?.number, supplier?.name].filter(Boolean).join(" · ")} readOnly disabled />
                  </Field>
                </>
              )}
              <Field label="Тип расхода" required>
                <Select value={costType} onChange={(e) => setCostType(e.target.value)}>
                  {Object.entries(procurementCostTypeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="База распределения" required>
                <Select value={allocationBasis} onChange={(e) => setAllocationBasis(e.target.value)}>
                  {Object.entries(allocationBasisLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Дата" required>
                <Input aria-label="Дата" type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} />
              </Field>
              <Field label="Сумма, ₽" required>
                <Input type="number" value={amountRub} onChange={(e) => setAmountRub(e.target.value)} />
              </Field>
              <Field label="Оплачено сразу" required>
                <Select value={paidImmediately} onChange={(e) => setPaidImmediately(e.target.value)}>
                  <option value="true">Да, с расчётного счёта</option>
                  <option value="false">Нет, отложенный платёж</option>
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Комментарий"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Распределение по партиям</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Товар</TH>
                    <TH numeric>Получено</TH>
                    <TH numeric>Остаток</TH>
                    <TH numeric>Текущая себест./шт</TH>
                    <TH numeric>База</TH>
                    <TH numeric>Распределено</TH>
                    <TH numeric>Новая себест./шт</TH>
                  </TR>
                </THead>
                <TBody>
                  {(procurementCostPreviewQuery.data?.lines ?? []).map((line: any) => {
                    const product = products.find((item: any) => item.id === line.productId);
                    const lot = lots.find((item: any) => item.id === line.lotId);
                    const warehouse = warehouses.find((item: any) => item.id === line.warehouseId);
                    const currentUnitCostRub = Number(lot?.unitCostRub ?? 0);
                    const nextUnitCostRub = line.qtyRemaining > 0
                      ? currentUnitCostRub + Number(line.unitCostDeltaRub ?? 0)
                      : currentUnitCostRub;
                    return (
                      <TR key={line.lotId}>
                        <TD>
                          <div className="flex flex-col gap-1">
                            <ProductCell product={product} />
                            <div className="pl-[46px] text-[11px] text-[var(--color-muted-foreground)]">
                              {warehouse?.name ?? "—"} · партия <span className="font-mono">{line.lotId}</span>
                            </div>
                          </div>
                        </TD>
                        <TD numeric muted>{qty(line.qtyInitial)}</TD>
                        <TD numeric muted>{qty(line.qtyRemaining)}</TD>
                        <TD numeric>{formatRubPerUnit(currentUnitCostRub)}</TD>
                        <TD numeric muted>{formatAllocationBasis(line.basisValue, allocationBasis)}</TD>
                        <TD numeric className="font-semibold">{rub(line.allocatedAmountRub)}</TD>
                        <TD numeric>
                          <div className="flex flex-col items-end">
                            <span>{formatRubPerUnit(nextUnitCostRub)}</span>
                            {line.qtySold > 0 && (
                              <span className="text-[11px] text-[var(--color-muted-foreground)]">уже продано {qty(line.qtySold)} шт</span>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 h-fit">
          <Card>
            <CardHeader><CardTitle>Сводка распределения</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SummaryRow label="Сумма расхода" value={rub(amountRubNumber || 0)} />
              <SummaryRow label="Распределено" value={rub(previewAllocatedRub)} />
              <SummaryRow label="Разница округления" value={rub(previewRoundingRub)} />
              <SummaryRow label="В остатках" value={rub(procurementCostPreviewQuery.data?.remainingInventoryAmountRub ?? 0)} />
              <SummaryRow label="В себестоимость продаж" value={rub(procurementCostPreviewQuery.data?.soldCostAmountRub ?? 0)} />
              <SummaryRow label="Затронуто партий" value={String((procurementCostPreviewQuery.data?.lines ?? []).length)} />
              <SummaryRow label="Затронуто продаж" value={String((procurementCostPreviewQuery.data?.lines ?? []).filter((line: any) => Number(line.qtySold ?? 0) > 0).length)} />
              {procurementCostPreviewQuery.isLoading && (
                <p className="text-xs text-[var(--color-muted-foreground)]">Пересчитываем новую себестоимость партий…</p>
              )}
              {procurementCostPreviewQuery.isError && (
                <p className="text-xs text-[var(--color-danger)]">Не удалось построить распределение расхода.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Предпросмотр проводки</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead><TR><TH>Счёт</TH><TH numeric>Дебет</TH><TH numeric>Кредит</TH></TR></THead>
                <TBody>
                  <TR>
                    <TD><span className="font-mono">41.*</span> · Доп. расход в остатках</TD>
                    <TD numeric className="font-semibold">{rub(procurementCostPreviewQuery.data?.remainingInventoryAmountRub ?? 0)}</TD>
                    <TD numeric muted>—</TD>
                  </TR>
                  <TR>
                    <TD><span className="font-mono">90.02</span> · Доп. расход по проданным товарам</TD>
                    <TD numeric className="font-semibold">{rub(procurementCostPreviewQuery.data?.soldCostAmountRub ?? 0)}</TD>
                    <TD numeric muted>—</TD>
                  </TR>
                  <TR>
                    <TD><span className="font-mono">{paidImmediately === "true" ? "51" : "60.01"}</span> · {paidImmediately === "true" ? "Оплата расхода" : "Задолженность по расходу"}</TD>
                    <TD numeric muted>—</TD>
                    <TD numeric className="font-semibold">{rub(amountRubNumber || 0)}</TD>
                  </TR>
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-2">
            <Button size="lg" variant="secondary" className="w-full" onClick={() => create.mutate({ post: false })} disabled={create.isPending || !selectedOrderId}>
              <Save size={14} /> Сохранить черновик
            </Button>
            <Button size="lg" className="w-full" onClick={() => create.mutate({ post: true })} disabled={create.isPending || !selectedOrderId}>
              <Save size={14} /> Провести расход
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="numeric font-semibold text-right">{value}</span>
    </div>
  );
}

function formatRubPerUnit(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${rub(value, { precise: true })}/шт`;
}

function formatAllocationBasis(value: number | null | undefined, basis: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (basis === "by_cost") return rub(value, { precise: true });
  if (basis === "by_weight") return `${qty(value)} г`;
  return `${qty(value)} шт`;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function ShortageResolutionFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const order = (state.purchaseOrders ?? []).find((o: any) => o.id === id);
  const products = state.products ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shortagePreviewQuery = useQuery({
    queryKey: ["shortage-preview-form", id],
    queryFn: () => apiGet<any>(`/api/procurement/purchase-orders/${id}/shortages/preview`),
    enabled: Boolean(id)
  });
  const previewLines = shortagePreviewQuery.data?.lines ?? [];

  const [resolvedAt, setResolvedAt] = useState(order?.orderedAt ?? state.accountingPolicy?.accountingStartDate ?? today());
  const [reason, setReason] = useState("При приёмке не досчитались товара");
  const [linesState, setLinesState] = useState<Array<{ purchaseOrderLineId: string; qtyShortage: number; action: "wait_supplier" | "supplier_claim" | "loss" | "close_without_accounting" }>>([]);
  useEffect(() => {
    if (previewLines.length === 0) return;
    setLinesState((current) => {
      if (current.length > 0) return current;
      return previewLines.map((line: any) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        qtyShortage: Number(line.qtyShortage ?? 0),
        action: "supplier_claim" as const
      }));
    });
  }, [previewLines]);

  const create = useMutation({
    mutationFn: ({ post }: { post: boolean }) =>
      apiPost(`/api/procurement/purchase-orders/${id}/shortages`, {
        resolvedAt, reason,
        post,
        lines: linesState.map((l) => ({ ...l, qtyShortage: Number(l.qtyShortage) }))
      }),
    onSuccess: () => { queryClient.invalidateQueries(); navigate(`/procurement/purchase-orders/${id}`); }
  });

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Поставки", to: "/procurement" }, { label: "Заказ", to: `/procurement/purchase-orders/${id}` }, { label: "Недопоставка" }]}
        title="Недопоставка"
        subtitle="Если приняли меньше, чем заказали: ждать поставщика, оставить претензию или списать в потери"
      />
      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
          <Field label="Дата решения" required>
            <Input type="date" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Причина"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Строки</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Товар</TH><TH numeric>Заказано</TH><TH numeric>Принято</TH><TH numeric>Оплаченная доля</TH><TH numeric>Недостача</TH><TH>Действие</TH></TR></THead>
            <TBody>
              {previewLines.map((line: any, i: number) => (
                (() => {
                  const currentLine = linesState[i] ?? {
                    purchaseOrderLineId: line.purchaseOrderLineId,
                    qtyShortage: Number(line.qtyShortage ?? 0),
                    action: "supplier_claim" as const
                  };
                  return (
                    <TR key={line.purchaseOrderLineId}>
                      <TD><ProductCell product={products.find((p: any) => p.id === line.productId)} /></TD>
                      <TD numeric muted>{qty(line.qtyOrdered)}</TD>
                      <TD numeric muted>{qty(line.qtyReceived)}</TD>
                      <TD numeric>{rub(line.paidShareRub)}</TD>
                      <TD>
                        <Input type="number" value={currentLine.qtyShortage} onChange={(e) => {
                          const next = linesState.slice();
                          next[i] = { ...currentLine, qtyShortage: Number(e.target.value) };
                          setLinesState(next);
                        }} className="text-right" />
                      </TD>
                      <TD>
                        <Select value={currentLine.action} onChange={(e) => {
                          const next = linesState.slice();
                          next[i] = { ...currentLine, action: e.target.value as any };
                          setLinesState(next);
                        }}>
                          {Object.entries(shortageActionLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      </TD>
                    </TR>
                  );
                })()
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button size="lg" variant="secondary" onClick={() => create.mutate({ post: false })} disabled={create.isPending || linesState.length === 0}><Save size={14} /> Сохранить черновик</Button>
        <Button size="lg" onClick={() => create.mutate({ post: true })} disabled={create.isPending || linesState.length === 0}><Save size={14} /> Зафиксировать решение</Button>
      </div>
    </div>
  );
}
