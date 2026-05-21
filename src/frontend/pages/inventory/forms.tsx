import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EntityDeleteDialog, type EntityRollbackPreview } from "@/components/entity-delete-dialog";
import { useAppState } from "@/lib/use-app-state";
import { apiDelete, apiGet, apiPost } from "@/api";
import { date, rub, qty } from "@/lib/format";
import { movementTypeLabel, stockStateLabel, warehouseTypeLabel } from "@/lib/i18n";
import { ProductCell } from "@/components/product-thumb";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { paginateRows } from "@/lib/pagination";

const today = () => new Date().toISOString().slice(0, 10);

export function OpeningBalanceFormPage() {
  const { state } = useAppState();
  const products = state.products ?? [];
  const warehouses = (state.warehouses ?? []).filter((w: any) => w.isActive !== false);
  const defaultWarehouseId = warehouses.find((warehouse: any) => warehouse.warehouseType === "own")?.id ?? warehouses[0]?.id ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openingDate = state.accountingPolicy?.accountingStartDate ?? today();

  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [stateCode, setStateCode] = useState("sellable");
  const [comment, setComment] = useState("Стартовые остатки на дату начала учета");
  const [lines, setLines] = useState<Array<{ productId: string; qty: string; unitCostRub: string }>>([
    {
      productId: products[0]?.id ?? "",
      qty: "100",
      unitCostRub: "1200"
    }
  ]);

  const duplicateProducts = new Set(
    lines
      .filter((line) => line.productId)
      .map((line) => line.productId)
      .filter((productId, index, array) => array.indexOf(productId) !== index)
  );

  const lineView = lines.map((line, index) => {
    const product = products.find((candidate: any) => candidate.id === line.productId);
    const qtyNumber = Number(line.qty || 0);
    const unitCostNumber = Number(line.unitCostRub || 0);
    const lineTotalRub = qtyNumber > 0 && unitCostNumber >= 0 ? qtyNumber * unitCostNumber : 0;
    const duplicate = Boolean(line.productId && duplicateProducts.has(line.productId));
    return { ...line, index, product, qtyNumber, unitCostNumber, lineTotalRub, duplicate };
  });

  const totalQty = lineView.reduce((sum, line) => sum + (Number.isFinite(line.qtyNumber) ? line.qtyNumber : 0), 0);
  const totalCostRub = lineView.reduce((sum, line) => sum + (Number.isFinite(line.lineTotalRub) ? line.lineTotalRub : 0), 0);
  const selectedWarehouse = warehouses.find((warehouse: any) => warehouse.id === warehouseId);

  const canSubmit = Boolean(
    warehouseId &&
    lines.length > 0 &&
    lineView.every((line) =>
      Boolean(line.productId) &&
      !line.duplicate &&
      line.qtyNumber > 0 &&
      line.unitCostNumber >= 0
    )
  );

  const create = useMutation({
    mutationFn: async (post: boolean) => {
      const payload = await apiPost("/api/inventory/opening-balances", {
        date: openingDate,
        warehouseId,
        stateCode,
        comment: comment || undefined,
        post,
        lines: lines.map((line) => ({
          productId: line.productId,
          qty: Number(line.qty),
          unitCostRub: Number(line.unitCostRub),
          stateCode
        }))
      });
      return payload;
    },
    onSuccess: (data: any, post) => {
      queryClient.invalidateQueries();
      navigate(post ? "/inventory" : `/documents/${data.id}`);
    }
  });

  if (products.length === 0) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Стартовый остаток" }]}
          title="Стартовый остаток"
          subtitle="Сначала нужен хотя бы один товар в каталоге."
          actions={<Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>}
        />
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Save size={18} />}
              title="Сначала создайте товар"
              description="Документ стартового остатка вводит актив на баланс. Для каждой строки нужен внутренний SKU."
              action={<Button asChild><Link to="/products/new">Создать товар</Link></Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Стартовый остаток" }]}
        title="Стартовый остаток"
        subtitle="Документ вводит актив на дату начала учета, создает партию FIFO и проводку Дт 41.* / Кт 80.01."
        actions={<Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Документ</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Дата учёта" required hint="Дата фиксирована по учётной политике и равна старту учета.">
                <Input aria-label="Дата учёта" type="date" value={openingDate} readOnly />
              </Field>
              <Field label="Склад" required>
                <Select aria-label="Склад" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                  {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </Select>
              </Field>
              <Field label="Состояние" required>
                <Select aria-label="Состояние" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
                  <option value="sellable">{stockStateLabel.sellable}</option>
                  <option value="reserved">{stockStateLabel.reserved}</option>
                  <option value="damaged">{stockStateLabel.damaged}</option>
                  <option value="lost_pending">{stockStateLabel.lost_pending}</option>
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Комментарий">
                  <Input aria-label="Комментарий" value={comment} onChange={(event) => setComment(event.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Строки документа</CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setLines((current) => [...current, { productId: products[0]?.id ?? "", qty: "", unitCostRub: "" }])}
                >
                  Добавить строку
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-12">#</TH>
                    <TH>Товар</TH>
                    <TH className="w-36">Количество</TH>
                    <TH className="w-44">Себестоимость единицы</TH>
                    <TH numeric className="w-44">Сумма</TH>
                    <TH className="w-20">Удалить</TH>
                  </TR>
                </THead>
                <TBody>
                  {lineView.map((line) => (
                    <TR key={line.index}>
                      <TD muted>{line.index + 1}</TD>
                      <TD>
                        <div className="grid gap-2">
                          <Select
                            aria-label={line.index === 0 ? "Товар" : `Товар ${line.index + 1}`}
                            value={line.productId}
                            onChange={(event) => setLines((current) => current.map((currentLine, index) => index === line.index ? { ...currentLine, productId: event.target.value } : currentLine))}
                          >
                            {products.map((product: any) => (
                              <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                            ))}
                          </Select>
                          {line.product && <ProductCell product={line.product} size={32} />}
                          {line.duplicate && <div className="text-xs text-[var(--color-danger)]">Один и тот же товар нельзя повторять в одном стартовом остатке.</div>}
                        </div>
                      </TD>
                      <TD>
                        <Input
                          aria-label={line.index === 0 ? "Количество" : `Количество ${line.index + 1}`}
                          value={line.qty}
                          onChange={(event) => setLines((current) => current.map((currentLine, index) => index === line.index ? { ...currentLine, qty: event.target.value } : currentLine))}
                          type="number"
                          min={0}
                          invalid={line.qty !== "" && line.qtyNumber <= 0}
                        />
                      </TD>
                      <TD>
                        <Input
                          aria-label={line.index === 0 ? "Себестоимость единицы" : `Себестоимость единицы ${line.index + 1}`}
                          value={line.unitCostRub}
                          onChange={(event) => setLines((current) => current.map((currentLine, index) => index === line.index ? { ...currentLine, unitCostRub: event.target.value } : currentLine))}
                          type="number"
                          min={0}
                          invalid={line.unitCostRub !== "" && line.unitCostNumber < 0}
                        />
                      </TD>
                      <TD numeric className="font-semibold">{rub(line.lineTotalRub)}</TD>
                      <TD>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, index) => index !== line.index))}
                          disabled={lines.length === 1}
                        >
                          Удалить
                        </Button>
                      </TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={2} className="font-semibold">Итого по документу</TD>
                    <TD numeric className="font-semibold">{qty(totalQty)}</TD>
                    <TD />
                    <TD numeric className="font-semibold">{rub(totalCostRub)}</TD>
                    <TD />
                  </TR>
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-primary-soft)]/45 px-4 py-3 text-sm text-[var(--color-muted-foreground)] leading-relaxed">
            Стартовый остаток создает актив на дату начала учета. История закупки до этой даты в системе не восстанавливается этим документом.
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" asChild>
              <Link to="/inventory">Отмена</Link>
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => create.mutate(false)} disabled={create.isPending || !canSubmit}>
                <Save size={14} /> Сохранить черновик
              </Button>
              <Button size="lg" onClick={() => create.mutate(true)} disabled={create.isPending || !canSubmit}>
                <Save size={14} /> Провести стартовый остаток
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="h-fit sticky top-20">
            <CardHeader><CardTitle>Итоги документа</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SummaryRow label="Количество строк" value={lines.length} />
              <SummaryRow label="Общее количество" value={`${qty(totalQty)} шт`} />
              <SummaryRow label="Общая сумма" value={rub(totalCostRub)} />
              <SummaryRow label="Склад" value={selectedWarehouse?.name ?? "—"} />
              <SummaryRow label="Состояние" value={stockStateLabel[stateCode] ?? stateCode} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Проводка</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{inventoryAccountForWarehouse(selectedWarehouse?.warehouseType)}</span>
                <Badge tone="success">Дт</Badge>
              </div>
              <div className="text-sm text-[var(--color-muted-foreground)]">{inventoryAccountLabel(selectedWarehouse?.warehouseType)}</div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">80.01</span>
                <Badge tone="neutral">Кт</Badge>
              </div>
              <div className="text-sm text-[var(--color-muted-foreground)]">Стартовые остатки / вложение владельца</div>
              <div className="pt-2 border-t border-[var(--color-border)]">
                <div className="text-xs uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Сумма проводки</div>
                <div className="text-lg font-semibold mt-1">{rub(totalCostRub)}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Период</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span>{formatPeriodLabel(openingDate)}</span>
                <Badge tone="success">Открыт</Badge>
              </div>
              <div className="text-[var(--color-muted-foreground)]">
                Документ будет отражён в учёте периода {formatPeriodLabel(openingDate)}.
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function StockMovementsPage() {
  const { state } = useAppState();
  const movements = state.stockMovements ?? [];
  const products = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const docs = state.documents ?? [];
  const [dateFrom, setDateFrom] = useState(state.accountingPolicy?.accountingStartDate ?? today());
  const [dateTo, setDateTo] = useState(today());
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [movementType, setMovementType] = useState("");
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return movements
      .slice()
      .sort((left: any, right: any) => left.occurredAt.localeCompare(right.occurredAt))
      .filter((movement: any) => {
        if (dateFrom && movement.occurredAt < dateFrom) return false;
        if (dateTo && movement.occurredAt > dateTo) return false;
        if (warehouseFilter && movement.warehouseId !== warehouseFilter) return false;
        if (stateFilter && (movement.stockStateCode ?? "sellable") !== stateFilter) return false;
        if (movementType && movement.movementType !== movementType) return false;
        return true;
      });
  }, [dateFrom, dateTo, movementType, movements, stateFilter, warehouseFilter]);

  const rows = filtered.map((movement: any) => {
    const product = products.find((candidate: any) => candidate.id === movement.productId);
    const warehouse = warehouses.find((candidate: any) => candidate.id === movement.warehouseId);
    const document = docs.find((candidate: any) => candidate.id === movement.documentId);
    return { movement, product, warehouse, document };
  });

  const selected = rows.find((row) => row.movement.id === selectedMovementId) ?? rows.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Движения склада"
        subtitle="Каждое движение связано с документом-источником и партией FIFO"
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Движения" }]}
        actions={<Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>}
      />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Card className="renderPanel min-w-0">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <Input aria-label="Период от" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-40" />
              <Input aria-label="Период до" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-40" />
              <Select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="w-44">
                <option value="">Все склады</option>
                {warehouses.map((warehouse: any) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </Select>
              <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="w-44">
                <option value="">Все состояния</option>
                <option value="sellable">{stockStateLabel.sellable}</option>
                <option value="reserved">{stockStateLabel.reserved}</option>
                <option value="damaged">{stockStateLabel.damaged}</option>
                <option value="lost_pending">{stockStateLabel.lost_pending}</option>
              </Select>
              <Select value={movementType} onChange={(event) => setMovementType(event.target.value)} className="w-44">
                <option value="">Все типы</option>
                {Array.from<string>(new Set(movements.map((movement: any) => String(movement.movementType)))).map((type) => (
                  <option key={type} value={type}>{movementTypeLabel[type as keyof typeof movementTypeLabel] ?? type}</option>
                ))}
              </Select>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Дата</TH>
                  <TH>Документ</TH>
                  <TH>Товар</TH>
                  <TH>Тип движения</TH>
                  <TH>Склад</TH>
                  <TH>Состояние</TH>
                  <TH numeric>Приход</TH>
                  <TH numeric>Расход</TH>
                  <TH numeric>Сумма</TH>
                  <TH>Партия</TH>
                </TR>
              </THead>
              <TBody>
                {rows.length === 0 && (
                  <TR>
                    <TD colSpan={10} className="text-center py-10 text-[var(--color-muted-foreground)]">Движений по выбранным фильтрам нет</TD>
                  </TR>
                )}
                {rows.slice().reverse().map((row) => (
                  <TR key={row.movement.id} interactive selected={row.movement.id === selected?.movement.id} onClick={() => setSelectedMovementId(row.movement.id)}>
                    <TD muted className="numeric">{date(row.movement.occurredAt)}</TD>
                    <TD>{row.document && <Link to={`/documents/${row.document.id}`} className="text-[var(--color-primary)] hover:underline numeric text-xs">{row.document.number}</Link>}</TD>
                    <TD><ProductCell product={row.product} /></TD>
                    <TD><Badge tone={row.movement.qty >= 0 ? "success" : "warning"}>{movementTypeLabel[row.movement.movementType] ?? row.movement.movementType}</Badge></TD>
                    <TD>
                      <div className="font-medium">{row.warehouse?.name ?? "—"}</div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)]">{warehouseTypeLabel[row.warehouse?.warehouseType ?? ""] ?? ""}</div>
                    </TD>
                    <TD><Badge tone="neutral">{stockStateLabel[row.movement.stockStateCode ?? "sellable"] ?? row.movement.stockStateCode ?? "—"}</Badge></TD>
                    <TD numeric>{row.movement.qty > 0 ? qty(row.movement.qty) : "—"}</TD>
                    <TD numeric>{row.movement.qty < 0 ? qty(Math.abs(row.movement.qty)) : "—"}</TD>
                    <TD numeric>{rub(Math.abs(row.movement.costRub))}</TD>
                    <TD className="font-mono text-xs">{row.movement.lotId ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit sticky top-20 min-w-0">
          {selected ? (
            <CardContent className="flex flex-col gap-4 py-4">
              <div className="text-lg font-semibold">Происхождение движения</div>
              <SummaryRow label="Документ" value={selected.document ? <Link to={`/documents/${selected.document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{selected.document.number}</Link> : "—"} />
              <SummaryRow label="Товар" value={selected.product?.name ?? "—"} />
              <SummaryRow label="Тип" value={movementTypeLabel[selected.movement.movementType] ?? selected.movement.movementType} />
              <SummaryRow label="Склад" value={selected.warehouse?.name ?? "—"} />
              <SummaryRow label="Состояние" value={stockStateLabel[selected.movement.stockStateCode ?? "sellable"] ?? "—"} />
              <SummaryRow label="Количество" value={`${selected.movement.qty > 0 ? "+" : "-"}${qty(Math.abs(selected.movement.qty))}`} />
              <SummaryRow label="Стоимость" value={rub(Math.abs(selected.movement.costRub))} />
              <SummaryRow label="Партия" value={selected.movement.lotId ?? "—"} />
            </CardContent>
          ) : (
            <CardContent className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">Выберите движение в таблице</CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

export function TransferFormPage() {
  const { state } = useAppState();
  const products = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const stockStates = state.stockStates ?? [];
  const lots = state.inventoryLots ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledTargetWarehouseId = searchParams.get("targetWarehouseId") ?? "";

  const [transferDate, setTransferDate] = useState(today());
  const [fromWarehouseId, setFromWarehouseId] = useState(warehouses.find((w: any) => w.warehouseType === "own")?.id ?? "");
  const [fromStockStateCode, setFromStockStateCode] = useState("sellable");
  const [toWarehouseId, setToWarehouseId] = useState(prefilledTargetWarehouseId || (warehouses.find((w: any) => w.warehouseType === "sales_point")?.id ?? ""));
  const [toStockStateCode, setToStockStateCode] = useState("sellable");
  const [transferType, setTransferType] = useState("to_sales_point");
  const [comment, setComment] = useState("Перемещение товара между складскими узлами");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qtyValue, setQtyValue] = useState("25");
  const selectedProduct = products.find((product: any) => product.id === productId);
  const selectedSource = warehouses.find((warehouse: any) => warehouse.id === fromWarehouseId);
  const selectedTarget = warehouses.find((warehouse: any) => warehouse.id === toWarehouseId);
  const availableQty = stockStates
    .filter((candidate: any) => candidate.productId === productId && candidate.warehouseId === fromWarehouseId && (candidate.stateCode ?? "sellable") === fromStockStateCode)
    .reduce((sum: number, candidate: any) => sum + Number(candidate.qty ?? 0), 0);
  const qtyNumber = Number(qtyValue || 0);
  const fifoPreview = useMemo(() => {
    let remaining = qtyNumber;
    return lots
      .filter((lot: any) =>
        lot.productId === productId &&
        lot.warehouseId === fromWarehouseId &&
        (lot.stockStateCode ?? "sellable") === fromStockStateCode &&
        Number(lot.qtyRemaining ?? 0) > 0
      )
      .slice()
      .sort((left: any, right: any) => String(left.receivedAt).localeCompare(String(right.receivedAt)))
      .map((lot: any) => {
        const consumedQty = remaining > 0 ? Math.min(remaining, Number(lot.qtyRemaining ?? 0)) : 0;
        remaining = Math.max(0, remaining - consumedQty);
        return { lot, consumedQty, consumedCostRub: consumedQty > 0 ? Number(lot.unitCostRub ?? 0) * consumedQty : 0 };
      })
      .filter((line) => line.consumedQty > 0);
  }, [fromStockStateCode, fromWarehouseId, lots, productId, qtyNumber]);
  const projectedCostRub = fifoPreview.reduce((sum, line) => sum + line.consumedCostRub, 0);
  const insufficient = qtyNumber > availableQty + 0.0001;
  const sameTarget = fromWarehouseId === toWarehouseId && fromStockStateCode === toStockStateCode;

  const create = useMutation({
    mutationFn: (post: boolean) =>
      apiPost("/api/inventory/transfers", {
        transferDate,
        fromWarehouseId,
        toWarehouseId,
        fromStockStateCode,
        toStockStateCode,
        transferType,
        comment: comment || undefined,
        post,
        lines: [{ productId, qty: Number(qtyValue) }]
      }),
    onSuccess: (data: any, post) => {
      queryClient.invalidateQueries();
      if (!post) {
        navigate(`/inventory/transfers/${data.id}`);
        return;
      }
      navigate(selectedTarget?.warehouseType === "sales_point" ? `/inventory/sales-points/${toWarehouseId}` : "/inventory");
    }
  });

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Перемещение" }]}
        title="Перемещение товара"
        subtitle="Переносит количество и себестоимость между складом, транзитом и точкой продаж без выручки и расходов."
        actions={<Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Параметры перемещения</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Дата учета" required>
                <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
              </Field>
              <Field label="Тип" required>
                <Select value={transferType} onChange={(e) => setTransferType(e.target.value)}>
                  <option value="internal">Обычное перемещение</option>
                  <option value="to_sales_point">Отгрузка на точку продаж</option>
                  <option value="from_transit_to_sales_point">Приемка на точке продаж</option>
                  <option value="state_change">Смена состояния</option>
                </Select>
              </Field>
              <Field label="Откуда" required>
                <Select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
                  {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </Select>
              </Field>
              <Field label="Состояние откуда" required>
                <Select value={fromStockStateCode} onChange={(e) => setFromStockStateCode(e.target.value)}>
                  <option value="sellable">{stockStateLabel.sellable}</option>
                  <option value="reserved">{stockStateLabel.reserved}</option>
                  <option value="damaged">{stockStateLabel.damaged}</option>
                  <option value="lost_pending">{stockStateLabel.lost_pending}</option>
                </Select>
              </Field>
              <Field label="Куда" required>
                <Select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                  {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </Select>
              </Field>
              <Field label="Состояние куда" required>
                <Select value={toStockStateCode} onChange={(e) => setToStockStateCode(e.target.value)}>
                  <option value="sellable">{stockStateLabel.sellable}</option>
                  <option value="reserved">{stockStateLabel.reserved}</option>
                  <option value="damaged">{stockStateLabel.damaged}</option>
                  <option value="lost_pending">{stockStateLabel.lost_pending}</option>
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Комментарий">
                  <Input value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardHeader><CardTitle>Строки перемещения</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR><TH>Товар</TH><TH numeric>Доступно</TH><TH numeric>Перемещаем</TH><TH>FIFO-слои</TH><TH numeric>Стоимость</TH><TH>Куда придет</TH></TR>
                </THead>
                <TBody>
                  <TR>
                    <TD>
                      <div className="grid gap-2">
                        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                          {products.map((product: any) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                        </Select>
                        {selectedProduct && <ProductCell product={selectedProduct} />}
                      </div>
                    </TD>
                    <TD numeric className={insufficient ? "text-[var(--color-danger)] font-semibold" : ""}>{qty(availableQty)}</TD>
                    <TD><Input value={qtyValue} onChange={(e) => setQtyValue(e.target.value)} type="number" min={1} /></TD>
                    <TD>
                      <div className="flex flex-col gap-1 text-xs">
                        {fifoPreview.length === 0 && <span className="text-[var(--color-muted-foreground)]">Нет доступных партий</span>}
                        {fifoPreview.map((line) => (
                          <div key={line.lot.id} className="flex items-center justify-between gap-3">
                            <span className="font-mono">{line.lot.id}</span>
                            <span>{qty(line.consumedQty)} шт</span>
                          </div>
                        ))}
                      </div>
                    </TD>
                    <TD numeric className="font-semibold">{rub(projectedCostRub)}</TD>
                    <TD>
                      <div className="text-sm font-medium">{selectedTarget?.name ?? "—"}</div>
                      <div className="text-[11px] text-[var(--color-muted-foreground)]">{stockStateLabel[toStockStateCode] ?? toStockStateCode}</div>
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" asChild><Link to="/inventory">Отмена</Link></Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => create.mutate(false)} disabled={create.isPending || insufficient || sameTarget || qtyNumber <= 0}>
                <Save size={14} /> Сохранить черновик
              </Button>
              <Button size="lg" onClick={() => create.mutate(true)} disabled={create.isPending || insufficient || sameTarget || qtyNumber <= 0}>
                <Save size={14} /> Провести перемещение
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="h-fit sticky top-20">
            <CardHeader><CardTitle>Сводка FIFO</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SummaryRow label="Источник" value={selectedSource?.name ?? "—"} />
              <SummaryRow label="Приемник" value={selectedTarget?.name ?? "—"} />
              <SummaryRow label="Количество" value={`${qty(qtyNumber)} шт`} />
              <SummaryRow label="Стоимость" value={rub(projectedCostRub)} />
              <SummaryRow label="Партии" value={String(fifoPreview.length)} />
              {sameTarget && <div className="text-xs text-[var(--color-danger)]">Нечего перемещать: место и состояние совпадают.</div>}
              {insufficient && <div className="text-xs text-[var(--color-danger)]">Недостаточно остатка в источнике. Доступно {qty(availableQty)} шт.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Проводка</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead><TR><TH>Счёт</TH><TH numeric>Дебет</TH><TH numeric>Кредит</TH></TR></THead>
                <TBody>
                  <TR><TD><span className="font-mono">{inventoryAccountForWarehouse(selectedTarget?.warehouseType)}</span> · {inventoryAccountLabel(selectedTarget?.warehouseType)}</TD><TD numeric className="font-semibold">{rub(projectedCostRub)}</TD><TD numeric muted>—</TD></TR>
                  <TR><TD><span className="font-mono">{inventoryAccountForWarehouse(selectedSource?.warehouseType)}</span> · {inventoryAccountLabel(selectedSource?.warehouseType)}</TD><TD numeric muted>—</TD><TD numeric className="font-semibold">{rub(projectedCostRub)}</TD></TR>
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function TransferCardPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const transfer = (state.stockTransfers ?? []).find((candidate: any) => candidate.id === id);

  const deletePreview = useQuery({
    queryKey: ["stock-transfer-delete-preview", id],
    queryFn: () => apiGet<EntityRollbackPreview>(`/api/inventory/transfers/${id}/delete-preview`),
    enabled: Boolean(id) && deleteOpen
  });

  const removeTransfer = useMutation({
    mutationFn: () => apiDelete(`/api/inventory/transfers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate("/inventory");
    }
  });

  const postTransfer = useMutation({
    mutationFn: () => apiPost(`/api/inventory/transfers/${id}/post`),
    onSuccess: () => queryClient.invalidateQueries()
  });

  if (!transfer) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader
          title="Перемещение не найдено"
          breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Перемещения" }]}
          actions={<Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>}
        />
      </div>
    );
  }

  const document = (state.documents ?? []).find((candidate: any) => candidate.id === transfer.documentId);
  const transferLines = (state.stockTransferLines ?? []).filter((line: any) => line.stockTransferId === transfer.id);
  const products = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const fromWarehouse = warehouses.find((candidate: any) => candidate.id === transfer.fromWarehouseId);
  const toWarehouse = warehouses.find((candidate: any) => candidate.id === transfer.toWarehouseId);
  const costApplications = (state.costApplications ?? []).filter((application: any) => application.outboundDocumentId === transfer.documentId);
  const createdLots = (state.inventoryLots ?? []).filter((lot: any) => lot.sourceDocumentId === transfer.documentId);
  const stockMovements = (state.stockMovements ?? []).filter((movement: any) => movement.documentId === transfer.documentId);

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Перемещение" }]}
        title={`Перемещение · ${document?.number ?? transfer.id}`}
        subtitle={`${date(transfer.transferDate)} · ${fromWarehouse?.name ?? "—"} → ${toWarehouse?.name ?? "—"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" asChild><Link to="/inventory"><ArrowLeft size={14} /> Назад</Link></Button>
            {transfer.status === "draft" && (
              <Button onClick={() => postTransfer.mutate()} disabled={postTransfer.isPending}>
                <Save size={14} /> Провести
              </Button>
            )}
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Параметры перемещения</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <SummaryRow label="Документ" value={document ? <Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline font-mono">{document.number}</Link> : "—"} />
              <SummaryRow label="Статус" value={<Badge tone={transfer.status === "posted" ? "success" : transfer.status === "cancelled" ? "danger" : "neutral"}>{transfer.status}</Badge>} />
              <SummaryRow label="Дата учета" value={date(transfer.transferDate)} />
              <SummaryRow label="Тип" value={transfer.transferType ? transfer.transferType.replaceAll("_", " ") : "—"} />
              <SummaryRow label="Откуда" value={fromWarehouse?.name ?? "—"} />
              <SummaryRow label="Куда" value={toWarehouse?.name ?? "—"} />
              <SummaryRow label="Состояние откуда" value={stockStateLabel[transfer.fromStockStateCode ?? "sellable"] ?? transfer.fromStockStateCode ?? "—"} />
              <SummaryRow label="Состояние куда" value={stockStateLabel[transfer.toStockStateCode ?? "sellable"] ?? transfer.toStockStateCode ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Строки</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR><TH>Товар</TH><TH numeric>Количество</TH><TH numeric>Себестоимость</TH><TH>Партии прихода</TH></TR>
                </THead>
                <TBody>
                  {transferLines.map((line: any) => {
                    const product = products.find((candidate: any) => candidate.id === line.productId);
                    const lineLots = createdLots.filter((lot: any) => String(lot.sourceLineId ?? "") === line.id);
                    return (
                      <TR key={line.id}>
                        <TD><ProductCell product={product} /></TD>
                        <TD numeric>{qty(line.qty)}</TD>
                        <TD numeric>{rub(line.costRub)}</TD>
                        <TD>
                          <div className="flex flex-col gap-1 text-xs">
                            {lineLots.length === 0 && <span className="text-[var(--color-muted-foreground)]">—</span>}
                            {lineLots.map((lot: any) => <span key={lot.id} className="font-mono">{lot.id}</span>)}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Технические следы</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryRow label="FIFO-списания" value={String(costApplications.length)} />
              <SummaryRow label="Партии-приемники" value={String(createdLots.length)} />
              <SummaryRow label="Складские движения" value={String(stockMovements.length)} />
              <SummaryRow label="Проводки" value={String((state.journalEntries ?? []).filter((entry: any) => entry.documentId === transfer.documentId).length)} />
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="h-fit sticky top-20">
            <CardHeader><CardTitle>Комментарий</CardTitle></CardHeader>
            <CardContent className="text-sm text-[var(--color-muted-foreground)]">
              {transfer.comment || "Без комментария"}
            </CardContent>
          </Card>
        </aside>
      </div>

      <EntityDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить перемещение"
        description="Удаление откатит списание FIFO и уберет приходные партии на целевом складе. Если товар уже использован дальше, удаление будет заблокировано."
        preview={deletePreview.data}
        previewLoading={deletePreview.isLoading}
        errorMessage={removeTransfer.isError ? mutationMessage(removeTransfer.error) : undefined}
        onConfirm={() => removeTransfer.mutate()}
        confirmLabel="Удалить перемещение"
        confirmPending={removeTransfer.isPending}
      />
    </div>
  );
}

export function SalesPointStockPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const wh = (state.warehouses ?? []).find((w: any) => w.id === id);
  const stocks = (state.stockStates ?? []).filter((s: any) => s.warehouseId === id);
  const products = state.products ?? [];
  const lots = (state.inventoryLots ?? []).filter((lot: any) => lot.warehouseId === id);
  const movements = (state.stockMovements ?? []).filter((movement: any) => movement.warehouseId === id);
  const documents = state.documents ?? [];
  const [selectedProductId, setSelectedProductId] = useState<string | null>(stocks[0]?.productId ?? null);
  const summary = {
    bookQty: stocks.reduce((sum: number, stock: any) => sum + Number(stock.qty ?? 0), 0),
    availableQty: stocks.filter((stock: any) => (stock.stateCode ?? "sellable") === "sellable").reduce((sum: number, stock: any) => sum + Number(stock.qty ?? 0), 0),
    inTransitQty: 0,
    totalCostRub: stocks.reduce((sum: number, stock: any) => sum + Number(stock.costRub ?? 0), 0)
  };
  const rows = stocks.map((stock: any) => {
    const product = products.find((product: any) => product.id === stock.productId);
    const productMovements = movements.filter((movement: any) => movement.productId === stock.productId).slice().sort((left: any, right: any) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
    return { stock, product, lastMovement: productMovements[0] };
  });
  const selectedLots = lots.filter((lot: any) => lot.productId === selectedProductId);
  const selectedDocuments = selectedLots
    .map((lot: any) => documents.find((document: any) => document.id === lot.sourceDocumentId))
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Точка продаж: ${wh?.name ?? "—"}`}
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Точка продаж" }]}
        actions={<Button asChild><Link to={`/inventory/transfers/new?targetWarehouseId=${id}`}>Переместить сюда</Link></Button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <InlineMetric label="Book qty" value={`${qty(summary.bookQty)} шт`} />
        <InlineMetric label="In transit" value={`${qty(summary.inTransitQty)} шт`} />
        <InlineMetric label="Available" value={`${qty(summary.availableQty)} шт`} />
        <InlineMetric label="Total cost" value={rub(summary.totalCostRub)} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Card className="renderPanel">
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Товар</TH><TH>Состояние</TH><TH numeric>Book qty</TH><TH numeric>Cost remaining</TH><TH>Last movement</TH></TR></THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={`${row.stock.productId}-${row.stock.stateCode ?? "sellable"}`} interactive selected={row.stock.productId === selectedProductId} onClick={() => setSelectedProductId(row.stock.productId)}>
                    <TD><ProductCell product={row.product} /></TD>
                    <TD><Badge tone="neutral">{stockStateLabel[row.stock.stateCode ?? "sellable"] ?? row.stock.stateCode ?? "—"}</Badge></TD>
                    <TD numeric className="font-semibold">{qty(row.stock.qty)}</TD>
                    <TD numeric>{rub(row.stock.costRub)}</TD>
                    <TD>
                      {row.lastMovement ? (
                        <div className="flex flex-col">
                          <span>{date(row.lastMovement.occurredAt)}</span>
                          <span className="text-[11px] text-[var(--color-muted-foreground)]">{movementTypeLabel[row.lastMovement.movementType] ?? row.lastMovement.movementType}</span>
                        </div>
                      ) : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit sticky top-20">
          <CardHeader><CardTitle>Партии товара</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {selectedLots.length === 0 ? (
              <div className="text-sm text-[var(--color-muted-foreground)]">Выберите товар слева, чтобы увидеть партии и документы происхождения.</div>
            ) : (
              <>
                {selectedLots.map((lot: any) => (
                  <div key={lot.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs">{lot.id}</span>
                      <span>{qty(lot.qtyRemaining)} / {qty(lot.qtyInitial)} шт</span>
                    </div>
                    <div className="mt-1 text-[var(--color-muted-foreground)]">{rub(lot.costRemainingRub)} осталось · {rub(lot.unitCostRub, { precise: true })}/шт</div>
                  </div>
                ))}
                <div className="border-t border-[var(--color-border)] pt-3">
                  <div className="text-xs uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)] mb-2">Документная цепочка</div>
                  <div className="flex flex-col gap-2">
                    {selectedDocuments.map((document: any) => (
                      <Link key={document.id} to={`/documents/${document.id}`} className="text-sm text-[var(--color-primary)] hover:underline">
                        {document.number} · {date(document.accountingDate)}
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}

export function InventoryReconciliationPage() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const rows = useMemo(() => buildReconciliationRows(state), [state]);
  const warehouses = state.warehouses ?? [];
  const filtered = rows.filter((row) => {
    if (warehouseId && row.warehouseId !== warehouseId) return false;
    if (sourceFilter && row.sourceType !== sourceFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    if (search) {
      const haystack = `${row.product?.name ?? ""} ${row.product?.sku ?? ""} ${row.sourceLabel} ${row.warehouse?.name ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  useEffect(() => {
    setPage(1);
  }, [warehouseId, sourceFilter, statusFilter, search]);

  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = paged.find((row) => row.id === selectedId) ?? paged[0];

  const refreshObserved = useMutation({
    mutationFn: async (row: ReconciliationRow) => {
      if (!row.channelId) throw new Error("У строки нет канала наблюдения");
      return apiPost(`/api/integrations/channels/${row.channelId}/sync-runs`, { streams: ["stocks"], mode: "incremental", since: row.observedAt?.slice(0, 10) });
    },
    onSuccess: () => queryClient.invalidateQueries()
  });
  const ignore = useMutation({
    mutationFn: (row: ReconciliationRow) => apiPost(`/api/inventory/reconciliation/${row.id}/ignore`, {}),
    onSuccess: () => queryClient.invalidateQueries()
  });

  const totals = {
    bookQty: filtered.reduce((sum, row) => sum + row.bookQty, 0),
    observedQty: filtered.reduce((sum, row) => sum + row.observedQty, 0),
    diffQty: filtered.reduce((sum, row) => sum + row.diffQty, 0),
    diffCostRub: filtered.reduce((sum, row) => sum + row.diffCostRub, 0),
    open: filtered.filter((row) => row.status !== "matched" && row.status !== "ignored").length
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Сверка остатков"
        subtitle="Сравниваем учётный остаток с фактическим или наблюдаемым из канала. Расхождения решаются отдельным документом."
        breadcrumbs={[{ label: "Склад", to: "/inventory" }, { label: "Сверка" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => selected && navigate(`/inventory/reconciliation/${selected.id}/resolve`)} disabled={!selected}>
              Создать инвентаризацию
            </Button>
            <Button variant="secondary" onClick={() => selected && navigate(`/inventory/reconciliation/${selected.id}/resolve`)} disabled={!selected}>
              Разобрать расхождение
            </Button>
            <Button onClick={() => selected && refreshObserved.mutate(selected)} disabled={!selected || !selected.channelId || refreshObserved.isPending}>
              <RefreshCcw size={14} /> Обновить наблюдения
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <InlineMetric label="Книжный остаток" value={`${qty(totals.bookQty)} шт`} />
        <InlineMetric label="Наблюдаемый остаток" value={`${qty(totals.observedQty)} шт`} />
        <InlineMetric label="Разница, шт" value={`${totals.diffQty > 0 ? "+" : ""}${qty(totals.diffQty)} шт`} />
        <InlineMetric label="Разница, RUB" value={rub(totals.diffCostRub)} />
        <InlineMetric label="Открытые расхождения" value={String(totals.open)} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="w-52">
            <option value="">Все склады / точки</option>
            {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </Select>
          <Select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="w-44">
            <option value="">Все источники</option>
            <option value="channel">Канал</option>
            <option value="stocktake">Инвентаризация</option>
          </Select>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-44">
            <option value="">Все статусы</option>
            <option value="needs_resolution">Требует разбора</option>
            <option value="matched">Совпадает</option>
            <option value="ignored">Игнор</option>
            <option value="draft">Черновик</option>
          </Select>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по SKU или товару" className="w-64" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Товар</TH><TH>SKU</TH><TH>Склад / точка</TH><TH numeric>Книжный остаток</TH><TH numeric>Наблюдаемый остаток</TH><TH numeric>Разница</TH><TH numeric>Влияние</TH><TH>Источник</TH><TH>Статус</TH></TR></THead>
              <TBody>
                {filtered.length === 0 ? (
                  <TR><TD colSpan={9} className="text-center py-10 text-[var(--color-muted-foreground)]">Сначала синхронизируйте канал или проведите инвентаризацию</TD></TR>
                ) : (
                  paged.map((row) => (
                    <TR key={row.id} interactive selected={row.id === selected?.id} onClick={() => setSelectedId(row.id)}>
                      <TD><ProductCell product={row.product} /></TD>
                      <TD muted className="font-mono text-xs">{row.product?.sku ?? "—"}</TD>
                      <TD>{row.warehouse?.name ?? "—"}</TD>
                      <TD numeric>{qty(row.bookQty)}</TD>
                      <TD numeric>{qty(row.observedQty)}</TD>
                      <TD numeric className={row.diffQty < 0 ? "text-[var(--color-danger)] font-semibold" : row.diffQty > 0 ? "text-[var(--color-success)] font-semibold" : ""}>{row.diffQty > 0 ? "+" : ""}{qty(row.diffQty)}</TD>
                      <TD numeric className={row.diffCostRub < 0 ? "text-[var(--color-danger)] font-semibold" : row.diffCostRub > 0 ? "text-[var(--color-success)] font-semibold" : ""}>{rub(row.diffCostRub)}</TD>
                      <TD muted className="text-xs">{row.sourceLabel}</TD>
                      <TD><Badge tone={reconciliationTone(row.status)}>{reconciliationLabel(row.status)}</Badge></TD>
                    </TR>
                  ))
                )}
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

        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader className="min-w-0">
            <div className="min-w-0">
              <CardTitle>Детали расхождения</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 flex flex-col gap-4">
            {!selected ? (
              <EmptyState icon={<TriangleAlert size={18} />} title="Строка не выбрана" />
            ) : (
              <>
                <ProductCell product={selected.product} />
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <InfoCard label="Склад / точка" value={selected.warehouse?.name ?? "—"} />
                  <InfoCard label="Книжный остаток" value={`${qty(selected.bookQty)} шт (${rub(selected.bookCostRub)})`} />
                  <InfoCard label="Наблюдаемый остаток" value={`${qty(selected.observedQty)} шт`} />
                  <InfoCard label="Разница" value={`${selected.diffQty > 0 ? "+" : ""}${qty(selected.diffQty)} шт (${rub(selected.diffCostRub)})`} />
                  <InfoCard label="Источник" value={selected.sourceLabel} />
                  <InfoCard label="Последнее обновление" value={selected.observedAt ? date(selected.observedAt) : "—"} />
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-soft)]/35 p-3 text-sm">
                  <div className="font-semibold mb-1">Рекомендуемое действие</div>
                  <div className="text-[var(--color-muted-foreground)]">
                    {selected.diffQty < 0 ? "Списать недостачу отдельным документом." : selected.diffQty > 0 ? "Оприходовать излишек отдельным документом." : "Расхождение отсутствует."}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => navigate(`/inventory/reconciliation/${selected.id}/resolve`)}>Разобрать расхождение</Button>
                  <Button variant="secondary" onClick={() => selected.channelId && refreshObserved.mutate(selected)} disabled={!selected.channelId || refreshObserved.isPending}>Обновить наблюдения</Button>
                  <Button variant="ghost" onClick={() => ignore.mutate(selected)} disabled={ignore.isPending}>Игнорировать</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function StockAdjustmentPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rows = useMemo(() => buildReconciliationRows(state), [state]);
  const row = rows.find((candidate) => candidate.id === id);
  const [accountingDate, setAccountingDate] = useState(row?.observedAt?.slice(0, 10) ?? today());
  const [action, setAction] = useState<"writeoff" | "receipt" | "ignore">(row && row.diffQty > 0 ? "receipt" : "writeoff");
  const [warehouseId, setWarehouseId] = useState(row?.warehouseId ?? "");
  const [stateCode, setStateCode] = useState("sellable");
  const [qtyValue, setQtyValue] = useState(String(Math.abs(row?.diffQty ?? 0)));
  const [unitCostRub, setUnitCostRub] = useState(String(Math.abs(row?.unitCostRub ?? 0)));
  const [reason, setReason] = useState(row && row.diffQty > 0 ? "Излишек по инвентаризации" : "Потеря при хранении");
  const [comment, setComment] = useState(row ? `Расхождение по товару ${row.product?.sku ?? row.id}` : "");

  const saveDraft = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("Расхождение не найдено");
      if (action === "ignore") return apiPost(`/api/inventory/reconciliation/${row.id}/ignore`, {});
      return apiPost(`/api/inventory/reconciliation/${row.id}/resolve`, {
        warehouseId,
        stocktakeDate: accountingDate,
        comment,
        post: false,
        lines: [{ productId: row.productId, observedQty: targetObservedQty(row.bookQty, Number(qtyValue), action), unitCostRub: Number(unitCostRub) || undefined }]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate("/inventory/reconciliation");
    }
  });
  const post = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("Расхождение не найдено");
      if (action === "ignore") return apiPost(`/api/inventory/reconciliation/${row.id}/ignore`, {});
      const created = await apiPost<any>(`/api/inventory/reconciliation/${row.id}/resolve`, {
        warehouseId,
        stocktakeDate: accountingDate,
        comment,
        post: false,
        lines: [{ productId: row.productId, observedQty: targetObservedQty(row.bookQty, Number(qtyValue), action), unitCostRub: Number(unitCostRub) || undefined }]
      });
      return apiPost(`/api/inventory/adjustments/${created.id}/post`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate("/inventory/reconciliation");
    }
  });

  if (!row) {
    return (
      <div>
        <PageHeader title="Решение по расхождению" breadcrumbs={[{ label: "Сверка", to: "/inventory/reconciliation" }]} subtitle="Расхождение не найдено" />
      </div>
    );
  }

  const fifoPreview = previewFifoLots(state.inventoryLots ?? [], state.documents ?? [], row.productId, warehouseId || row.warehouseId, Number(qtyValue) || 0);
  const totalAdjustmentRub = action === "ignore" ? 0 : round2((Number(qtyValue) || 0) * (Number(unitCostRub) || 0));
  const stockAccount = inventoryAccountForWarehouse(row.warehouse?.warehouseType);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Решение по расхождению"
        subtitle="Отдельный документ сверки не меняет исходное наблюдение, а фиксирует учетное решение."
        breadcrumbs={[{ label: "Сверка", to: "/inventory/reconciliation" }, { label: row.product?.sku ?? row.id }]}
      />

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 py-5">
              <div className="md:col-span-2"><ProductCell product={row.product} /></div>
              <InfoCard label="Книжный остаток" value={`${qty(row.bookQty)} шт`} />
              <InfoCard label="Наблюдаемый остаток" value={`${qty(row.observedQty)} шт`} />
              <InfoCard label="Разница" value={`${row.diffQty > 0 ? "+" : ""}${qty(row.diffQty)} шт`} />
              <InfoCard label="Склад / точка" value={row.warehouse?.name ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Решение по расхождению</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5">
              <Field label="Дата учета" required><Input type="date" value={accountingDate} onChange={(event) => setAccountingDate(event.target.value)} /></Field>
              <Field label="Действие" required>
                <Select value={action} onChange={(event) => setAction(event.target.value as "writeoff" | "receipt" | "ignore")}>
                  <option value="writeoff">Списать недостачу</option>
                  <option value="receipt">Оприходовать излишек</option>
                  <option value="ignore">Игнорировать</option>
                </Select>
              </Field>
              <Field label="Склад / точка" required>
                <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                  {(state.warehouses ?? []).map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </Select>
              </Field>
              <Field label="Состояние" required>
                <Select value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
                  <option value="sellable">Годный</option>
                  <option value="damaged">Поврежден</option>
                  <option value="lost_pending">Утеряно</option>
                </Select>
              </Field>
              <Field label="Количество" required><Input type="number" value={qtyValue} onChange={(event) => setQtyValue(event.target.value)} /></Field>
              <Field label="Себестоимость единицы" required={action === "receipt"}><Input type="number" value={unitCostRub} onChange={(event) => setUnitCostRub(event.target.value)} disabled={action === "ignore"} /></Field>
              <Field label="Причина" required><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
              <div className="md:col-span-2">
                <Field label="Комментарий"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader><CardTitle>Затронутые партии</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead><TR><TH>Партия</TH><TH>Поступление</TH><TH>Источник</TH><TH numeric>Доступно</TH><TH numeric>Списание</TH><TH numeric>Сумма</TH></TR></THead>
                <TBody>
                  {fifoPreview.length === 0 ? (
                    <TR><TD colSpan={6} className="text-center py-8 text-[var(--color-muted-foreground)]">Для этого решения партии не списываются или остатка недостаточно.</TD></TR>
                  ) : (
                    fifoPreview.map((item) => (
                      <TR key={item.lot.id}>
                        <TD muted className="font-mono text-xs">{item.lot.id}</TD>
                        <TD muted className="numeric">{date(item.lot.receivedAt)}</TD>
                        <TD>{item.document ? <Link to={`/documents/${item.document.id}`} className="text-[var(--color-primary)] hover:underline">{item.document.number}</Link> : "—"}</TD>
                        <TD numeric>{qty(item.lot.qtyRemaining)}</TD>
                        <TD numeric>{qty(item.qtyToConsume)}</TD>
                        <TD numeric>{rub(item.costRub)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" asChild><Link to="/inventory/reconciliation">Отмена</Link></Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}><Save size={14} /> Сохранить черновик</Button>
              <Button onClick={() => post.mutate()} disabled={post.isPending}><Save size={14} /> Провести решение</Button>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card className="h-fit sticky top-20 min-w-0 overflow-hidden">
            <CardHeader className="min-w-0"><CardTitle>Предпросмотр проводки</CardTitle></CardHeader>
            <CardContent className="min-w-0 flex flex-col gap-4">
              {action === "ignore" ? (
                <div className="text-sm text-[var(--color-muted-foreground)]">Игнорирование не формирует проводки, а только снимает строку из активной очереди разбора.</div>
              ) : (
                <>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                    {action === "writeoff"
                      ? <div>Дт 94 / Кт {stockAccount} на {rub(totalAdjustmentRub)}</div>
                      : <div>Дт {stockAccount} / Кт 91.01 на {rub(totalAdjustmentRub)}</div>}
                  </div>
                  <InfoCard label="Книжный остаток после проведения" value={`${qty(action === "writeoff" ? row.bookQty - Number(qtyValue || 0) : row.bookQty + Number(qtyValue || 0))} шт`} />
                  <InfoCard label="Разница после проведения" value="0 шт" />
                  <InfoCard label="Сумма решения" value={rub(totalAdjustmentRub)} />
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-semibold mt-1 numeric">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}

type ReconciliationRow = {
  id: string;
  sourceType: "channel" | "stocktake";
  sourceLabel: string;
  status: "needs_resolution" | "matched" | "ignored" | "draft";
  productId: string;
  product?: any;
  warehouseId: string;
  warehouse?: any;
  channelId?: string;
  bookQty: number;
  observedQty: number;
  diffQty: number;
  unitCostRub: number;
  bookCostRub: number;
  diffCostRub: number;
  observedAt?: string;
};

function buildReconciliationRows(state: any): ReconciliationRow[] {
  const stockStates = state.stockStates ?? [];
  const products = state.products ?? [];
  const warehouses = state.warehouses ?? [];
  const channels = state.salesChannels ?? [];
  const externalProducts = state.externalProducts ?? [];
  const stocktakeLines = state.stocktakeLines ?? [];
  const stocktakes = state.stocktakes ?? [];
  const documents = state.documents ?? [];

  const observedRows = (state.observedStocks ?? []).map((observed: any) => {
    const channel = channels.find((candidate: any) => candidate.id === observed.channelId);
    const externalProduct = externalProducts.find((candidate: any) => candidate.id === observed.externalProductId);
    const productId = observed.productId ?? state.productExternalLinks?.find((link: any) => link.externalProductId === observed.externalProductId)?.productId;
    const product = products.find((candidate: any) => candidate.id === productId);
    const warehouseId = observed.warehouseId ?? channel?.salesPointWarehouseId;
    const warehouse = warehouses.find((candidate: any) => candidate.id === warehouseId);
    const book = stockStates.find((candidate: any) => candidate.productId === productId && candidate.warehouseId === warehouseId) ?? { qty: 0, costRub: 0 };
    const diffQty = round4((observed.qtyObserved ?? 0) - (book.qty ?? 0));
    const unitCostRub = book.qty > 0 ? round4(book.costRub / book.qty) : 0;
    return {
      id: observed.id,
      sourceType: "channel" as const,
      sourceLabel: channel ? `Канал: ${channel.name}` : `Канал ${observed.channelId}`,
      status: observed.locationStatus === "needs_location" ? "ignored" as const : diffQty === 0 ? "matched" as const : "needs_resolution" as const,
      productId,
      product: product ?? { id: externalProduct?.id, sku: externalProduct?.externalSku, name: externalProduct?.externalName, imageUrl: externalProduct?.imageUrl },
      warehouseId,
      warehouse,
      channelId: observed.channelId,
      bookQty: book.qty ?? 0,
      observedQty: observed.qtyObserved ?? 0,
      diffQty,
      unitCostRub,
      bookCostRub: book.costRub ?? 0,
      diffCostRub: round2(diffQty * unitCostRub),
      observedAt: observed.observedAt
    };
  });

  const stocktakeRows = stocktakeLines
    .filter((line: any) => Math.abs(line.differenceQty ?? 0) > 0.0001)
    .map((line: any) => {
      const stocktake = stocktakes.find((candidate: any) => candidate.id === line.stocktakeId);
      const product = products.find((candidate: any) => candidate.id === line.productId);
      const warehouse = warehouses.find((candidate: any) => candidate.id === stocktake?.warehouseId);
      const document = documents.find((candidate: any) => candidate.id === stocktake?.documentId);
      return {
        id: line.id,
        sourceType: "stocktake" as const,
        sourceLabel: document ? `Инвентаризация ${document.number}` : "Инвентаризация",
        status: stocktake?.status === "draft" ? "draft" as const : line.differenceQty === 0 ? "matched" as const : "needs_resolution" as const,
        productId: line.productId,
        product,
        warehouseId: stocktake?.warehouseId,
        warehouse,
        bookQty: line.bookQty,
        observedQty: line.observedQty,
        diffQty: line.differenceQty,
        unitCostRub: line.differenceQty !== 0 ? round4(Math.abs(line.adjustmentCostRub / line.differenceQty)) : 0,
        bookCostRub: line.bookCostRub,
        diffCostRub: round2(line.differenceQty >= 0 ? line.adjustmentCostRub : -line.adjustmentCostRub),
        observedAt: stocktake?.stocktakeDate
      };
    });

  return [...observedRows, ...stocktakeRows];
}

function reconciliationTone(status: ReconciliationRow["status"]): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "matched") return "success";
  if (status === "needs_resolution") return "warning";
  if (status === "ignored") return "neutral";
  return "info";
}

function reconciliationLabel(status: ReconciliationRow["status"]) {
  if (status === "matched") return "Совпадает";
  if (status === "needs_resolution") return "Требует разбора";
  if (status === "ignored") return "Игнор";
  return "Черновик";
}

function targetObservedQty(bookQty: number, qtyValue: number, action: "writeoff" | "receipt" | "ignore") {
  if (action === "receipt") return round4(bookQty + qtyValue);
  if (action === "writeoff") return round4(Math.max(0, bookQty - qtyValue));
  return bookQty;
}

function previewFifoLots(lots: any[], documents: any[], productId: string, warehouseId: string, qtyNeeded: number) {
  let remaining = qtyNeeded;
  return lots
    .filter((lot) => lot.productId === productId && lot.warehouseId === warehouseId && lot.qtyRemaining > 0)
    .sort((left, right) => String(left.receivedAt).localeCompare(String(right.receivedAt)))
    .map((lot) => {
      const qtyToConsume = remaining > 0 ? Math.min(remaining, lot.qtyRemaining) : 0;
      remaining = round4(Math.max(0, remaining - qtyToConsume));
      return {
        lot,
        document: documents.find((document: any) => document.id === lot.sourceDocumentId),
        qtyToConsume,
        costRub: round2(qtyToConsume * lot.unitCostRub)
      };
    })
    .filter((item) => item.qtyToConsume > 0);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function inventoryAccountForWarehouse(warehouseType?: string) {
  if (warehouseType === "transit") return "41.02";
  if (warehouseType === "sales_point") return "41.03";
  return "41.01";
}

function inventoryAccountLabel(warehouseType?: string) {
  if (warehouseType === "transit") return "Товары в пути";
  if (warehouseType === "sales_point") return "Товары на точках продаж";
  return "Товары на своём складе";
}

function formatPeriodLabel(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
}
