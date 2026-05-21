import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowUpRight, ExternalLink, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { ProductCell, ProductThumb } from "@/components/product-thumb";
import { useAppState } from "@/lib/use-app-state";
import { apiPost } from "@/api";
import { date } from "@/lib/format";
import { qty } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { paginateRows } from "@/lib/pagination";

export function ProductsPage() {
  const { state } = useAppState();
  const products = state.products ?? [];
  const stockStates = state.stockStates ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [unitFilter, setUnitFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const brands = Array.from(new Set(products.map((product: any) => product.brand).filter(Boolean))) as string[];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p: any) => {
      if (statusFilter && statusFilter !== "all" && p.status !== statusFilter) return false;
      if (unitFilter && p.unit !== unitFilter) return false;
      if (brandFilter && p.brand !== brandFilter) return false;
      if (q && !`${p.sku} ${p.name} ${p.brand ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, statusFilter, unitFilter, brandFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, unitFilter, brandFilter]);

  const paged = useMemo(() => paginateRows<any>(filtered, page, pageSize), [filtered, page, pageSize]);
  const selected = paged.find((p: any) => p.id === selectedId) ?? paged[0];
  const archive = useMutation({
    mutationFn: (id: string) => apiPost(`/api/products/${id}/archive`),
    onSuccess: () => queryClient.invalidateQueries()
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/api/products/${id}/restore`),
    onSuccess: () => queryClient.invalidateQueries()
  });

  const stockForSelected = stockStates.filter((s: any) => s.productId === selected?.id);
  const totalQty = stockForSelected.reduce((s: number, x: any) => s + x.qty, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Товары"
        subtitle="Внутренние карточки товаров — справочник для остатков, поставок и продаж"
        actions={
          <Button asChild>
            <Link to="/products/new"><Plus size={14} /> Создать товар</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input className="pl-9" placeholder="Поиск по SKU, названию или бренду" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="archived">Архивные</option>
              </Select>
              <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-32">
                <option value="">Все ед.</option>
                <option value="шт">шт</option>
                <option value="м">м</option>
                <option value="кг">кг</option>
              </Select>
              {brands.length > 0 && (
                <Select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="w-40">
                  <option value="">Все бренды</option>
                  {brands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </Select>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link to="/products/channel-mapping"><ExternalLink size={13} /> Привязки каналов</Link>
              </Button>
            </div>

            {products.length === 0 ? (
              <div className="py-12 px-5">
                <EmptyState
                  title="Создайте первый товар, чтобы вводить остатки и поставки"
                  description="Товар сам по себе не создает проводок, но дает стабильный внутренний SKU для всех документов."
                  action={<Button asChild><Link to="/products/new">Создать товар</Link></Button>}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="w-24">Фото</TH>
                    <TH className="w-36">SKU</TH>
                    <TH>Название</TH>
                    <TH className="w-20">Ед.</TH>
                    <TH className="w-24">Вес</TH>
                    <TH className="w-32">Габариты</TH>
                    <TH className="w-24">Статус</TH>
                    <TH className="w-32">Создан</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.length === 0 && (
                    <TR>
                      <TD colSpan={8} className="text-center py-10 text-[var(--color-muted-foreground)]">По фильтрам ничего не найдено</TD>
                    </TR>
                  )}
                  {paged.map((p: any) => (
                    <TR key={p.id} interactive selected={p.id === selected?.id} onClick={() => setSelectedId(p.id)}>
                      <TD><ProductThumb product={p} size={44} /></TD>
                      <TD className="font-mono text-xs font-semibold">{p.sku}</TD>
                      <TD>
                        <div className="font-medium">{p.name}</div>
                        {p.brand && <div className="text-[11px] text-[var(--color-muted-foreground)]">{p.brand}</div>}
                      </TD>
                      <TD muted>{p.unit}</TD>
                      <TD muted className="numeric">{p.weightGrams ? `${p.weightGrams} г` : "—"}</TD>
                      <TD muted className="numeric text-xs">
                        {p.lengthMm && p.widthMm && p.heightMm ? `${p.lengthMm}×${p.widthMm}×${p.heightMm} мм` : "—"}
                      </TD>
                      <TD>
                        {p.status === "active" ? <Badge tone="success">Активен</Badge> : <Badge tone="neutral">Архив</Badge>}
                      </TD>
                      <TD muted className="text-xs numeric">{date(p.createdAt)}</TD>
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

        <Card className="h-fit sticky top-20">
          {selected ? (
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <ProductThumb product={selected} size={80} />
                <div className="min-w-0">
                  <div className="text-base font-semibold leading-tight">{selected.name}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)] numeric mt-0.5">{selected.sku}</div>
                  {selected.brand && <Badge tone="neutral" size="sm" className="mt-2">{selected.brand}</Badge>}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Row label="Категория" value={selected.category ?? "—"} />
                <Row label="Ед. измерения" value={selected.unit} />
                <Row label="Вес" value={selected.weightGrams ? `${selected.weightGrams} г` : "—"} />
                <Row label="Габариты" value={selected.lengthMm ? `${selected.lengthMm}×${selected.widthMm}×${selected.heightMm}` : "—"} />
              </dl>

              <div className="rounded-[var(--radius-md)] bg-[var(--color-muted)]/40 p-3 border border-[var(--color-border)]">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">Остатки</div>
                {stockForSelected.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Появятся после стартового остатка или приёмки</p>
                ) : (
                  <div className="text-base font-semibold mt-0.5 numeric">{qty(totalQty)} {selected.unit}</div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button onClick={() => navigate(`/products/${selected.id}`)}>
                  <ArrowUpRight size={14} /> Открыть карточку
                </Button>
                <Button variant="secondary" asChild>
                  <Link to={`/products/${selected.id}/edit`}>Редактировать</Link>
                </Button>
                {selected.status === "active" ? (
                  <Button variant="ghost" onClick={() => setArchiveTarget(selected)} disabled={archive.isPending}>
                    <Archive size={14} /> Архивировать
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => restore.mutate(selected.id)} disabled={restore.isPending}>
                    Вернуть из архива
                  </Button>
                )}
              </div>
            </CardContent>
          ) : (
            <CardContent className="text-sm text-[var(--color-muted-foreground)] py-12 text-center">Выберите товар</CardContent>
          )}
        </Card>
      </div>

      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Архивировать товар?</DialogTitle>
          </DialogHeader>
          <DialogBody className="text-sm text-[var(--color-muted-foreground)]">
            Товар останется в истории документов, партий и отчетов, но будет скрыт из активного каталога.
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>Отмена</Button>
            <Button
              onClick={() => archiveTarget && archive.mutate(archiveTarget.id, { onSuccess: () => setArchiveTarget(null) })}
              disabled={archive.isPending}
            >
              Архивировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="font-medium mt-0.5">{value}</dd>
    </div>
  );
}
