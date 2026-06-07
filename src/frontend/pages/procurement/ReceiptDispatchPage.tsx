import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Boxes, MoveRight, RefreshCcw, Save, Send, Sparkles, Store } from "lucide-react";
import { apiGet, apiPost, rub, qty } from "@/api";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckLabel } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductCell } from "@/components/product-thumb";

const today = () => new Date().toISOString().slice(0, 10);

type AllocationDraft = Record<string, Record<string, string>>;

function allocationDraftFromApi(allocations: Array<{ destinationId: string; lines: Array<{ itemId: string; qty: number }> }> = []) {
  const next: AllocationDraft = {};
  allocations.forEach((allocation) => {
    next[allocation.destinationId] = Object.fromEntries(allocation.lines.map((line) => [line.itemId, String(line.qty)]));
  });
  return next;
}

function allocationPayloadFromDraft(draft: AllocationDraft) {
  return Object.entries(draft)
    .map(([destinationId, lines]) => ({
      destinationId,
      lines: Object.entries(lines)
        .map(([itemId, rawQty]) => ({ itemId, qty: Number(rawQty || 0) }))
        .filter((line) => line.qty > 0)
    }))
    .filter((allocation) => allocation.lines.length > 0);
}

export function ReceiptDispatchPage() {
  const { receiptId } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const presetChannelId = searchParams.get("channelId") ?? "";

  const [channelId, setChannelId] = useState(presetChannelId);
  const [transferDate, setTransferDate] = useState(today());
  const [comment, setComment] = useState("");
  const [lineQtys, setLineQtys] = useState<Record<string, string>>({});
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<string[]>([]);
  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft>({});
  const [savedRevision, setSavedRevision] = useState<number | undefined>(undefined);

  const contextQuery = useQuery({
    queryKey: ["receipt-dispatch-context", receiptId, channelId],
    queryFn: () => apiGet<any>(`/api/procurement/receipts/${receiptId}/dispatch-context${channelId ? `?channelId=${channelId}` : ""}`),
    enabled: Boolean(receiptId)
  });

  const dispatchStateQuery = useQuery({
    queryKey: ["receipt-dispatch-state", receiptId, channelId],
    queryFn: () => apiGet<any>(`/api/procurement/receipts/${receiptId}/channel-dispatch/state?channelId=${channelId}`),
    enabled: Boolean(receiptId && channelId)
  });

  const context = contextQuery.data;
  const channels = context?.channels ?? [];
  const selectedChannel = context?.channel ?? channels.find((candidate: any) => candidate.id === channelId);
  const advancedFlow = Boolean(context?.plugin?.fulfillmentCapabilities?.includes("dispatch_plan"));
  const selectedLines = useMemo(
    () =>
      (context?.lines ?? [])
        .map((line: any) => ({ ...line, qtyToDispatch: Number(lineQtys[line.goodsReceiptLineId] ?? 0) }))
        .filter((line: any) => line.qtyToDispatch > 0),
    [context?.lines, lineQtys]
  );

  useEffect(() => {
    if (!receiptId || channelId) return;
    const firstChannelId = channels[0]?.id;
    if (firstChannelId) setChannelId(firstChannelId);
  }, [channelId, channels, receiptId]);

  useEffect(() => {
    if (!context?.receipt) return;
    setTransferDate(context.receipt.receiptDate ?? today());
    setComment(`Отправка в канал ${selectedChannel?.name ?? ""} из приемки ${context.document?.number ?? ""}`.trim());
    setLineQtys(
      Object.fromEntries(
        (context.lines ?? []).map((line: any) => [line.goodsReceiptLineId, line.qtyAvailableToDispatch > 0 ? String(line.qtyAvailableToDispatch) : "0"])
      )
    );
    setSelectedDestinationIds([]);
    setAllocationDraft({});
    setSavedRevision(undefined);
  }, [context?.receipt?.id, context?.document?.number, selectedChannel?.name]);

  useEffect(() => {
    const saved = dispatchStateQuery.data;
    if (!saved?.payload) return;
    const payload = saved.payload;
    if (payload.transferDate) setTransferDate(String(payload.transferDate));
    if (Array.isArray(payload.dispatchLines)) {
      setLineQtys(Object.fromEntries(payload.dispatchLines.map((line: any) => [line.goodsReceiptLineId, String(line.qty)])));
    }
    if (Array.isArray(payload.selectedDestinationIds)) setSelectedDestinationIds(payload.selectedDestinationIds.map(String));
    if (Array.isArray(payload.allocations)) setAllocationDraft(allocationDraftFromApi(payload.allocations));
    setSavedRevision(saved.revision);
  }, [dispatchStateQuery.data]);

  const planMutation = useMutation({
    mutationFn: () =>
      apiPost<any>(`/api/procurement/receipts/${receiptId}/channel-dispatch/plan`, {
        channelId,
        transferDate,
        selectedDestinationIds,
        allocations: allocationPayloadFromDraft(allocationDraft),
        lines: selectedLines.map((line: any) => ({ goodsReceiptLineId: line.goodsReceiptLineId, qty: line.qtyToDispatch }))
      }),
    onSuccess: (data) => {
      setSavedRevision(data.state?.revision);
      if (Array.isArray(data.state?.payload?.selectedDestinationIds)) {
        setSelectedDestinationIds(data.state.payload.selectedDestinationIds);
      } else if (Array.isArray(data.plan?.defaultSelectedDestinationIds)) {
        setSelectedDestinationIds(data.plan.defaultSelectedDestinationIds);
      }
      queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-state", receiptId, channelId] });
    }
  });

  const autoAllocateMutation = useMutation({
    mutationFn: () =>
      apiPost<any>(`/api/procurement/receipts/${receiptId}/channel-dispatch/auto-allocate`, {
        channelId,
        selectedDestinationIds
      }),
    onSuccess: (data) => {
      setSavedRevision(data.state?.revision);
      setAllocationDraft(allocationDraftFromApi(data.allocations));
      queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-state", receiptId, channelId] });
    }
  });

  const commitBasicMutation = useMutation({
    mutationFn: () =>
      apiPost<any>(`/api/procurement/receipts/${receiptId}/channel-dispatch/basic`, {
        channelId,
        transferDate,
        comment,
        post: true,
        lines: selectedLines.map((line: any) => ({ goodsReceiptLineId: line.goodsReceiptLineId, qty: line.qtyToDispatch }))
      }),
    onSuccess: (transfer) => {
      void queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-context", receiptId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-state", receiptId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["document-card", transfer.documentId] });
      navigate(`/documents/${transfer.documentId}`);
    }
  });

  const commitAdvancedMutation = useMutation({
    mutationFn: () =>
      apiPost<any>(`/api/procurement/receipts/${receiptId}/channel-dispatch/commit`, {
        channelId,
        mode: "advanced",
        transferDate,
        comment,
        post: true,
        selectedDestinationIds,
        allocations: allocationPayloadFromDraft(allocationDraft),
        lines: selectedLines.map((line: any) => ({ goodsReceiptLineId: line.goodsReceiptLineId, qty: line.qtyToDispatch }))
      }),
    onSuccess: (transfer) => {
      void queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-context", receiptId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["receipt-dispatch-state", receiptId, channelId] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["documents-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting-journal-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["document-card", transfer.documentId] });
      navigate(`/documents/${transfer.documentId}`);
    }
  });

  const plan = (dispatchStateQuery.data?.payload?.plan ?? planMutation.data?.plan) as any;
  const hasPreparedPlan = Boolean(plan);
  const hasAllocationDraft = Object.keys(allocationDraft).length > 0;
  const allocationSummary = useMemo(() => {
    const allocatedByItem = new Map<string, number>();
    allocationPayloadFromDraft(allocationDraft).forEach((allocation) => {
      allocation.lines.forEach((line) => {
        allocatedByItem.set(line.itemId, Number(allocatedByItem.get(line.itemId) ?? 0) + Number(line.qty ?? 0));
      });
    });
    return selectedLines.map((line: any) => ({
      itemId: line.goodsReceiptLineId,
      allocatedQty: Number(allocatedByItem.get(line.goodsReceiptLineId) ?? 0),
      requestedQty: Number(line.qtyToDispatch ?? 0)
    }));
  }, [allocationDraft, selectedLines]);
  const shouldValidateAllocations = hasPreparedPlan && (selectedDestinationIds.length > 0 || hasAllocationDraft);
  const allocationMismatch = shouldValidateAllocations && allocationSummary.some((line) => Math.abs(line.allocatedQty - line.requestedQty) > 0.0001);

  if (!receiptId) return null;

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: "Поставки", to: "/procurement" },
          { label: "Приемка", to: context?.document ? `/documents/${context.document.id}` : "/procurement" },
          { label: "Отправка в канал" }
        ]}
        title="Отправка в канал продаж"
        subtitle="Берем уже принятые количества и создаем внутреннее перемещение на точку продаж. При необходимости можно дополнительно подготовить план распределения канала."
        actions={<Button variant="ghost" asChild><Link to={context?.document ? `/documents/${context.document.id}` : "/procurement"}><ArrowLeft size={14} /> Назад</Link></Button>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Параметры отправки</CardTitle>
                <CardDescription>Источник, количество и само внутреннее перемещение всегда фиксируются в учете.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Канал" required>
                <Select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
                  {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </Select>
              </Field>
              <Field label="Дата учета" required>
                <Input type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} />
              </Field>
              <Field label="Склад источник">
                <Input value={context?.sourceWarehouse?.name ?? ""} readOnly />
              </Field>
              <Field label="Точка продаж">
                <Input value={context?.salesPointWarehouse?.name ?? "—"} readOnly />
              </Field>
              <div className="md:col-span-2">
                <Field label="Комментарий">
                  <Input value={comment} onChange={(event) => setComment(event.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardHeader>
              <div>
                <CardTitle>Строки отправки</CardTitle>
                <CardDescription>Можно отправить не всю приемку. Доступный остаток считается по уже проведенным перемещениям из этой приемки.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!context?.lines?.length ? (
                <div className="p-6">
                  <EmptyState icon={<Boxes size={18} />} title="В приемке нет строк для отправки" />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Товар</TH>
                      <TH numeric>Принято</TH>
                      <TH numeric>Уже отправлено</TH>
                      <TH numeric>Доступно</TH>
                      <TH numeric>Отправить</TH>
                      <TH numeric>Себест./шт</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {context.lines.map((line: any) => (
                      <TR key={line.goodsReceiptLineId}>
                        <TD>
                          <ProductCell product={{ id: line.productId, sku: line.productSku, name: line.productName }} size={36} />
                        </TD>
                        <TD numeric>{qty(line.qtyReceived)}</TD>
                        <TD numeric muted>{qty(line.qtyAlreadyDispatched)}</TD>
                        <TD numeric className="font-semibold">{qty(line.qtyAvailableToDispatch)}</TD>
                        <TD>
                          <Input
                            type="number"
                            min={0}
                            max={line.qtyAvailableToDispatch}
                            value={lineQtys[line.goodsReceiptLineId] ?? ""}
                            onChange={(event) => setLineQtys((current) => ({ ...current, [line.goodsReceiptLineId]: event.target.value }))}
                          />
                        </TD>
                        <TD numeric>{rub(line.unitCostRub)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {advancedFlow ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>План распределения канала</CardTitle>
                      <Badge tone="neutral" size="sm">Опционально</Badge>
                    </div>
                    <CardDescription>Этот шаг нужен только если хочешь заранее разложить отправку по кластерам и складам канала. Простое внутреннее перемещение можно провести и без него.</CardDescription>
                  </div>
                <Button onClick={() => planMutation.mutate()} disabled={planMutation.isPending || selectedLines.length === 0}>
                  <Sparkles size={14} /> Подготовить план
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {!hasPreparedPlan ? (
                  <div className="text-sm text-[var(--color-muted-foreground)]">
                    Этот шаг необязателен. Можно сразу провести внутреннее перемещение или сначала подготовить план распределения для канала.
                  </div>
                ) : (
                  <>
                    {(plan.notes?.length ?? 0) > 0 && (
                      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm">
                        {plan.notes.map((note: string, index: number) => <div key={index}>• {note}</div>)}
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
                      <Card className="border-dashed">
                        <CardHeader>
                          <CardTitle>Кластеры Ozon</CardTitle>
                          <CardDescription>Выбранные кластеры участвуют в авто-раскладке. Количества можно поправить вручную.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2">
                          {(plan.destinations ?? []).map((destination: any) => {
                            const checked = selectedDestinationIds.includes(destination.id);
                            return (
                              <label key={destination.id} className={`flex items-start gap-3 rounded-[var(--radius-md)] border p-3 cursor-pointer ${checked ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]/50" : "border-[var(--color-border)]"}`}>
                                <CheckLabel
                                  label=""
                                  checked={checked}
                                  onCheckedChange={() => setSelectedDestinationIds((current) => checked ? current.filter((value) => value !== destination.id) : [...current, destination.id])}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{destination.title}</span>
                                    {destination.attentionLevel && <Badge tone={destination.attentionLevel === "high" ? "warning" : "neutral"} size="sm">{destination.attentionLevel}</Badge>}
                                  </div>
                                  <div className="text-xs text-[var(--color-muted-foreground)] mt-1">
                                    {destination.clusterName ?? "Кластер Ozon"}
                                    {typeof destination.averageDeliveryHours === "number" ? ` · ${destination.averageDeliveryHours} ч` : ""}
                                    {typeof destination.recommendedQty === "number" ? ` · рек. ${qty(destination.recommendedQty)}` : ""}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </CardContent>
                      </Card>

                      <Card className="border-dashed">
                        <CardHeader>
                          <CardTitle>Seller-склады</CardTitle>
                          <CardDescription>Справочная информация по складам продавца для этой отправки.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2 text-sm">
                          {(plan.sellerWarehouses ?? []).map((warehouse: any) => (
                            <div key={warehouse.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
                              <div className="font-medium">{warehouse.title}</div>
                              <div className="text-xs text-[var(--color-muted-foreground)] mt-1">{warehouse.region ?? warehouse.address ?? "Склад продавца"}</div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={() => autoAllocateMutation.mutate()} disabled={autoAllocateMutation.isPending || selectedDestinationIds.length === 0}>
                        <RefreshCcw size={14} /> Автораспределить
                      </Button>
                      <span className="text-xs text-[var(--color-muted-foreground)]">Алгоритм берет рекомендации плагина и выравнивает остаток по выбранным кластерам.</span>
                    </div>

                    {selectedDestinationIds.length > 0 && selectedLines.length > 0 && (
                      <Card className="border-dashed">
                        <CardHeader>
                          <CardTitle>Распределение по кластерам</CardTitle>
                          <CardDescription>Проверь или поправь количество по каждому кластеру перед сохранением раскладки.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <Table>
                            <THead>
                              <TR><TH>Кластер</TH><TH>Товар</TH><TH numeric>К отправке</TH><TH numeric>В кластер</TH></TR>
                            </THead>
                            <TBody>
                              {selectedDestinationIds.flatMap((destinationId) => {
                                const destination = (plan.destinations ?? []).find((candidate: any) => candidate.id === destinationId);
                                return selectedLines.map((line: any) => (
                                  <TR key={`${destinationId}:${line.goodsReceiptLineId}`}>
                                    <TD>{destination?.title ?? destinationId}</TD>
                                    <TD>{line.productSku} · {line.productName}</TD>
                                    <TD numeric muted>{qty(line.qtyToDispatch)}</TD>
                                    <TD>
                                      <Input
                                        type="number"
                                        min={0}
                                        value={allocationDraft[destinationId]?.[line.goodsReceiptLineId] ?? ""}
                                        onChange={(event) =>
                                          setAllocationDraft((current) => ({
                                            ...current,
                                            [destinationId]: {
                                              ...(current[destinationId] ?? {}),
                                              [line.goodsReceiptLineId]: event.target.value
                                            }
                                          }))
                                        }
                                      />
                                    </TD>
                                  </TR>
                                ));
                              })}
                            </TBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4 text-sm text-[var(--color-muted-foreground)]">
              Для этого канала доступно обычное внутреннее перемещение на точку продаж без дополнительного плана распределения.
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Сводка</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3"><span>Канал</span><span className="font-medium">{selectedChannel?.name ?? "—"}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Строк</span><span className="font-medium">{selectedLines.length}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Количество</span><span className="font-medium">{qty(selectedLines.reduce((sum: number, line: any) => sum + Number(line.qtyToDispatch ?? 0), 0))}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Себестоимость</span><span className="font-medium">{rub(selectedLines.reduce((sum: number, line: any) => sum + Number(line.qtyToDispatch ?? 0) * Number(line.unitCostRub ?? 0), 0))}</span></div>
              {advancedFlow && (
                <>
                  <div className="flex items-center justify-between gap-3"><span>Кластеров в плане</span><span className="font-medium">{selectedDestinationIds.length}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>Черновик плана</span><span className="font-medium">{savedRevision ?? "—"}</span></div>
                </>
              )}
            </CardContent>
          </Card>

          {allocationMismatch && shouldValidateAllocations && (
            <Card>
              <CardContent className="py-4 text-sm text-[var(--color-danger)]">
                План не сходится с количеством к отправке. Для каждой строки сумма по кластерам должна полностью покрывать количество.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Действия</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button className="w-full h-auto whitespace-normal py-2.5" onClick={() => commitBasicMutation.mutate()} disabled={commitBasicMutation.isPending || selectedLines.length === 0}>
                <MoveRight size={14} /> Провести перемещение
              </Button>
              {advancedFlow && (
                <>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                    План распределения необязателен. Если он нужен для работы с каналом, его можно подготовить и сохранить отдельно.
                  </div>
                  {hasPreparedPlan ? (
                    <>
                      <Button
                        variant="secondary"
                        className="w-full h-auto whitespace-normal py-2.5"
                        onClick={() => commitAdvancedMutation.mutate()}
                        disabled={commitAdvancedMutation.isPending || selectedLines.length === 0 || allocationMismatch || selectedDestinationIds.length === 0}
                      >
                        <Send size={14} /> Провести с раскладкой
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-full h-auto whitespace-normal py-2.5"
                        onClick={() => planMutation.mutate()}
                        disabled={selectedLines.length === 0 || planMutation.isPending}
                      >
                        <Save size={14} /> Сохранить черновик
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      className="w-full h-auto whitespace-normal py-2.5"
                      onClick={() => planMutation.mutate()}
                      disabled={selectedLines.length === 0 || planMutation.isPending}
                    >
                      <Sparkles size={14} /> Подготовить план
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Как это ляжет в учет</CardTitle></CardHeader>
            <CardContent className="text-sm text-[var(--color-muted-foreground)] leading-relaxed flex flex-col gap-2">
              <div className="flex items-start gap-2"><Store size={14} className="mt-0.5 shrink-0" />Приемка создает книжный остаток на основном складе.</div>
              <div className="flex items-start gap-2"><MoveRight size={14} className="mt-0.5 shrink-0" />Эта операция делает внутреннее перемещение на точку продаж канала.</div>
              <div className="flex items-start gap-2"><Sparkles size={14} className="mt-0.5 shrink-0" />Если подготовить план канала, он сохранит раскладку и связь с внешним процессом, но не заменит само внутреннее перемещение.</div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
