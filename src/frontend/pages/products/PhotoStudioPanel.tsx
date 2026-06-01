import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ImagePlus, Link2, ListChecks, Sparkles, Trash2, UploadCloud } from "lucide-react";
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
  const baseFilled = [data.product.name, data.product.brand, data.product.category].filter((value) => String(value ?? "").trim().length > 0).length;
  const channelMappingHref = linkedCard?.externalProductId
    ? `/products/channel-mapping?externalProductId=${linkedCard.externalProductId}`
    : "/products/channel-mapping";

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
    <div className="flex flex-col gap-5">
      {!data.storageReady && (
        <Card>
          <CardContent className="py-4 text-sm text-[var(--color-warning,#a16207)]">
            Хранилище медиа не настроено (переменные S3_*). Загрузка фото недоступна.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold">Студия</div>
                <Badge tone={blockers.length === 0 ? "success" : "warning"}>
                  {readyCount}/{identityChecks.length}
                </Badge>
              </div>
              <div className="text-sm text-[var(--color-muted-foreground)] max-w-3xl">
                Рабочее место карточки товара: здесь живут исходники, план и слайды, которые готовит агент.
                Сейчас Студия использует данные товара MPFlow и привязанную карточку канала; отдельный канальный draft и отправка карточки на маркетплейс через эту вкладку пока не реализованы.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copyAgentTask}>Скопировать задание для Codex</Button>
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

      <Card className="renderPanel">
        <CardContent className="py-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link2 size={18} />
              <div className="text-base font-semibold">Канал</div>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to={channelMappingHref}>Открыть связь</Link>
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile label="Маркетплейс" value={data.marketplace?.toUpperCase() ?? "Не выбран"} hint={linkedCard?.channelName ?? "Привязки пока нет"} />
            <MetricTile label="Карточка канала" value={linkedCard?.offerId ?? "Не привязана"} hint={linkedCard?.externalName ?? "Сначала свяжите внешний SKU с товаром"} />
            <MetricTile label="Текущее состояние" value={blockers.length === 0 ? "Можно продолжать" : `${blockers.length} блок.`} hint={blockers.length === 0 ? "Базовые данные собраны." : "Проверьте блок проверки ниже."} />
          </div>
        </CardContent>
      </Card>

      <Card className="renderPanel">
        <CardContent className="py-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <ListChecks size={18} />
            <div className="text-base font-semibold">Карточка</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Основа" value={`${baseFilled}/3`} hint={`${data.product.name}${data.product.brand ? ` · ${data.product.brand}` : ""}${data.product.category ? ` · ${data.product.category}` : ""}`} />
            <MetricTile label="Описание" value={data.product.description?.trim() ? "Есть" : "Пусто"} hint={data.product.description?.trim() ? "Студия использует текущее описание товара." : "Добавьте описание на вкладке «Обзор»."} />
            <MetricTile label="Логистика" value={`${logisticsFilled}/4`} hint={logisticsFilled === 4 ? "Вес и габариты заполнены." : "Не хватает части данных для карточки."} />
            <MetricTile label="План серии" value={data.plan ? `${slides.length || "—"} слайдов` : "Нет"} hint={data.plan ? "План сохранен в контексте студии." : "Агент еще не сохранил план карточки."} />
          </div>
          {data.plan && (
            <ProjectPlanCard
              plan={data.plan}
              onReset={() => {
                if (window.confirm("Удалить план и исследование студии для этого товара? Слайды и исходники останутся на месте.")) {
                  resetPlan.mutate();
                }
              }}
              resetPending={resetPlan.isPending}
            />
          )}
        </CardContent>
      </Card>

      <AssetSection
        title="Медиа: исходники"
        hint="Фото, с которых работает агент. Для Browser + ChatGPT нужен хотя бы один исходник."
        icon={<ImagePlus size={18} />}
        assets={sources}
        onDelete={(assetId) => remove.mutate(assetId)}
      />

      <AssetSection
        title="Медиа: слайды карточки"
        hint="Сгенерированные агентом изображения. Одобренные слайды можно использовать как финальную серию."
        icon={<Sparkles size={18} />}
        assets={generated}
        emptyText="Слайдов пока нет. Передайте задачу агенту — результат появится здесь."
        onApprove={(assetId) => approve.mutate(assetId)}
        onDelete={(assetId) => remove.mutate(assetId)}
      />

      <Card className="renderPanel">
        <CardContent className="py-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <div className="text-base font-semibold">Проверка</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Готово</div>
              <ul className="space-y-2 text-sm">
                {identityChecks.filter((item) => item.ok).map((item) => (
                  <li key={item.label} className="flex items-start gap-2">
                    <CheckCircle2 size={15} className="mt-0.5 text-[var(--color-success)]" />
                    <span>
                      <span className="font-medium">{item.label}.</span> {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Требует внимания</div>
              {blockers.length === 0 ? (
                <EmptyState icon={<CheckCircle2 size={20} />} title="Критичных блокеров нет" description="Можно продолжать работу с планом и слайдами." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {blockers.map((item) => (
                    <li key={item.label} className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 text-[var(--color-warning)]" />
                      <span>
                        <span className="font-medium">{item.label}.</span> {item.description}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="renderPanel">
        <CardContent className="py-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} />
            <div className="text-base font-semibold">Экспорт</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile label="Одобрено" value={`${approved.length}`} hint="Столько слайдов уже помечены как финальные." />
            <MetricTile label="План" value={slides.length > 0 ? `${slides.length}` : "—"} hint="Количество слайдов в сохраненном плане." />
            <MetricTile label="Связь" value={linkedCard?.offerId ?? "Нет"} hint="Экспорт на маркетплейс возможен только для привязанной карточки." />
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-foreground)]">
            В этой версии Студия отвечает за исходники, план и слайды. Отправка карточки на маркетплейс через эту вкладку еще не реализована, поэтому финальная публикация и обновление связанной карточки выполняются вне этого экрана.
          </div>
        </CardContent>
      </Card>
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
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
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
      {research && <div className="text-sm text-[var(--color-muted-foreground)] line-clamp-3">{research}</div>}
      {slides.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {slides.map((slide, index) => (
            <li key={index} className="flex gap-2 text-sm">
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

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="text-xs text-[var(--color-muted-foreground)] mb-1">{label}</div>
      <div className="text-sm font-semibold mb-1 break-words">{value}</div>
      <div className="text-xs text-[var(--color-muted-foreground)]">{hint}</div>
    </div>
  );
}

function AssetSection({
  title,
  hint,
  icon,
  assets,
  emptyText,
  onApprove,
  onDelete
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  assets: ProductAssetView[];
  emptyText?: string;
  onApprove?: (assetId: string) => void;
  onDelete?: (assetId: string) => void;
}) {
  return (
    <Card className="renderPanel">
      <CardContent className="py-5">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <div className="text-base font-semibold">{title}</div>
          <Badge tone="neutral">{assets.length}</Badge>
        </div>
        <div className="text-sm text-[var(--color-muted-foreground)] mb-4">{hint}</div>
        {assets.length === 0 ? (
          <EmptyState icon={<ImagePlus size={20} />} title={emptyText ?? "Пусто"} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {assets.map((asset) => (
              <div key={asset.id} className="group relative rounded-[var(--radius-lg)] border border-[var(--color-border)] overflow-hidden bg-[var(--color-muted,#f4f4f5)]">
                <div className="aspect-[3/4] w-full overflow-hidden flex items-center justify-center">
                  <img src={asset.url} alt={asset.slideType ?? asset.role} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <div className="flex items-center gap-1 min-w-0">
                    {asset.role === "approved" && <Badge tone="success"><CheckCircle2 size={11} /> Одобрено</Badge>}
                    {asset.status === "pending" && <Badge tone="warning">Загрузка…</Badge>}
                    {asset.slideType && <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">{asset.slideType}</span>}
                    {asset.createdBy === "agent" && <span className="text-[11px] text-[var(--color-muted-foreground)]">· агент</span>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onApprove && asset.role === "generated" && (
                      <button type="button" title="Одобрить" className="text-[var(--color-primary)] hover:opacity-80" onClick={() => onApprove(asset.id)}>
                        <CheckCircle2 size={15} />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" title="Удалить" className="text-[var(--color-danger,#dc2626)] hover:opacity-80" onClick={() => onDelete(asset.id)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
