import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, RefreshCcw, ShieldOff } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ProductCell } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiDelete, apiGet, apiPost } from "@/api";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function ChannelMappingPage() {
  const { state } = useAppState();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const externals = state.externalProducts ?? [];
  const links = state.productExternalLinks ?? [];
  const channels = state.salesChannels ?? [];
  const products = state.products ?? [];
  const eventsQuery = useQuery({ queryKey: ["events"], queryFn: () => apiGet<any[]>("/api/integrations/events") });
  const externalEvents = eventsQuery.data ?? [];
  const focusedExternalProductId = searchParams.get("externalProductId");
  const initialSearch = searchParams.get("search") ?? "";
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(focusedExternalProductId);
  const [linkProductId, setLinkProductId] = useState("");

  const rows = useMemo(() => {
    return externals
      .map((external: any) => {
        const channel = channels.find((candidate: any) => candidate.id === external.channelId);
        const link = links.find((candidate: any) => candidate.externalProductId === external.id && candidate.status === "active");
        const product = link ? products.find((candidate: any) => candidate.id === link.productId) : null;
        const suggestions = products
          .map((candidate: any) => ({
            product: candidate,
            score: suggestionScore(candidate, external),
            reason: suggestionReason(candidate, external)
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, 5);
        const unresolvedEvents = externalEvents.filter((event: any) =>
          event.channelId === external.channelId &&
          (event.externalProductId === external.id || JSON.stringify(event.rawPayload ?? {}).includes(external.externalSku ?? ""))
        );
        const mappingStatus = external.status === "ignored"
          ? "ignored"
          : link
            ? "linked"
            : suggestions.length > 1 && suggestions[0]?.score === suggestions[1]?.score
              ? "conflict"
              : "unmatched";
        return { external, channel, link, product, suggestions, unresolvedEvents, mappingStatus };
      })
      .filter((row) => {
        if (focusedExternalProductId && row.external.id !== focusedExternalProductId) return false;
        if (channelFilter && row.external.channelId !== channelFilter) return false;
        if (statusFilter && row.mappingStatus !== statusFilter) return false;
        if (search) {
          const haystack = `${row.external.externalName} ${row.external.externalSku} ${row.product?.name ?? ""} ${row.product?.sku ?? ""}`.toLowerCase();
          if (!haystack.includes(search.toLowerCase())) return false;
        }
        return true;
      });
  }, [channelFilter, channels, externalEvents, externals, focusedExternalProductId, links, products, search, statusFilter]);

  const selectedRow = rows.find((row) => row.external.id === selectedExternalId) ?? rows[0];
  const selectedLink = selectedRow?.link;

  const linkMutation = useMutation({
    mutationFn: (payload: { externalProductId: string; productId: string }) => apiPost(`/api/external-products/${payload.externalProductId}/link`, { productId: payload.productId }),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const createFromExternalMutation = useMutation({
    mutationFn: (externalProductId: string) => apiPost(`/api/external-products/${externalProductId}/create-internal-product`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const ignoreMutation = useMutation({
    mutationFn: (externalProductId: string) => apiPost(`/api/external-products/${externalProductId}/ignore`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const reprocessMutation = useMutation({
    mutationFn: (externalProductId: string) => apiPost(`/api/external-products/${externalProductId}/reprocess-events`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const unlinkMutation = useMutation({
    mutationFn: (payload: { productId: string; linkId: string }) => apiDelete(`/api/products/${payload.productId}/external-links/${payload.linkId}`),
    onSuccess: () => queryClient.invalidateQueries()
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Товары", to: "/products" }, { label: "Сопоставление товаров" }]}
        title="Сопоставление товаров"
        subtitle="Связывает внешние карточки канала с внутренними SKU до обработки продаж, остатков и финансов."
        actions={<Button asChild><Link to="/integrations/channels"><Link2 size={14} /> Каналы</Link></Button>}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <Card className="renderPanel">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <Select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="w-48">
                <option value="">Все каналы</option>
                {channels.map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </Select>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-44">
                <option value="">Все статусы</option>
                <option value="linked">Связано</option>
                <option value="unmatched">Без связи</option>
                <option value="conflict">Конфликт</option>
                <option value="ignored">Игнорируется</option>
              </Select>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по SKU, названию, товару" className="max-w-[320px]" />
            </div>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Plus size={20} />}
                title={focusedExternalProductId ? "Карточка не найдена" : "Внешних карточек пока нет"}
                description={focusedExternalProductId ? "Проверьте фильтры или повторите синхронизацию." : "Они появятся после загрузки карточек из подключенного канала."}
                action={<Button asChild variant="secondary"><Link to="/integrations/channels">Открыть каналы</Link></Button>}
              />
            ) : (
              <Table>
                <THead>
                  <TR><TH>Канал</TH><TH>Внешняя карточка</TH><TH>SKU</TH><TH>Статус</TH><TH>Внутренний товар</TH></TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.external.id} interactive selected={row.external.id === selectedRow?.external.id} onClick={() => {
                      setSelectedExternalId(row.external.id);
                      setLinkProductId(row.suggestions[0]?.product.id ?? row.product?.id ?? "");
                    }}>
                      <TD>{row.channel?.name ?? "—"}</TD>
                      <TD>
                        <div className="flex items-center gap-3">
                          <ExternalThumb name={row.external.externalName} imageUrl={row.external.imageUrl} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{row.external.externalName}</div>
                            <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{row.unresolvedEvents.length} необработанных событий</div>
                          </div>
                        </div>
                      </TD>
                      <TD muted className="font-mono text-xs">{row.external.externalSku}</TD>
                      <TD><StatusBadge status={row.mappingStatus} /></TD>
                      <TD>{row.product ? <ProductCell product={row.product} size={32} /> : <span className="text-sm text-[var(--color-muted-foreground)]">Не связан</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit sticky top-20">
          <CardHeader><CardTitle>Карточка и решения</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!selectedRow ? (
              <div className="text-sm text-[var(--color-muted-foreground)]">Выберите внешнюю карточку слева.</div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <ExternalThumb name={selectedRow.external.externalName} imageUrl={selectedRow.external.imageUrl} size={56} />
                  <div className="min-w-0">
                    <div className="font-semibold">{selectedRow.external.externalName}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)] font-mono">{selectedRow.external.externalSku}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedRow.mappingStatus} />
                  <Badge tone="neutral">{selectedRow.channel?.name ?? "—"}</Badge>
                </div>

                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Рекомендуемые внутренние товары</div>
                  {selectedRow.suggestions.length === 0 ? (
                    <div className="text-sm text-[var(--color-muted-foreground)]">Автоподсказок пока нет. Можно выбрать товар вручную или создать новый.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectedRow.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.product.id}
                          type="button"
                          className={`rounded-[var(--radius-md)] border px-3 py-2 text-left ${linkProductId === suggestion.product.id ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]/45" : "border-[var(--color-border)]"}`}
                          onClick={() => setLinkProductId(suggestion.product.id)}
                        >
                          <ProductCell product={suggestion.product} size={32} />
                          <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">{suggestion.reason}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <FieldBlock label="Связать вручную">
                  <Select value={linkProductId} onChange={(event) => setLinkProductId(event.target.value)}>
                    <option value="">Выберите внутренний товар</option>
                    {products.map((product: any) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                  </Select>
                </FieldBlock>

                <div className="grid grid-cols-1 gap-2">
                  <Button onClick={() => selectedRow && linkProductId && linkMutation.mutate({ externalProductId: selectedRow.external.id, productId: linkProductId })} disabled={!selectedRow || !linkProductId || linkMutation.isPending}>
                    <Link2 size={14} /> Связать
                  </Button>
                  <Button variant="secondary" onClick={() => selectedRow && createFromExternalMutation.mutate(selectedRow.external.id)} disabled={!selectedRow || createFromExternalMutation.isPending}>
                    <Plus size={14} /> Создать товар
                  </Button>
                  <Button variant="secondary" onClick={() => selectedRow && reprocessMutation.mutate(selectedRow.external.id)} disabled={!selectedRow || reprocessMutation.isPending}>
                    <RefreshCcw size={14} /> Повторить обработку событий
                  </Button>
                  {selectedLink ? (
                    <Button variant="ghost" onClick={() => unlinkMutation.mutate({ productId: selectedLink.productId, linkId: selectedLink.id })} disabled={unlinkMutation.isPending}>
                      <ShieldOff size={14} /> Отвязать
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => selectedRow && ignoreMutation.mutate(selectedRow.external.id)} disabled={!selectedRow || ignoreMutation.isPending}>
                      <ShieldOff size={14} /> Игнорировать
                    </Button>
                  )}
                </div>

                {selectedRow.product && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm">
                    <div className="font-medium">Текущая связь</div>
                    <div className="mt-1"><Link to={`/products/${selectedRow.product.id}`} className="text-[var(--color-primary)] hover:underline">{selectedRow.product.sku} · {selectedRow.product.name}</Link></div>
                  </div>
                )}

                {selectedRow.unresolvedEvents.length > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm">
                    <div className="font-medium">Есть необработанные события</div>
                    <div className="mt-1 text-[var(--color-muted-foreground)]">После привязки можно отправить их на повторную обработку и довести до materialization.</div>
                    <Button variant="ghost" size="sm" asChild className="mt-2"><Link to={`/integrations/inbox?externalProductId=${selectedRow.external.id}`}>Открыть очередь</Link></Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      {children}
    </div>
  );
}

function ExternalThumb({ name, imageUrl, size = 40 }: { name: string; imageUrl?: string; size?: number }) {
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className="rounded-[var(--radius-md)] border border-[var(--color-border)] object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center text-[10px] text-[var(--color-muted-foreground)]" style={{ width: size, height: size }}>
      SKU
    </div>
  );
}

function StatusBadge({ status }: { status: "linked" | "unmatched" | "conflict" | "ignored" }) {
  const config = {
    linked: { tone: "success" as const, label: "Связано" },
    unmatched: { tone: "warning" as const, label: "Без связи" },
    conflict: { tone: "danger" as const, label: "Конфликт" },
    ignored: { tone: "neutral" as const, label: "Игнорируется" }
  }[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

function suggestionScore(product: any, external: any) {
  const internalSku = String(product.sku ?? "").trim().toLowerCase();
  const externalSku = String(external.externalSku ?? "").trim().toLowerCase();
  const internalName = String(product.name ?? "").trim().toLowerCase();
  const externalName = String(external.externalName ?? "").trim().toLowerCase();
  if (internalSku && externalSku && internalSku === externalSku) return 100;
  if (internalSku && externalSku && (internalSku.includes(externalSku) || externalSku.includes(internalSku))) return 80;
  if (internalName && externalName && internalName === externalName) return 70;
  if (internalName && externalName && (internalName.includes(externalName) || externalName.includes(internalName))) return 50;
  return 0;
}

function suggestionReason(product: any, external: any) {
  const internalSku = String(product.sku ?? "").trim().toLowerCase();
  const externalSku = String(external.externalSku ?? "").trim().toLowerCase();
  if (internalSku && externalSku && internalSku === externalSku) return "Точное совпадение SKU";
  if (internalSku && externalSku && (internalSku.includes(externalSku) || externalSku.includes(internalSku))) return "SKU частично совпадает";
  return "Совпадение по названию";
}
