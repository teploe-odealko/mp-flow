import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, ListChecks, Sparkles, Trash2, UploadCloud } from "lucide-react";
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

interface CardStudioView {
  product: { id: string; name: string };
  assets: ProductAssetView[];
  channels: Array<{ external?: { externalName?: string; externalSku?: string }; channel?: { name?: string } }>;
  plan?: Record<string, any> | null;
  storageReady: boolean;
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

export function PhotoStudioPanel({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<CardStudioView>({
    queryKey: ["product-card", productId],
    queryFn: () => apiGet<CardStudioView>(`/api/products/${productId}/card`)
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["product-card", productId] });

  async function uploadSource(file: File) {
    setBusy(true);
    try {
      const { asset, uploadUrl } = await apiPost<{ asset: ProductAssetView; uploadUrl: string }>(
        `/api/products/${productId}/card/uploads`,
        { role: "source", contentType: file.type || "image/png" }
      );
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/png" } });
      if (!put.ok) throw new Error(`Хранилище отклонило загрузку (HTTP ${put.status})`);
      const size = await readImageSize(file);
      await apiPost(`/api/products/${productId}/card/assets/${asset.id}/confirm`, size);
      emitAppAlert({ tone: "success", title: "Фото загружено", message: "Исходник добавлен в фотостудию." });
      await refetch();
    } catch (error) {
      emitAppAlert({ tone: "danger", title: "Не удалось загрузить фото", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const approve = useMutation({
    mutationFn: (assetId: string) => apiPost(`/api/products/${productId}/card/assets/${assetId}/approve`),
    onSuccess: refetch
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => apiDelete(`/api/products/${productId}/card/assets/${assetId}`),
    onSuccess: refetch
  });

  if (isLoading || !data) {
    return (
      <Card className="renderPanel">
        <CardContent className="py-10">
          <EmptyState icon={<Sparkles size={20} />} title="Загружаем фотостудию…" />
        </CardContent>
      </Card>
    );
  }

  const sources = data.assets.filter((asset) => asset.role === "source");
  const generated = data.assets.filter((asset) => asset.role === "generated" || asset.role === "approved");
  const linkedCard = data.channels[0];

  const agentTask = `Оформи фотокарточку для товара «${data.product.name}» (productId=${productId}) в MPFlow.\n` +
    `Через MCP получи бриф (card_studio_get_brief productId=${productId} или mpflow_api_get /api/products/${productId}/card/brief), изучи исходное фото как обязательный референс, конкурентов и отзывы.\n` +
    `Сгенерируй слайды только на основе подтвержденных фактов из брифа, фото и моих указаний, затем загрузи их в фотостудию.`;

  const copyAgentTask = async () => {
    try {
      await navigator.clipboard.writeText(agentTask);
      emitAppAlert({ tone: "success", title: "Скопировано", message: "Задание для агента в буфере обмена." });
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
            <div>
              <div className="text-lg font-semibold">Фотостудия</div>
              <div className="text-sm text-[var(--color-muted-foreground)] max-w-xl">
                Загрузите исходное фото, передайте задачу агенту — он соберёт план и сгенерирует слайды для карточки.
                {linkedCard ? ` Привязанная карточка: ${linkedCard.channel?.name ?? "канал"} · ${linkedCard.external?.externalSku ?? ""}.` : " Карточка маркетплейса пока не привязана (вкладка «Каналы продаж»)."}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copyAgentTask}>Скопировать задание агенту</Button>
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

      {data.plan && <PlanCard plan={data.plan} />}

      <AssetSection
        title="Исходники"
        hint="Фото, с которых работает агент."
        icon={<ImagePlus size={18} />}
        assets={sources}
        onDelete={(assetId) => remove.mutate(assetId)}
      />

      <AssetSection
        title="Слайды карточки"
        hint="Сгенерированные агентом изображения. Одобренные пойдут на экспорт."
        icon={<Sparkles size={18} />}
        assets={generated}
        emptyText="Слайдов пока нет. Передайте задачу агенту — результат появится здесь."
        onApprove={(assetId) => approve.mutate(assetId)}
        onDelete={(assetId) => remove.mutate(assetId)}
      />
    </div>
  );
}

function PlanCard({ plan }: { plan: Record<string, any> }) {
  const slides: any[] = Array.isArray(plan?.slides) ? plan.slides : [];
  const style = plan?.style;
  const styleText = typeof style === "string" ? style : style ? (style.archetype ?? style.name ?? JSON.stringify(style)) : null;
  const research = typeof plan?.research === "string" ? plan.research : null;
  return (
    <Card className="renderPanel">
      <CardContent className="py-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ListChecks size={18} />
          <div className="text-base font-semibold">План карточки</div>
          {plan?.updatedBy === "agent" && <Badge tone="neutral">от агента</Badge>}
          {slides.length > 0 && <Badge tone="neutral">{slides.length} слайдов</Badge>}
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
      </CardContent>
    </Card>
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
