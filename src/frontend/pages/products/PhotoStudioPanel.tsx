import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Copy, ExternalLink, FileText, ImagePlus, Link2, ListChecks, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { apiDelete, apiGet, apiPost } from "@/api";
import { emitAppAlert } from "@/lib/app-alerts";

interface ProductAssetView {
  id: string;
  role: "source" | "generated" | "approved";
  slideType?: string;
  url: string;
  status: "pending" | "ready" | "archived";
  width?: number;
  height?: number;
  createdBy: "user" | "agent";
}

interface StudioProductView {
  id: string;
  sku?: string;
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  weightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  imageUrl?: string;
}

interface StudioChannelRow {
  link?: { id: string };
  external?: { id?: string; externalName?: string; externalSku?: string };
  channel?: { id?: string; name?: string; channelType?: string };
}

interface StudioLinkedCard {
  channelId?: string;
  channelName?: string;
  offerId?: string;
  externalName?: string;
  externalProductId?: string;
}

interface StudioView {
  product: StudioProductView;
  assets: ProductAssetView[];
  channels: StudioChannelRow[];
  linkedCard?: StudioLinkedCard | null;
  marketplace?: string | null;
  plan?: Record<string, any> | null;
  storageReady: boolean;
}

interface StudioCheck {
  label: string;
  ok: boolean;
  description: string;
  required?: boolean;
}

interface StudioGap {
  label: string;
  description: string;
  required: boolean;
}

const ACCEPT = "image/png,image/jpeg,image/webp";

