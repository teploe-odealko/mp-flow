import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, ListTree, Package, Pencil, Search, Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductCell, ProductThumb } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiDelete } from "@/api";
import { date, qty, rub } from "@/lib/format";
import { documentStatusLabel, documentStatusTone, movementTypeLabel, stockStateLabel, warehouseTypeLabel } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StudioPanel } from "./PhotoStudioPanel";

export function ProductCardPage() {
  const { id } = useParams();
  const location = useLocation();
  const { state } = useAppState();
  const product = (state.products ?? []).find((candidate: any) => candidate.id === id);
  if (!product) return null;

  const warehouses = state.warehouses ?? [];
  const documents = state.documents ?? [];
  const journalEntries = state.journalEntries ?? [];
  const costApplications = state.costApplications ?? [];
  const externalProducts = state.externalProducts ?? [];
  const externalLinks = state.productExternalLinks ?? [];
  const salesChannels = state.salesChannels ?? [];
  const externalEvents = state.externalEvents ?? [];
  const queryClient = useQueryClient();

  const lots = useMemo(
    () => (state.inventoryLots ?? []).filter((lot: any) => lot.productId === id),
    [id, state.inventoryLots]
  );
  const hasOpenLots = useMemo(() => lots.some((lot: any) => Number(lot.qtyRemaining ?? 0) > 0), [lots]);
  const movements = useMemo(
    () => (state.stockMovements ?? []).filter((movement: any) => movement.productId === id),
    [id, state.stockMovements]
  );
  const balances = useMemo(
    () => (state.stockStates ?? []).filter((stock: any) => stock.productId === id),
    [id, state.stockStates]
  );
  const relatedDocuments = useMemo(() => {
    const ids = new Set<string>();
    lots.forEach((lot: any) => lot.sourceDocumentId && ids.add(lot.sourceDocumentId));
    movements.forEach((movement: any) => movement.documentId && ids.add(movement.documentId));
    return documents.filter((document: any) => ids.has(document.id));
  }, [documents, lots, movements]);
  const channelLinkRows = useMemo(() => {
    return externalLinks
      .filter((link: any) => link.productId === id && link.status === "active")
      .map((link: any) => {
        const external = externalProducts.find((candidate: any) => candidate.id === link.externalProductId);
        const channel = salesChannels.find((candidate: any) => candidate.id === link.channelId);
        return { link, external, channel };
      })
      .filter((row) => row.external);
  }, [externalLinks, externalProducts, id, salesChannels]);
  const unresolvedExternalEvents = externalEvents.filter((event: any) => event.productId === id && event.status !== "processed" && event.status !== "ignored");

  const [tab, setTab] = useState(location.pathname.endsWith("/lots") ? "lots" : "overview");

  const [lotSearch, setLotSearch] = useState("");
  const [lotWarehouse, setLotWarehouse] = useState("");
  const [lotState, setLotState] = useState("");
  const [lotSourceType, setLotSourceType] = useState("");
  const [lotDateFrom, setLotDateFrom] = useState("");
  const [lotDateTo, setLotDateTo] = useState("");
  const [openLotsOnly, setOpenLotsOnly] = useState(true);

  const [movementDateFrom, setMovementDateFrom] = useState(state.accountingPolicy?.accountingStartDate ?? "");
  const [movementDateTo, setMovementDateTo] = useState("");
  const [movementWarehouse, setMovementWarehouse] = useState("");
  const [movementState, setMovementState] = useState("");
  const [movementType, setMovementType] = useState("");
  const [movementDocumentType, setMovementDocumentType] = useState("");

  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);

  const lotRows = useMemo(() => {
    return lots
      .slice()
      .sort((left: any, right: any) => left.receivedAt.localeCompare(right.receivedAt) || left.id.localeCompare(right.id))
      .filter((lot: any) => {
        const document = relatedDocuments.find((candidate: any) => candidate.id === lot.sourceDocumentId);
        const sourceKey = sourceTypeKey(document?.documentType);
        if (openLotsOnly && hasOpenLots && lot.qtyRemaining <= 0) return false;
        if (lotWarehouse && lot.warehouseId !== lotWarehouse) return false;
        if (lotState && (lot.stockStateCode ?? "sellable") !== lotState) return false;
        if (lotSourceType && sourceKey !== lotSourceType) return false;
        if (lotDateFrom && lot.receivedAt < lotDateFrom) return false;
        if (lotDateTo && lot.receivedAt > lotDateTo) return false;
        if (lotSearch && !`${lot.id} ${document?.number ?? ""} ${document?.title ?? ""}`.toLowerCase().includes(lotSearch.toLowerCase())) return false;
        return true;
      })
      .map((lot: any) => {
        const warehouse = warehouses.find((candidate: any) => candidate.id === lot.warehouseId);
        const document = relatedDocuments.find((candidate: any) => candidate.id === lot.sourceDocumentId);
        const journalEntry = journalEntries.find((entry: any) => entry.documentId === lot.sourceDocumentId);
        const applications = costApplications
          .filter((application: any) => application.fromLotId === lot.id)
          .map((application: any) => ({
            ...application,
            outboundDocument: documents.find((document: any) => document.id === application.outboundDocumentId)
          }));
        return { lot, warehouse, document, journalEntry, applications };
      });
  }, [
    costApplications,
    hasOpenLots,
    documents,
    journalEntries,
    lotDateFrom,
    lotDateTo,
    lotSearch,
    lotSourceType,
    lotState,
    lotWarehouse,
    lots,
    openLotsOnly,
    relatedDocuments,
    warehouses
  ]);

  const movementRows = useMemo(() => {
    const chronological = movements
      .slice()
      .sort((left: any, right: any) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const runningByKey = new Map<string, number>();

    return chronological
      .map((movement: any) => {
        const key = `${movement.warehouseId}:${movement.stockStateCode ?? "sellable"}`;
        const nextBalance = round4((runningByKey.get(key) ?? 0) + Number(movement.qty ?? 0));
        runningByKey.set(key, nextBalance);
        const warehouse = warehouses.find((candidate: any) => candidate.id === movement.warehouseId);
        const document = documents.find((candidate: any) => candidate.id === movement.documentId);
        const lot = lots.find((candidate: any) => candidate.id === movement.lotId);
        return { movement, warehouse, document, lot, balanceAfter: nextBalance };
      })
      .filter((row) => {
        if (movementDateFrom && row.movement.occurredAt < movementDateFrom) return false;
        if (movementDateTo && row.movement.occurredAt > movementDateTo) return false;
        if (movementWarehouse && row.movement.warehouseId !== movementWarehouse) return false;
        if (movementState && (row.movement.stockStateCode ?? "sellable") !== movementState) return false;
        if (movementType && row.movement.movementType !== movementType) return false;
        if (movementDocumentType && row.document?.documentType !== movementDocumentType) return false;
        return true;
      });
  }, [
    documents,
    lots,
    movementDateFrom,
    movementDateTo,
    movementDocumentType,
    movementState,
    movementType,
    movementWarehouse,
    movements,
    warehouses
  ]);

  const selectedLot = lotRows.find((row) => row.lot.id === selectedLotId) ?? lotRows[0];
  const selectedMovement = movementRows.find((row) => row.movement.id === selectedMovementId) ?? movementRows.at(-1);
  const unlinkExternalLink = useMutation({
    mutationFn: (payload: { productId: string; linkId: string }) => apiDelete(`/api/products/${payload.productId}/external-links/${payload.linkId}`),
    onSuccess: () => queryClient.invalidateQueries()
  });

  const totalQty = balances.reduce((sum: number, stock: any) => sum + Number(stock.qty ?? 0), 0);
  const totalCostRub = balances.reduce((sum: number, stock: any) => sum + Number(stock.costRub ?? 0), 0);
  const averageCostRub = totalQty > 0 ? totalCostRub / totalQty : 0;
  const warehousesWithBalance = new Set(balances.filter((stock: any) => Number(stock.qty ?? 0) > 0).map((stock: any) => stock.warehouseId)).size;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Товары", to: "/products" }, { label: product.name }]}
        title={product.name}
        subtitle={`SKU: ${product.sku}${product.brand ? ` · Бренд: ${product.brand}` : ""}${product.manufacturerArticle ? ` · Артикул: ${product.manufacturerArticle}` : ""}`}
        badge={product.status === "active" ? <Badge tone="success">Активен</Badge> : <Badge tone="neutral">Архив</Badge>}
        actions={
          <div className="flex gap-2 specActions">
            <Button variant="ghost" asChild><Link to="/products"><ArrowLeft size={14} /> К списку</Link></Button>
            <Button variant="secondary" asChild><Link to={`/products/${id}/edit`}><Pencil size={14} /> Редактировать</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <CardContent className="flex flex-col gap-5 md:flex-row md:items-start py-5">
              <ProductThumb product={product} size={180} className="rounded-[var(--radius-lg)] border border-[var(--color-border)]" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                <IdentityStat label="SKU" value={product.sku} />
                <IdentityStat label="Единица" value={product.unit} />
                <IdentityStat label="Вес" value={product.weightGrams ? `${product.weightGrams} г` : "—"} />
                <IdentityStat label="Габариты" value={product.lengthMm ? `${product.lengthMm} × ${product.widthMm} × ${product.heightMm} мм` : "—"} />
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="contextTabs">
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="balances">Остатки</TabsTrigger>
              <TabsTrigger value="lots">Партии себестоимости</TabsTrigger>
              <TabsTrigger value="movements">Движения</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
              <TabsTrigger value="channels">Каналы продаж</TabsTrigger>
              <TabsTrigger value="studio">Студия</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card>
                  <CardContent className="py-5">
                    <div className="text-lg font-semibold mb-4">Основные данные</div>
                    <div className="grid grid-cols-[160px_1fr] gap-y-3 text-sm">
                      <OverviewRow label="SKU" value={product.sku} />
                      <OverviewRow label="Название" value={product.name} />
                      <OverviewRow label="Единица измерения" value={product.unit} />
                      <OverviewRow label="Бренд" value={product.brand ?? "Не указан"} />
                      <OverviewRow label="Фото" value={<ProductThumb product={product} size={64} />} />
                      <OverviewRow label="Описание" value={product.description ?? "—"} />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-5">
                    <div className="text-lg font-semibold mb-4">Логистика</div>
                    <div className="grid grid-cols-[160px_1fr] gap-y-3 text-sm">
                      <OverviewRow label="Вес" value={product.weightGrams ? `${product.weightGrams} г` : "—"} />
                      <OverviewRow label="Длина" value={product.lengthMm ? `${product.lengthMm} мм` : "—"} />
                      <OverviewRow label="Ширина" value={product.widthMm ? `${product.widthMm} мм` : "—"} />
                      <OverviewRow label="Высота" value={product.heightMm ? `${product.heightMm} мм` : "—"} />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-6">
                    {balances.length === 0 ? (
                      <EmptyState
                        icon={<Package size={20} />}
                        title="Остатки появятся после стартового остатка или приемки"
                        description="Здесь будет отображаться наличие на складах и в точках продаж."
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="text-lg font-semibold">Остатки</div>
                        <div className="text-sm text-[var(--color-muted-foreground)]">Текущий остаток по местам хранения и состояниям доступен на отдельной вкладке.</div>
                        <Button variant="secondary" onClick={() => setTab("balances")}>Открыть остатки</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-6">
                    {lots.length === 0 ? (
                      <EmptyState
                        icon={<ListTree size={20} />}
                        title="Партий пока нет"
                        description="Партии появятся после стартового остатка, приемки или корректировки стоимости."
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="text-lg font-semibold">Партии себестоимости</div>
                        <div className="text-sm text-[var(--color-muted-foreground)]">FIFO-очередь уже сформирована и используется для будущих списаний.</div>
                        <Button variant="secondary" onClick={() => setTab("lots")}>Открыть партии</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="balances">
              <Card className="renderPanel">
                <CardContent className="p-0">
                  {balances.length === 0 ? (
                    <EmptyState icon={<Package size={20} />} title="Остатки появятся после стартового остатка или приемки" />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Склад</TH>
                          <TH>Состояние</TH>
                          <TH numeric>Кол-во</TH>
                          <TH numeric>Средняя себест./шт</TH>
                          <TH numeric>Себестоимость остатка</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {balances.map((stock: any) => {
                          const warehouse = warehouses.find((candidate: any) => candidate.id === stock.warehouseId);
                          const averageUnitCostRub = Number(stock.qty) > 0 ? Number(stock.costRub) / Number(stock.qty) : 0;
                          return (
                            <TR key={`${stock.productId}:${stock.warehouseId}:${stock.stateCode ?? "sellable"}`}>
                              <TD>
                                <div className="font-medium">{warehouse?.name ?? "—"}</div>
                                <div className="text-[11px] text-[var(--color-muted-foreground)]">{warehouseTypeLabel[warehouse?.warehouseType ?? ""] ?? ""}</div>
                              </TD>
                              <TD><Badge tone="neutral">{stockStateLabel[stock.stateCode ?? "sellable"] ?? stock.stateCode ?? "—"}</Badge></TD>
                              <TD numeric className="font-semibold">{qty(stock.qty)} {product.unit}</TD>
                              <TD numeric>{formatRubPerUnit(averageUnitCostRub)}</TD>
                              <TD numeric className="font-semibold">{rub(stock.costRub)}</TD>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="lots">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                <MetricCard label="Остаток" value={`${qty(totalQty)} ${product.unit}`} hint="на всех складах" />
                <MetricCard label="Себестоимость остатка" value={rub(totalCostRub)} hint="по партиям FIFO" />
                <MetricCard label="Средняя себестоимость" value={formatRubPerUnit(averageCostRub)} hint="справочно" />
                <MetricCard label="Складов" value={warehousesWithBalance} hint="с остатком" />
                <MetricCard label="Открытых партий" value={lots.filter((lot: any) => lot.qtyRemaining > 0).length} hint={`из ${lots.length}`} />
              </div>

              <Card className="renderPanel">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
	                    <label className="flex items-center gap-2 px-3 py-2 text-sm">
	                      <input type="checkbox" checked={openLotsOnly && hasOpenLots} disabled={!hasOpenLots} onChange={(event) => setOpenLotsOnly(event.target.checked)} />
	                      Только открытые партии
	                    </label>
                    <Select value={lotWarehouse} onChange={(event) => setLotWarehouse(event.target.value)} className="w-44">
                      <option value="">Все склады</option>
                      {warehouses.map((warehouse: any) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </Select>
                    <Select value={lotState} onChange={(event) => setLotState(event.target.value)} className="w-44">
                      <option value="">Все состояния</option>
                      {Object.entries(stockStateLabel).map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </Select>
                    <Select value={lotSourceType} onChange={(event) => setLotSourceType(event.target.value)} className="w-44">
                      <option value="">Все источники</option>
                      <option value="opening">Стартовый остаток</option>
                      <option value="receipt">Приемка</option>
                      <option value="correction">Корректировка</option>
                    </Select>
                    <Input type="date" value={lotDateFrom} onChange={(event) => setLotDateFrom(event.target.value)} className="w-40" aria-label="Дата поступления от" />
                    <Input type="date" value={lotDateTo} onChange={(event) => setLotDateTo(event.target.value)} className="w-40" aria-label="Дата поступления до" />
                    <div className="relative min-w-[220px] flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                      <Input className="pl-9" placeholder="Поиск по партии или источнику" value={lotSearch} onChange={(event) => setLotSearch(event.target.value)} />
                    </div>
                  </div>
	                  {lotRows.length === 0 ? (
	                    <EmptyState
	                      icon={<ListTree size={20} />}
	                      title="Партий по выбранным фильтрам нет"
	                      description={lots.length > 0 && !hasOpenLots ? "Все партии уже полностью списаны продажами, поэтому открытых партий нет." : undefined}
	                    />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Партия</TH>
                          <TH>Дата поступления</TH>
                          <TH>Источник</TH>
                          <TH>Склад</TH>
                          <TH>Состояние</TH>
                          <TH numeric>Начальное</TH>
                          <TH numeric>Остаток</TH>
                          <TH numeric>Себестоимость ед.</TH>
                          <TH numeric>Стоимость остатка</TH>
                          <TH className="w-20">FIFO</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {lotRows.map((row, index) => (
                          <TR key={row.lot.id} interactive selected={row.lot.id === selectedLot?.lot.id} onClick={() => setSelectedLotId(row.lot.id)}>
                            <TD className="font-mono text-xs font-semibold">{row.lot.id}</TD>
                            <TD muted className="numeric">{date(row.lot.receivedAt)}</TD>
                            <TD>
                              {row.document ? (
                                <div className="flex flex-col">
                                  <span>{sourceTypeLabel(row.document.documentType)}</span>
                                  <Link to={`/documents/${row.document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{row.document.number}</Link>
                                </div>
                              ) : "—"}
                            </TD>
                            <TD>
                              <div className="font-medium">{row.warehouse?.name ?? "—"}</div>
                              <div className="text-[11px] text-[var(--color-muted-foreground)]">{warehouseTypeLabel[row.warehouse?.warehouseType ?? ""] ?? ""}</div>
                            </TD>
                            <TD><Badge tone="neutral">{stockStateLabel[row.lot.stockStateCode ?? "sellable"] ?? row.lot.stockStateCode ?? "—"}</Badge></TD>
                            <TD numeric>{qty(row.lot.qtyInitial)}</TD>
                            <TD numeric className="font-semibold">{qty(row.lot.qtyRemaining)}</TD>
                            <TD numeric>{formatRubPerUnit(row.lot.unitCostRub)}</TD>
                            <TD numeric>{rub(row.lot.costRemainingRub)}</TD>
                            <TD><Badge tone={index === 0 ? "primary" : "neutral"}>{index + 1}</Badge></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="movements">
              <Card className="renderPanel">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
                    <Input type="date" value={movementDateFrom} onChange={(event) => setMovementDateFrom(event.target.value)} className="w-40" aria-label="Период от" />
                    <Input type="date" value={movementDateTo} onChange={(event) => setMovementDateTo(event.target.value)} className="w-40" aria-label="Период до" />
                    <Select value={movementWarehouse} onChange={(event) => setMovementWarehouse(event.target.value)} className="w-44">
                      <option value="">Все склады</option>
                      {warehouses.map((warehouse: any) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </Select>
                    <Select value={movementState} onChange={(event) => setMovementState(event.target.value)} className="w-44">
                      <option value="">Все состояния</option>
                      {Object.entries(stockStateLabel).map(([code, label]) => (
                        <option key={code} value={code}>{label}</option>
                      ))}
                    </Select>
                    <Select value={movementType} onChange={(event) => setMovementType(event.target.value)} className="w-44">
                      <option value="">Все типы</option>
                      {Array.from<string>(new Set(movements.map((movement: any) => String(movement.movementType)))).map((type) => (
                        <option key={type} value={type}>{movementTypeLabel[type as keyof typeof movementTypeLabel] ?? type}</option>
                      ))}
                    </Select>
                    <Select value={movementDocumentType} onChange={(event) => setMovementDocumentType(event.target.value)} className="w-44">
                      <option value="">Все документы</option>
                      {Array.from<string>(new Set(relatedDocuments.map((document: any) => String(document.documentType)))).map((type) => (
                        <option key={type} value={type}>{sourceTypeLabel(type)}</option>
                      ))}
                    </Select>
                  </div>
                  {movementRows.length === 0 ? (
                    <EmptyState icon={<Truck size={20} />} title="Движений по выбранным фильтрам нет" />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Дата</TH>
                          <TH>Документ</TH>
                          <TH>Тип движения</TH>
                          <TH>Склад</TH>
                          <TH>Состояние</TH>
                          <TH numeric>Приход</TH>
                          <TH numeric>Расход</TH>
                          <TH numeric>Остаток после</TH>
                          <TH numeric>Сумма</TH>
                          <TH>Партия</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {movementRows.slice().reverse().map((row) => (
                          <TR key={row.movement.id} interactive selected={row.movement.id === selectedMovement?.movement.id} onClick={() => setSelectedMovementId(row.movement.id)}>
                            <TD muted className="numeric">{date(row.movement.occurredAt)}</TD>
                            <TD>
                              {row.document ? <Link to={`/documents/${row.document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{row.document.number}</Link> : "—"}
                            </TD>
                            <TD><Badge tone={row.movement.qty >= 0 ? "success" : "warning"}>{movementTypeLabel[row.movement.movementType] ?? row.movement.movementType}</Badge></TD>
                            <TD>
                              <div className="font-medium">{row.warehouse?.name ?? "—"}</div>
                              <div className="text-[11px] text-[var(--color-muted-foreground)]">{warehouseTypeLabel[row.warehouse?.warehouseType ?? ""] ?? ""}</div>
                            </TD>
                            <TD><Badge tone="neutral">{stockStateLabel[row.movement.stockStateCode ?? "sellable"] ?? row.movement.stockStateCode ?? "—"}</Badge></TD>
                            <TD numeric>{row.movement.qty > 0 ? qty(row.movement.qty) : "—"}</TD>
                            <TD numeric>{row.movement.qty < 0 ? qty(Math.abs(row.movement.qty)) : "—"}</TD>
                            <TD numeric>{qty(row.balanceAfter)}</TD>
                            <TD numeric>{rub(Math.abs(row.movement.costRub))}</TD>
                            <TD>
                              {row.lot ? (
                                <button
                                  type="button"
                                  className="text-[var(--color-primary)] hover:underline text-xs font-mono"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setTab("lots");
                                    setSelectedLotId(row.lot.id);
                                  }}
                                >
                                  {row.lot.id}
                                </button>
                              ) : "—"}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card className="renderPanel">
                <CardContent className="p-0">
                  {relatedDocuments.length === 0 ? (
                    <EmptyState icon={<FileText size={20} />} title="Связанных документов пока нет" />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Номер</TH>
                          <TH>Тип</TH>
                          <TH>Дата</TH>
                          <TH>Статус</TH>
                          <TH numeric>Сумма</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {relatedDocuments.map((document: any) => (
                          <TR key={document.id}>
                            <TD><Link to={`/documents/${document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{document.number}</Link></TD>
                            <TD>{sourceTypeLabel(document.documentType)}</TD>
                            <TD muted className="numeric">{date(document.accountingDate)}</TD>
                            <TD><Badge tone={documentStatusTone[document.status] ?? "neutral"}>{documentStatusLabel[document.status] ?? document.status}</Badge></TD>
                            <TD numeric>{rub(document.amountRub)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="channels">
              <Card className="renderPanel">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
                    <div>
                      <div className="font-semibold">Связи с внешними карточками</div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">Будущие события канала будут интерпретироваться через эти связи.</div>
                    </div>
                    <Button asChild><Link to={`/products/channel-mapping?search=${encodeURIComponent(product.sku)}`}>Добавить связь</Link></Button>
                  </div>
                  {channelLinkRows.length === 0 ? (
                    <EmptyState icon={<Package size={20} />} title="Связей с каналами пока нет" description="Создайте связь с внешней карточкой, чтобы продажи, остатки и события канала попадали в этот товар." />
                  ) : (
                    <Table>
                      <THead>
                        <TR><TH>Канал</TH><TH>Внешняя карточка</TH><TH>SKU</TH><TH>Статус</TH><TH>Действие</TH></TR>
                      </THead>
                      <TBody>
                        {channelLinkRows.map((row: any) => (
                          <TR key={row.link.id}>
                            <TD>{row.channel?.name ?? "—"}</TD>
                            <TD>{row.external?.externalName ?? "—"}</TD>
                            <TD muted className="font-mono text-xs">{row.external?.externalSku ?? "—"}</TD>
                            <TD><Badge tone={row.external?.status === "ignored" ? "neutral" : "success"}>{row.external?.status === "ignored" ? "Игнорируется" : "Связано"}</Badge></TD>
                            <TD>
                              <Button variant="ghost" size="sm" onClick={() => unlinkExternalLink.mutate({ productId: product.id, linkId: row.link.id })} disabled={unlinkExternalLink.isPending}>
                                Отвязать
                              </Button>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}

                  {unresolvedExternalEvents.length > 0 && (
                    <div className="border-t border-[var(--color-border)] px-4 py-3 text-sm">
                      <span className="text-[var(--color-muted-foreground)]">Есть необработанные события для этого товара.</span>{" "}
                      <Link to="/integrations/inbox" className="text-[var(--color-primary)] hover:underline">Открыть очередь событий</Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="studio">
              <StudioPanel productId={product.id} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          <Card className="h-fit sticky top-20">
            <CardContent className="flex flex-col gap-3 py-4">
              <MetricCard label="Остаток" value={`${qty(totalQty)} ${product.unit}`} />
              <MetricCard label="Себестоимость" value={rub(totalCostRub)} />
              <MetricCard label="Средняя себест./шт" value={formatRubPerUnit(averageCostRub)} />
              <MetricCard label="Открытых партий" value={lots.filter((lot: any) => lot.qtyRemaining > 0).length} />
              <MetricCard label="Движений" value={movements.length} />
              <MetricCard label="Документов" value={relatedDocuments.length} />
            </CardContent>
          </Card>

          {tab === "lots" && selectedLot && (
            <Card>
              <CardContent className="py-4 flex flex-col gap-3">
                <div className="text-base font-semibold">FIFO-очередь</div>
                <InfoRow label="Партия" value={selectedLot.lot.id} />
                <InfoRow label="Источник" value={selectedLot.document ? <Link to={`/documents/${selectedLot.document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{selectedLot.document.number}</Link> : "—"} />
                <InfoRow label="Проводка" value={selectedLot.journalEntry ? <Link to={`/reports/journal/${selectedLot.journalEntry.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{selectedLot.journalEntry.number}</Link> : "—"} />
                <InfoRow label="Склад" value={selectedLot.warehouse?.name ?? "—"} />
                <InfoRow label="Состояние" value={stockStateLabel[selectedLot.lot.stockStateCode ?? "sellable"] ?? "—"} />
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-xs text-[var(--color-muted-foreground)] leading-relaxed">
                  FIFO: партии с более ранней датой поступления списываются первыми.
                </div>
                {selectedLot.applications.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Связанные списания</div>
                    {selectedLot.applications.slice(0, 3).map((application: any) => (
                      <div key={application.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
                        <div className="font-medium">{application.outboundDocument?.title ?? "Списание"}</div>
                        <div className="text-xs text-[var(--color-muted-foreground)] mt-1">
                          {qty(application.qty)} шт · {rub(application.costRub)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-muted-foreground)]">Списания появятся после продаж, потерь или перемещений.</div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "movements" && selectedMovement && (
            <Card>
              <CardContent className="py-4 flex flex-col gap-3">
                <div className="text-base font-semibold">Происхождение себестоимости</div>
                <InfoRow label="Документ" value={selectedMovement.document ? <Link to={`/documents/${selectedMovement.document.id}`} className="text-[var(--color-primary)] hover:underline font-mono text-xs">{selectedMovement.document.number}</Link> : "—"} />
                <InfoRow label="Тип" value={movementTypeLabel[selectedMovement.movement.movementType] ?? selectedMovement.movement.movementType} />
                <InfoRow label="Количество" value={`${selectedMovement.movement.qty > 0 ? "+" : "-"}${qty(Math.abs(selectedMovement.movement.qty))} ${product.unit}`} />
                <InfoRow label="Себестоимость" value={rub(Math.abs(selectedMovement.movement.costRub))} />
                <InfoRow label="Остаток после" value={`${qty(selectedMovement.balanceAfter)} ${product.unit}`} />
                {selectedMovement.lot ? (
                  <InfoRow
                    label="Партия"
                    value={
                      <button
                        type="button"
                        className="text-[var(--color-primary)] hover:underline font-mono text-xs"
                        onClick={() => {
                          setTab("lots");
                          setSelectedLotId(selectedMovement.lot!.id);
                        }}
                      >
                        {selectedMovement.lot.id}
                      </button>
                    }
                  />
                ) : null}
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-xs text-[var(--color-muted-foreground)] leading-relaxed">
                  Метод оценки: FIFO. Сначала списывается самый ранний доступный приход.
                </div>
              </CardContent>
            </Card>
          )}

          {tab === "documents" && (
            <Card>
              <CardContent className="py-4 flex flex-col gap-3">
                <div className="text-base font-semibold">Использование товара</div>
                <div className="text-sm text-[var(--color-muted-foreground)]">
                  Товар участвует в стартовых остатках, приемках, перемещениях, продажах и других документах. История не удаляется при архивировании.
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

export function ProductLotsPage() {
  return <ProductCardPage />;
}

function MetricCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
        <div className="text-2xl font-semibold mt-2 numeric">{value}</div>
        {hint ? <div className="text-xs text-[var(--color-muted-foreground)] mt-1">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function IdentityStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div className="text-[var(--color-muted-foreground)]">{label}</div>
      <div className="font-medium">{value}</div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function formatRubPerUnit(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${rub(value, { precise: true })}/шт`;
}

function sourceTypeKey(documentType?: string) {
  if (documentType === "opening_balance") return "opening";
  if (documentType === "goods_receipt") return "receipt";
  if (documentType === "document_correction") return "correction";
  return documentType ?? "";
}

function sourceTypeLabel(documentType?: string) {
  if (documentType === "opening_balance") return "Стартовый остаток";
  if (documentType === "goods_receipt") return "Приемка";
  if (documentType === "document_correction") return "Корректировка";
  if (documentType === "stock_transfer") return "Перемещение";
  return documentType ?? "—";
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}
