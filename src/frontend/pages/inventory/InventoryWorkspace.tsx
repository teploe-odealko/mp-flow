import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Database, HelpCircle, Package, Plus, Search, Store, Truck, Warehouse } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { ProductCell } from "@/components/product-thumb";
import { EmptyState } from "@/components/ui/empty-state";
import { apiGet } from "@/api";
import { date, qty, rub } from "@/lib/format";
import { stockStateLabel, warehouseTypeLabel } from "@/lib/i18n";
import { paginateRows } from "@/lib/pagination";

const STOCK_STATE_OPTIONS = ["sellable", "damaged", "lost_pending", "reserved"] as const;
const INVENTORY_WORKSPACE_QUERY_KEY = ["inventory-workspace"] as const;

interface InventoryWorkspacePayload {
  stockStates: any[];
  products: any[];
  warehouses: any[];
  documents: any[];
  stockMovements: any[];
}

export function InventoryWorkspace() {
  const workspaceQuery = useQuery({
    queryKey: INVENTORY_WORKSPACE_QUERY_KEY,
    queryFn: () => apiGet<InventoryWorkspacePayload>("/api/inventory/workspace")
  });
  const stocks = workspaceQuery.data?.stockStates ?? [];
  const products = workspaceQuery.data?.products ?? [];
  const warehouses = workspaceQuery.data?.warehouses ?? [];
  const documents = workspaceQuery.data?.documents ?? [];
  const movements = workspaceQuery.data?.stockMovements ?? [];

  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [onlyWithStock, setOnlyWithStock] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const enriched = useMemo(() => {
    return stocks.map((stock: any) => {
      const product = products.find((candidate: any) => candidate.id === stock.productId);
      const warehouse = warehouses.find((candidate: any) => candidate.id === stock.warehouseId);
      const relatedMovements = movements
        .filter((movement: any) =>
          movement.productId === stock.productId &&
          movement.warehouseId === stock.warehouseId &&
          (movement.stockStateCode ?? "sellable") === (stock.stateCode ?? "sellable")
        )
        .slice()
        .sort((left: any, right: any) => right.occurredAt.localeCompare(left.occurredAt));
      const lastMovement = relatedMovements[0];
      const lastDocument = documents.find((document: any) => document.id === lastMovement?.documentId);
      const averageUnitCostRub = Number(stock.qty) > 0 ? Number(stock.costRub) / Number(stock.qty) : 0;
      return {
        key: `${stock.productId}:${stock.warehouseId}:${stock.stateCode ?? "sellable"}`,
        stock,
        product,
        warehouse,
        lastMovement,
        lastDocument,
        averageUnitCostRub
      };
    });
  }, [documents, movements, products, stocks, warehouses]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enriched.filter((row) => {
      if (warehouseFilter && row.warehouse?.id !== warehouseFilter) return false;
      if (stateFilter && (row.stock.stateCode ?? "sellable") !== stateFilter) return false;
      if (productFilter && row.product?.id !== productFilter) return false;
      if (onlyWithStock && Number(row.stock.qty) <= 0) return false;
      if (query && !`${row.product?.sku ?? ""} ${row.product?.name ?? ""} ${row.warehouse?.name ?? ""}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [enriched, onlyWithStock, productFilter, search, stateFilter, warehouseFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, warehouseFilter, stateFilter, productFilter, onlyWithStock]);

  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = paged.find((row) => row.key === selectedKey) ?? paged[0];
  const ownCost = enriched.filter((row) => row.warehouse?.warehouseType === "own").reduce((sum, row) => sum + Number(row.stock.costRub ?? 0), 0);
  const transitCost = enriched.filter((row) => row.warehouse?.warehouseType === "transit").reduce((sum, row) => sum + Number(row.stock.costRub ?? 0), 0);
  const salesPointCost = enriched.filter((row) => row.warehouse?.warehouseType === "sales_point").reduce((sum, row) => sum + Number(row.stock.costRub ?? 0), 0);
  const problemCost = enriched
    .filter((row) => ["damaged", "lost_pending"].includes(row.stock.stateCode ?? "") || Number(row.stock.qty) < 0 || Number(row.stock.costRub) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.stock.costRub ?? 0)), 0);
  const totalCost = enriched.reduce((sum, row) => sum + Number(row.stock.costRub ?? 0), 0);

  if (products.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Склад и остатки"
          subtitle="Книжный остаток появляется только после того, как в системе заведены товары."
        />
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Package size={20} />}
              title="Сначала создайте товар"
              description="Стартовый остаток оформляется документом и создает актив на балансе. Без карточек товаров вводить остатки нельзя."
              action={<Button asChild><Link to="/products/new">Создать товар</Link></Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Склад и остатки"
        subtitle="Книжный товарный остаток по местам хранения и состояниям без привязки к конкретному маркетплейсу."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link to="/inventory/transfers/new"><Truck size={14} /> Перемещение</Link>
            </Button>
            <Button asChild>
              <Link to="/inventory/opening-balances/new"><Plus size={14} /> Создать стартовый остаток</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="success" icon={<Warehouse size={18} />} label="Свой склад" value={rub(ownCost)} />
        <Kpi tone="info" icon={<Truck size={18} />} label="В пути" value={rub(transitCost)} />
        <Kpi tone="primary" icon={<Store size={18} />} label="Точки продаж" value={rub(salesPointCost)} />
        <Kpi tone={problemCost > 0 ? "warning" : "neutral"} icon={<HelpCircle size={18} />} label="Проблемные" value={rub(problemCost)} />
        <Kpi tone="neutral" icon={<Database size={18} />} label="Себестоимость остатка" value={rub(totalCost)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <Card className="renderPanel min-w-0">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input className="pl-9" placeholder="Поиск по товару, SKU или складу" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="w-44">
                <option value="">Склад: все</option>
                {warehouses.map((warehouse: any) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </Select>
              <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="w-44">
                <option value="">Состояние: все</option>
                {STOCK_STATE_OPTIONS.map((stateCode) => (
                  <option key={stateCode} value={stateCode}>{stockStateLabel[stateCode]}</option>
                ))}
              </Select>
              <Select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="w-48">
                <option value="">Товар: все</option>
                {products.map((product: any) => (
                  <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                ))}
              </Select>
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-foreground)]">
                <input type="checkbox" checked={onlyWithStock} onChange={(event) => setOnlyWithStock(event.target.checked)} />
                Только с остатком
              </label>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/inventory/movements">Движения <ArrowRight size={13} /></Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/inventory/reconciliation">Сверка</Link>
              </Button>
            </div>

            {enriched.length === 0 ? (
              <div className="py-12 px-5">
                <EmptyState
                  icon={<Package size={20} />}
                  title="Остатков пока нет"
                  description="После проведения стартового остатка появятся партии FIFO, складские движения и проводка по счету 41."
                  action={<Button asChild><Link to="/inventory/opening-balances/new">Создать стартовый остаток</Link></Button>}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Товар</TH>
                    <TH className="w-36">SKU</TH>
                    <TH>Склад</TH>
                    <TH className="w-36">Состояние</TH>
                    <TH numeric className="w-24">Кол-во</TH>
                    <TH numeric className="w-40">Себестоимость остатка</TH>
                    <TH numeric className="w-40">Средняя себест.</TH>
                    <TH className="w-44">Последний документ</TH>
                    <TH className="w-32">Дата движения</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.length === 0 && (
                    <TR>
                      <TD colSpan={9} className="text-center py-10 text-[var(--color-muted-foreground)]">По фильтрам ничего не найдено</TD>
                    </TR>
                  )}
                  {paged.map((row) => (
                    <TR key={row.key} interactive selected={row.key === selected?.key} onClick={() => setSelectedKey(row.key)}>
                      <TD><ProductCell product={row.product} /></TD>
                      <TD className="font-mono text-xs font-semibold">{row.product?.sku ?? "—"}</TD>
                      <TD>
                        <div className="font-medium">{row.warehouse?.name ?? "—"}</div>
                        <div className="text-[11px] text-[var(--color-muted-foreground)]">{warehouseTypeLabel[row.warehouse?.warehouseType ?? ""] ?? "—"}</div>
                      </TD>
                      <TD>
                        <Badge tone={["damaged", "lost_pending"].includes(row.stock.stateCode ?? "") ? "warning" : "success"}>
                          {stockStateLabel[row.stock.stateCode ?? "sellable"] ?? row.stock.stateCode ?? "—"}
                        </Badge>
                      </TD>
                      <TD numeric className="font-semibold">{qty(row.stock.qty)} {row.product?.unit ?? ""}</TD>
                      <TD numeric className="font-semibold">{rub(row.stock.costRub)}</TD>
                      <TD numeric>{rub(row.averageUnitCostRub, { precise: true })}/шт</TD>
                      <TD>
                        {row.lastDocument ? (
                          <Link to={`/documents/${row.lastDocument.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">
                            {row.lastDocument.number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD muted className="numeric">{row.lastMovement ? date(row.lastMovement.occurredAt) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
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

        <aside className="flex flex-col gap-4 min-w-0">
          <Card className="h-fit sticky top-20">
            {selected ? (
              <CardContent className="flex flex-col gap-4 py-4">
                <div>
                  <div className="text-lg font-semibold">{selected.product?.name ?? "Остаток"}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)] font-mono mt-0.5">{selected.product?.sku ?? ""}</div>
                </div>

                <div className="space-y-2 text-sm">
                  <PreviewRow label="Склад" value={selected.warehouse?.name ?? "—"} />
                  <PreviewRow label="Состояние" value={stockStateLabel[selected.stock.stateCode ?? "sellable"] ?? "—"} />
                  <PreviewRow label="Количество" value={`${qty(selected.stock.qty)} ${selected.product?.unit ?? ""}`} />
                  <PreviewRow label="Себестоимость остатка" value={rub(selected.stock.costRub)} />
                  <PreviewRow label="Средняя себест./шт" value={`${rub(selected.averageUnitCostRub, { precise: true })}/шт`} />
                </div>

                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Последний источник</div>
                  {selected.lastDocument ? (
                    <>
                      <Link to={`/documents/${selected.lastDocument.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">
                        {selected.lastDocument.number}
                      </Link>
                      <div className="text-sm">{selected.lastDocument.title}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">{selected.lastMovement ? `от ${date(selected.lastMovement.occurredAt)}` : "Документ без движения"}</div>
                    </>
                  ) : (
                    <div className="text-sm text-[var(--color-muted-foreground)]">Движений пока не было</div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {selected.product && (
                    <Button asChild>
                      <Link to={`/products/${selected.product.id}`}>Открыть карточку товара</Link>
                    </Button>
                  )}
                  {selected.lastDocument && (
                    <Button variant="secondary" asChild>
                      <Link to={`/documents/${selected.lastDocument.id}`}>Просмотр документа</Link>
                    </Button>
                  )}
                  <Button variant="ghost" asChild>
                    <Link to="/inventory/opening-balances/new"><Plus size={14} /> Создать стартовый остаток</Link>
                  </Button>
                </div>

                <div className="text-xs text-[var(--color-muted-foreground)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 leading-relaxed">
                  Точки продаж здесь показаны как обычные места хранения. Привязка к кабинетам маркетплейсов подключается позже через интеграции.
                </div>
              </CardContent>
            ) : (
              <CardContent className="py-12 text-center text-sm text-[var(--color-muted-foreground)]">Выберите остаток в таблице</CardContent>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}