function readImageSize(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

export function StudioPanel({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<StudioView>({
    queryKey: ["product-studio", productId],
    queryFn: () => apiGet<StudioView>(`/api/products/${productId}/studio`)
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["product-studio", productId] });

  async function uploadSource(file: File) {
    setBusy(true);
    try {
      const { asset, uploadUrl } = await apiPost<{ asset: ProductAssetView; uploadUrl: string }>(
        `/api/products/${productId}/studio/uploads`,
        { role: "source", contentType: file.type || "image/png" }
      );
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/png" } });
      if (!put.ok) throw new Error(`Хранилище отклонило загрузку (HTTP ${put.status})`);
      const size = await readImageSize(file);
      await apiPost(`/api/products/${productId}/studio/assets/${asset.id}/confirm`, size);
      emitAppAlert({ tone: "success", title: "Фото загружено", message: "Исходник добавлен в студию." });
      await refetch();
    } catch (error) {
      emitAppAlert({ tone: "danger", title: "Не удалось загрузить фото", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const approve = useMutation({
    mutationFn: (assetId: string) => apiPost(`/api/products/${productId}/studio/assets/${assetId}/approve`),
    onSuccess: refetch
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => apiDelete(`/api/products/${productId}/studio/assets/${assetId}`),
    onSuccess: refetch
  });
  const resetPlan = useMutation({
    mutationFn: () => apiDelete(`/api/products/${productId}/studio/plan`),
    onSuccess: async () => {
      emitAppAlert({ tone: "success", title: "Контекст сброшен", message: "План и исследование студии удалены." });
      await refetch();
    },
    onError: (error) => {
      emitAppAlert({ tone: "danger", title: "Не удалось сбросить контекст", message: error instanceof Error ? error.message : String(error) });
    }
  });

  if (isLoading || !data) {
    return (
      <Card className="renderPanel">
        <CardContent className="py-10">
          <EmptyState icon={<Sparkles size={20} />} title="Загружаем студию…" />
        </CardContent>
      </Card>
    );
  }

  const sources = data.assets.filter((asset) => asset.role === "source");
  const approved = data.assets.filter((asset) => asset.role === "approved");
  const generated = data.assets.filter((asset) => asset.role === "generated" || asset.role === "approved");
  const slides: any[] = Array.isArray(data.plan?.slides) ? data.plan.slides : [];
  const linkedCard = data.linkedCard ?? (data.channels[0]?.external
    ? {
        channelName: data.channels[0]?.channel?.name,
        offerId: data.channels[0]?.external?.externalSku,
        externalName: data.channels[0]?.external?.externalName,
        externalProductId: data.channels[0]?.external?.id
      }
    : null);

  const identityChecks: StudioCheck[] = [
    {
      label: "Связь с каналом",
      ok: Boolean(linkedCard?.offerId),
      required: true,
      description: linkedCard?.offerId
        ? `${linkedCard.channelName ?? "Канал"} · ${linkedCard.offerId}`
        : "Карточка маркетплейса пока не привязана."
    },
    {
      label: "Описание товара",
      ok: Boolean(data.product.description?.trim()),
      required: true,
      description: data.product.description?.trim() ? "Описание в карточке товара заполнено." : "Описание товара в MPFlow пока пустое."
    },
    {
      label: "Логистика",
      ok: Boolean(data.product.weightGrams && data.product.lengthMm && data.product.widthMm && data.product.heightMm),
      required: true,
      description:
        data.product.weightGrams && data.product.lengthMm && data.product.widthMm && data.product.heightMm
          ? `${data.product.weightGrams} г · ${data.product.lengthMm} × ${data.product.widthMm} × ${data.product.heightMm} мм`
          : "Не хватает веса или габаритов."
    },
    {
      label: "Исходники",
      ok: sources.length > 0,
      required: true,
      description: sources.length > 0 ? `Загружено ${sources.length} фото.` : "Исходное фото для генерации еще не загружено."
    },
    {
      label: "План студии",
      ok: Boolean(data.plan),
      required: true,
      description: data.plan ? "План и исследование сохранены." : "План карточки пока не сохранен."
    },
    {
      label: "Слайды серии",
      ok: generated.length > 0,
      required: true,
      description: generated.length > 0 ? `Готово ${generated.length} слайдов, одобрено ${approved.length}.` : "Слайды серии пока не загружены."
    }
  ];

  const readyCount = identityChecks.filter((item) => item.ok).length;
  const blockers = identityChecks.filter((item) => item.required && !item.ok);
  const logisticsFilled = [data.product.weightGrams, data.product.lengthMm, data.product.widthMm, data.product.heightMm].filter(Boolean).length;
  const cardGroups = [
    {
      label: "Обязательные поля",
      filled: (linkedCard?.offerId ? 1 : 0) + (data.product.description?.trim() ? 1 : 0) + (sources.length > 0 ? 1 : 0) + (data.plan ? 1 : 0) + (generated.length > 0 ? 1 : 0),
      total: 5,
      tone: "success" as const
    },
    {
      label: "Характеристики",
      filled: (data.product.brand?.trim() ? 1 : 0) + (data.product.category?.trim() ? 1 : 0) + logisticsFilled,
      total: 6,
      tone: "warning" as const
    },
    {
      label: "Описание и тексты",
      filled: (data.product.name?.trim() ? 1 : 0) + (data.product.description?.trim() ? 1 : 0) + (slides.length > 0 ? 1 : 0),
      total: 3,
      tone: "primary" as const
    },
    {
      label: "Медиа",
      filled: (sources.length > 0 ? 1 : 0) + Math.min(generated.length, slides.length > 0 ? slides.length : generated.length > 0 ? 1 : 0),
      total: 1 + Math.max(slides.length, generated.length > 0 ? 1 : 0),
      tone: "neutral" as const
    }
  ];
  const cardFilled = cardGroups.reduce((sum, group) => sum + group.filled, 0);
  const cardTotal = cardGroups.reduce((sum, group) => sum + group.total, 0);
  const readinessPercent = Math.round((cardFilled / Math.max(cardTotal, 1)) * 100);
  const channelMappingHref = linkedCard?.externalProductId
    ? `/products/channel-mapping?externalProductId=${linkedCard.externalProductId}`
    : "/products/channel-mapping";
  const missingFields: StudioGap[] = [
    !linkedCard?.offerId ? { label: "Связь с каналом", description: "Без привязки нельзя обновлять карточку канала.", required: true } : null,
    !data.product.brand?.trim() ? { label: "Бренд", description: "Нужен для карточки и части маркетплейс-атрибутов.", required: false } : null,
    !data.product.category?.trim() ? { label: "Категория", description: "Нужна для выбора требований и полей канала.", required: false } : null,
    !data.product.description?.trim() ? { label: "Описание", description: "Агенту не на что опереться для текста карточки.", required: true } : null,
    !data.product.weightGrams ? { label: "Вес", description: "Логистика карточки неполная.", required: true } : null,
    !data.product.lengthMm ? { label: "Длина", description: "Не хватает габаритов для карточки.", required: true } : null,
    !data.product.widthMm ? { label: "Ширина", description: "Не хватает габаритов для карточки.", required: true } : null,
    !data.product.heightMm ? { label: "Высота", description: "Не хватает габаритов для карточки.", required: true } : null,
    sources.length === 0 ? { label: "Фото-источник", description: "Нужно хотя бы одно фото товара.", required: true } : null,
    !data.plan ? { label: "План студии", description: "Контекст и структура серии пока не сохранены.", required: true } : null,
    generated.length === 0 ? { label: "Слайды серии", description: "Готовые PNG еще не загружены.", required: true } : null
  ].filter((item): item is StudioGap => Boolean(item));
  const warningItems = [
    !linkedCard?.offerId ? "Карточка канала пока не привязана." : null,
    !data.product.description?.trim() ? "Описание товара в MPFlow пока пустое." : null,
    logisticsFilled < 4 ? "Вес и габариты заполнены не полностью." : null,
    slides.length > 0 && generated.length < slides.length ? `Загружено ${generated.length} из ${slides.length} слайдов серии.` : null,
    approved.length === 0 && generated.length > 0 ? "Ни один слайд еще не отмечен как финальный." : null
  ].filter((item): item is string => Boolean(item));
  const statusRows = [
    {
      title: "Связь с каналом",
      subtitle: linkedCard?.offerId ? `${linkedCard.channelName ?? "Канал"} · ${linkedCard.offerId}` : "Нужно привязать карточку",
      tone: linkedCard?.offerId ? "success" as const : "warning" as const,
      done: Boolean(linkedCard?.offerId)
    },
    {
      title: "Описание и факты",
      subtitle: data.product.description?.trim() ? "Описание товара уже есть в MPFlow" : "Описание пока пустое",
      tone: data.product.description?.trim() ? "success" as const : "warning" as const,
      done: Boolean(data.product.description?.trim())
    },
    {
      title: "Исходники",
      subtitle: sources.length > 0 ? `Загружено ${sources.length} фото` : "Нужен хотя бы один референс",
      tone: sources.length > 0 ? "success" as const : "warning" as const,
      done: sources.length > 0
    },
    {
      title: "План карточки",
      subtitle: data.plan ? `${slides.length || "—"} слайдов в плане` : "План еще не сохранен",
      tone: data.plan ? "success" as const : "warning" as const,
      done: Boolean(data.plan)
    },
    {
      title: "Слайды серии",
      subtitle: generated.length > 0 ? `${generated.length} загружено, ${approved.length} одобрено` : "Слайды еще не загружены",
      tone: generated.length > 0 ? "primary" as const : "warning" as const,
      done: generated.length > 0
    }
  ];
  const sourcePreview = sources.slice(0, 5);
  const generatedPreview = generated.slice(0, 6);

  const agentTask = `Создай карточку товара в MPFlow: productId=${productId}.\n` +
    `Используй MCP-бриф студии. Собери план карточки и серию слайдов, а всю генерацию изображений выполняй через [@Браузер](plugin://browser@openai-bundled): открой авторизованный ChatGPT, прикрепи исходное фото товара как референс, забери готовые PNG и загрузи их в MPFlow.`;

  const copyAgentTask = async () => {
    try {
      await navigator.clipboard.writeText(agentTask);
      emitAppAlert({ tone: "success", title: "Скопировано", message: "Задание для Codex в буфере обмена." });
    } catch {
      emitAppAlert({ tone: "danger", title: "Не удалось скопировать", message: "Скопируйте текст вручную." });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!data.storageReady && (
        <Card>
          <CardContent className="py-4 text-sm text-[var(--color-warning,#a16207)]">
            Хранилище медиа не настроено (переменные S3_*). Загрузка фото недоступна.
          </CardContent>
        </Card>
      )}

      <Card className="renderPanel">
        <CardContent className="py-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xl font-semibold">Студия</div>
                <Badge tone={blockers.length === 0 ? "success" : "warning"}>{cardFilled}/{cardTotal}</Badge>
                <Badge tone="neutral">{linkedCard?.offerId ? "Обновление карточки" : "Новая карточка"}</Badge>
                {linkedCard?.channelName && <Badge tone="neutral">{linkedCard.channelName}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
                <span>SKU {data.product.sku ?? "—"}</span>
                <span>{sources.length} исходников</span>
                <span>{generated.length} слайдов</span>
                <span>{approved.length} одобрено</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copyAgentTask}>
                <Copy size={14} /> Задание агенту
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={!data.storageReady || busy}>
                <UploadCloud size={14} /> {busy ? "Загрузка…" : "Загрузить исходник"}
              </Button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadSource(file);
              event.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Link2 size={18} />
                <div className="text-base font-semibold">Канал</div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr_1fr_auto] xl:items-center">
                <div className="min-w-0 xl:border-r xl:border-[var(--color-border)] xl:pr-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1d4ed8_0%,#2563eb_48%,#ec4899_100%)] text-sm font-semibold text-white shadow-sm">
                      O
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-medium">{linkedCard?.channelName ?? data.marketplace?.toUpperCase() ?? "Канал не выбран"}</div>
                        <Badge tone={linkedCard?.offerId ? "success" : "warning"}>{linkedCard?.offerId ? "Подключен" : "Нет связи"}</Badge>
                      </div>
                      <div className="truncate text-sm text-[var(--color-muted-foreground)]">
                        {linkedCard?.externalName ?? "Связь карточки с каналом пока не создана."}
                      </div>
                    </div>
                  </div>
                </div>
                <MetricBlock
                  label="Режим"
                  value={linkedCard?.offerId ? "Обновление карточки" : "Новая карточка"}
                  hint={linkedCard?.offerId ? "У товара уже есть связанная карточка." : "Сначала нужна привязка к каналу."}
                />
                <MetricBlock
                  label="ID предложения"
                  value={linkedCard?.offerId ?? "Не привязано"}
                  hint={linkedCard?.externalProductId ? `ID ${linkedCard.externalProductId}` : "Внешняя карточка еще не связана"}
                />
                <div className="flex justify-start xl:justify-end">
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={channelMappingHref}>
                      Открыть в Каналах продаж <ExternalLink size={14} />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ListChecks size={18} />
                  <div className="text-base font-semibold">Карточка</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-3xl font-semibold leading-none">{cardFilled}<span className="text-[var(--color-muted-foreground)] text-lg">/{cardTotal}</span></div>
                    <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{readinessPercent}% заполнено</div>
                  </div>
                  <div className="min-w-44">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                      <div className="h-full bg-[var(--color-primary)]" style={{ width: `${readinessPercent}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4">
                  <div className="text-sm text-[var(--color-muted-foreground)]">Готовность</div>
                  <div className="mt-2 text-4xl font-semibold leading-none">{cardFilled}<span className="text-xl text-[var(--color-muted-foreground)]"> / {cardTotal}</span></div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                    <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${readinessPercent}%` }} />
                  </div>
                  <div className="mt-2 text-sm text-[var(--color-muted-foreground)]">{readinessPercent}% заполнено</div>
                </div>
                <div className="grid gap-2.5">
                  {cardGroups.map((group) => (
                    <ProgressRow
                      key={group.label}
                      label={group.label}
                      filled={group.filled}
                      total={group.total}
                      tone={group.tone}
                    />
                  ))}
                </div>
              </div>
              {data.plan ? (
                <ProjectPlanCard
                  plan={data.plan}
                  onReset={() => {
                    if (window.confirm("Удалить план и исследование студии для этого товара? Слайды и исходники останутся на месте.")) {
                      resetPlan.mutate();
                    }
                  }}
                  resetPending={resetPlan.isPending}
                />
              ) : (
                <EmptyState icon={<FileText size={20} />} title="Плана карточки пока нет" description="После исследования агент сохранит research, стиль и порядок слайдов в контексте студии." />
              )}
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={18} />
                  <div className="text-base font-semibold">Медиа</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!data.storageReady || busy}>
                  <UploadCloud size={14} /> Добавить исходник
                </Button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <PreviewStrip
                  title="Исходники"
                  count={sources.length}
                  hint="Фото-источники, которые агент использует как референс."
                  assets={sourcePreview}
                  emptyText="Загрузите референс товара"
                  onDelete={(assetId) => remove.mutate(assetId)}
                />
                <PreviewStrip
                  title="Слайды карточки"
                  count={generated.length}
                  total={slides.length || undefined}
                  hint="Готовые PNG, загруженные обратно в MPFlow."
                  assets={generatedPreview}
                  emptyText="Слайды пока не загружены"
                  onApprove={(assetId) => approve.mutate(assetId)}
                  onDelete={(assetId) => remove.mutate(assetId)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} />
                  <div className="text-base font-semibold">Проверка</div>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={channelMappingHref}>
                    Открыть связь <ArrowUpRight size={14} />
                  </Link>
                </Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ReviewColumn
                  title="Предупреждения"
                  items={warningItems}
                  emptyTitle="Существенных предупреждений нет"
                  emptyDescription="Базовый контур карточки уже собран."
                />
                <GapColumn
                  title="Не заполнено"
                  items={missingFields}
                  emptyTitle="Критичных пробелов нет"
                  emptyDescription="Можно переходить к загрузке и проверке слайдов."
                />
              </div>
            </CardContent>
          </Card>

          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Sparkles size={18} />
                <div className="text-base font-semibold">Экспорт</div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricTile label="Будет обновлено" value={`${cardFilled} полей`} hint="Готовый контур карточки по данным MPFlow." />
                    <MetricTile label="Слайды" value={generated.length > 0 ? `${generated.length}` : "—"} hint="PNG, загруженные в студию." />
                    <MetricTile label="Фото-источники" value={sources.length > 0 ? `${sources.length}` : "—"} hint="Референсы, доступные агенту." />
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4 text-sm text-[var(--color-muted-foreground)]">
                    Эта вкладка готовит пакет карточки: факты, план и медиа. Отправка на канал из Studio пока недоступна, поэтому следующий шаг — открыть связанную карточку в разделе каналов.
                  </div>
                </div>
                <Button size="lg" asChild>
                  <Link to={channelMappingHref}>
                    Открыть связь канала <ArrowUpRight size={16} />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4">
          <Card className="renderPanel">
            <CardContent className="py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-base font-semibold">Агент</div>
                <Badge tone={blockers.length === 0 ? "success" : "warning"}>{readyCount}/{identityChecks.length}</Badge>
              </div>
              <div className="flex flex-col gap-3">
                {statusRows.map((item) => (
                  <div key={item.title} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.done ? <CheckCircle2 size={15} className="text-[var(--color-success)] shrink-0" /> : <CircleDashed size={15} className="text-[var(--color-warning)] shrink-0" />}
                        <div className="text-sm font-medium truncate">{item.title}</div>
                      </div>
                      <Badge tone={item.tone} size="sm">{item.done ? "Готово" : "В работе"}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{item.subtitle}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3 text-sm">
                {blockers.length > 0 ? (
                  <div className="space-y-2">
                    <div className="font-medium">Нужно закрыть перед продолжением</div>
                    <ul className="space-y-1.5 text-[var(--color-muted-foreground)]">
                      {blockers.slice(0, 3).map((item) => (
                        <li key={item.label} className="flex items-start gap-2">
                          <CircleDashed size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
                          <span>{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-[var(--color-muted-foreground)]">Базовый контур собран. Можно продолжать генерацию и загрузку серии.</div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-sm">
                <div className="text-[var(--color-muted-foreground)]">Контекст студии</div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={copyAgentTask}>Скопировать</Button>
                  {data.plan && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (window.confirm("Удалить план и исследование студии для этого товара? Слайды и исходники останутся на месте.")) {
                          resetPlan.mutate();
                        }
                      }}
                      disabled={resetPlan.isPending}
                    >
                      {resetPlan.isPending ? "Сбрасываем…" : "Сбросить"}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export const PhotoStudioPanel = StudioPanel;

function ProjectPlanCard({ plan, onReset, resetPending }: { plan: Record<string, any>; onReset?: () => void; resetPending?: boolean }) {
  const slides: any[] = Array.isArray(plan?.slides) ? plan.slides : [];
  const style = plan?.style;
  const styleText = typeof style === "string" ? style : style ? (style.archetype ?? style.name ?? JSON.stringify(style)) : null;
  const research = typeof plan?.research === "string" ? plan.research : null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/15 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">План и исследование</div>
          {plan?.updatedBy === "agent" && <Badge tone="neutral">от агента</Badge>}
          {slides.length > 0 && <Badge tone="neutral">{slides.length} слайдов</Badge>}
        </div>
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={resetPending}>
            <Trash2 size={14} /> {resetPending ? "Сбрасываем…" : "Сбросить контекст"}
          </Button>
        )}
      </div>
      {styleText && (
        <div className="text-sm"><span className="text-[var(--color-muted-foreground)]">Стиль: </span>{styleText}</div>
      )}
      {research && <div className="text-sm text-[var(--color-muted-foreground)] line-clamp-2">{research}</div>}
      {slides.length > 0 && (
        <ol className="grid gap-1.5 md:grid-cols-2">
          {slides.slice(0, 6).map((slide, index) => (
            <li key={index} className="flex gap-2 text-sm min-w-0">
              <span className="text-[var(--color-muted-foreground)] w-5 shrink-0">{index + 1}.</span>
              <span className="font-medium shrink-0">{slide?.type ?? slide?.title ?? "слайд"}</span>
              {(slide?.idea ?? slide?.message ?? slide?.purpose) && (
                <span className="text-[var(--color-muted-foreground)] truncate">— {slide.idea ?? slide.message ?? slide.purpose}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProgressRow({
  label,
  filled,
  total,
  tone
}: {
  label: string;
  filled: number;
  total: number;
  tone: "success" | "warning" | "primary" | "neutral";
}) {
  const dotClass =
    tone === "success"
      ? "bg-[var(--color-success)]"
      : tone === "warning"
        ? "bg-[var(--color-warning)]"
        : tone === "primary"
          ? "bg-[var(--color-primary)]"
          : "bg-[var(--color-muted-foreground)]";

  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate text-sm">{label}</span>
      </div>
      <div className="shrink-0 text-sm font-medium">{filled} / {total}</div>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="text-xs text-[var(--color-muted-foreground)] mb-1">{label}</div>
      <div className="text-sm font-semibold mb-1 break-words">{value}</div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{hint}</div>
    </div>
  );
}

function MetricBlock({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 xl:border-r xl:border-[var(--color-border)] xl:pr-4 last:xl:border-r-0 last:xl:pr-0">
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-sm font-semibold break-words">{value}</div>
      <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{hint}</div>
    </div>
  );
}

function PreviewStrip({
  title,
  hint,
  count,
  total,
  assets,
  emptyText,
  onApprove,
  onDelete
}: {
  title: string;
  hint: string;
  count: number;
  total?: number;
  assets: ProductAssetView[];
  emptyText?: string;
  onApprove?: (assetId: string) => void;
  onDelete?: (assetId: string) => void;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-sm font-semibold">{title}</div>
        <Badge tone="neutral">{total ? `${count}/${total}` : count}</Badge>
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)] mb-3">{hint}</div>
      {assets.length === 0 ? (
        <EmptyState icon={<ImagePlus size={18} />} title={emptyText ?? "Пусто"} />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
          {assets.map((asset) => (
            <div key={asset.id} className="group relative rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden bg-[var(--color-muted,#f4f4f5)]">
              <div className="aspect-square w-full overflow-hidden flex items-center justify-center">
                <img src={asset.url} alt={asset.slideType ?? asset.role} className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0 text-[11px] text-[var(--color-muted-foreground)] truncate">
                    {asset.slideType ?? (asset.role === "source" ? "source" : "slide")}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {onApprove && asset.role === "generated" && (
                      <button type="button" title="Одобрить" className="text-[var(--color-primary)] hover:opacity-80" onClick={() => onApprove(asset.id)}>
                        <CheckCircle2 size={14} />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" title="Удалить" className="text-[var(--color-danger,#dc2626)] hover:opacity-80" onClick={() => onDelete(asset.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {asset.role === "approved" && <Badge tone="success" size="sm">Одобрено</Badge>}
                  {asset.status === "pending" && <Badge tone="warning" size="sm">Загрузка</Badge>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewColumn({
  title,
  items,
  emptyTitle,
  emptyDescription
}: {
  title: string;
  items: string[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={20} />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 text-[var(--color-warning)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GapColumn({
  title,
  items,
  emptyTitle,
  emptyDescription
}: {
  title: string;
  items: StudioGap[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={20} />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{item.label}</div>
                <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{item.description}</div>
              </div>
              <Badge tone={item.required ? "danger" : "warning"} size="sm">{item.required ? "Обязательное" : "Желательно"}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
