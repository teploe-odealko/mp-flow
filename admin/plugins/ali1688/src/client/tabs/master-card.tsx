import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost, apiDelete } from "../../../../../src/client/lib/api"
import type { MasterCardTabProps } from "../../../../../src/client/pages/catalog/tab-types"

export const tabLabel = "1688"
export const tabOrder = 10

interface Sku {
  sku_id: string
  name: string
  image: string | null
  price: number | null
  stock: number | null
}

interface PriceTier {
  min_qty: number
  price: number
}

interface PreviewData {
  item_id: string | null
  title: string | null
  url: string | null
  supplier_name: string | null
  images: string[]
  price_min: string | null
  price_max: string | null
  price_tiers: PriceTier[] | null
  currency: string | null
  skus: Sku[]
}

export default function Ali1688Tab({ productId, onRefresh }: MasterCardTabProps) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState("")
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [selectedSku, setSelectedSku] = useState<Sku | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)

  // Load existing link
  const { data: linkData, isLoading } = useQuery({
    queryKey: ["ali1688-link", productId],
    queryFn: () => apiGet<any>(`/api/ali1688/link/${productId}`),
  })

  const link = linkData?.link

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: (previewUrl: string) => apiPost<any>("/api/ali1688/preview", { url: previewUrl }),
    onSuccess: (data) => {
      setPreview(data.item)
      setPreviewError("")
      setSelectedSku(null)
      // Auto-select if only 1 SKU
      if (data.item?.skus?.length === 1) setSelectedSku(data.item.skus[0])
    },
    onError: (err: Error) => {
      setPreviewError(err.message)
      setPreview(null)
      setIsAutoRefreshing(false)
    },
  })

  // Link mutation
  const linkMutation = useMutation({
    mutationFn: (body: any) => apiPost<any>("/api/ali1688/link", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ali1688-link", productId] })
      setPreview(null)
      setUrl("")
      setSelectedSku(null)
      setIsAutoRefreshing(false)
      onRefresh()
    },
    onError: () => setIsAutoRefreshing(false),
  })

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => apiDelete<any>(`/api/ali1688/link/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ali1688-link", productId] })
      onRefresh()
    },
  })

  /** Shared pipeline: build link body from fresh preview + selected SKU */
  function buildLinkBody(freshPreview: PreviewData, sku: Sku | null) {
    const skuPrice = sku?.price ?? (freshPreview.price_min ? Number(freshPreview.price_min) : null)
    return {
      master_card_id: productId,
      url: freshPreview.url || url.trim() || link?.url || "",
      item_id: freshPreview.item_id || link?.item_id || "",
      sku_id: sku?.sku_id || null,
      sku_name: sku?.name || null,
      sku_image: sku?.image || (freshPreview.images[0] || null),
      sku_price: skuPrice,
      supplier_name: freshPreview.supplier_name,
      title: freshPreview.title,
      images: freshPreview.images,
      price_tiers: freshPreview.price_tiers,
      currency: freshPreview.currency || "CNY",
      raw_data: freshPreview,
    }
  }

  function handlePreview() {
    if (!url.trim()) return
    previewMutation.mutate(url.trim())
  }

  function handleLink() {
    if (!preview) return
    linkMutation.mutate(buildLinkBody(preview, selectedSku))
  }

  /** Auto-refresh: fetch fresh data and immediately re-save with same SKU */
  function handleRefresh() {
    if (!link?.url) return
    setIsAutoRefreshing(true)
    previewMutation.mutate(link.url, {
      onSuccess: (data) => {
        const freshPreview: PreviewData = data.item
        const matchedSku = freshPreview.skus.find((s: Sku) => s.sku_id === link.sku_id) || null
        linkMutation.mutate(buildLinkBody(freshPreview, matchedSku))
      },
    })
  }

  if (isLoading) return <p className="text-text-secondary text-sm">Загрузка...</p>

  // Linked state: no active preview, or auto-refresh in progress (suppress picker)
  if (link && (!preview || isAutoRefreshing)) {
    return (
      <div>
        <div className="bg-bg-surface rounded border border-bg-border p-4">
          <div className="flex gap-4">
            {link.sku_image && (
              <img
                src={link.sku_image}
                alt=""
                className="w-20 h-20 object-cover rounded border border-bg-border shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium mb-1">{link.title || "—"}</div>
              {link.supplier_name && (
                <div className="text-text-secondary text-xs mb-1">Поставщик: {link.supplier_name}</div>
              )}
              {link.sku_name && (
                <div className="text-text-secondary text-xs mb-1">SKU: {link.sku_name}</div>
              )}
              {link.sku_price != null && (
                <div className="text-accent text-sm font-semibold">{Number(link.sku_price).toFixed(2)} CNY</div>
              )}
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-xs hover:underline mt-1 inline-block"
              >
                Открыть на 1688
              </a>
            </div>
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleRefresh}
              disabled={isAutoRefreshing}
              className="text-sm text-accent hover:text-accent-dark disabled:opacity-50"
            >
              {previewMutation.isPending ? "Загружаю..." : linkMutation.isPending && isAutoRefreshing ? "Сохраняю..." : "Обновить цены"}
            </button>
            <button
              onClick={() => unlinkMutation.mutate(link.id)}
              disabled={unlinkMutation.isPending}
              className="text-text-muted hover:text-outflow text-sm"
            >
              {unlinkMutation.isPending ? "Отвязываю..." : "Отвязать"}
            </button>
          </div>
          {previewError && <p className="text-outflow text-sm mt-2">{previewError}</p>}
        </div>
      </div>
    )
  }

  // Preview state
  return (
    <div>
      {/* URL input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePreview()}
          placeholder="https://detail.1688.com/offer/..."
          className="flex-1 px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
        />
        <button
          onClick={handlePreview}
          disabled={previewMutation.isPending || !url.trim()}
          className="px-3 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50 shrink-0"
        >
          {previewMutation.isPending ? "Загрузка..." : "Превью"}
        </button>
      </div>

      {previewError && <p className="text-outflow text-sm mb-4">{previewError}</p>}

      {/* Preview result */}
      {preview && (
        <div>
          {/* Item info */}
          <div className="mb-4 bg-bg-surface rounded border border-bg-border p-3">
            {/* Images gallery */}
            {preview.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
                {preview.images.slice(0, 6).map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    className="w-20 h-20 object-cover rounded border border-bg-border shrink-0"
                  />
                ))}
              </div>
            )}
            <div className="text-sm font-medium mb-1">{preview.title || "—"}</div>
            {preview.supplier_name && (
              <div className="text-text-secondary text-xs">Поставщик: {preview.supplier_name}</div>
            )}
            {preview.price_tiers && preview.price_tiers.length > 0 ? (
              <div className="mt-2">
                <div className="text-text-secondary text-[10px] mb-1">Таблица цен ({preview.currency || "CNY"})</div>
                <div className="flex flex-wrap gap-1">
                  {preview.price_tiers.map((tier) => (
                    <span
                      key={tier.min_qty}
                      className="text-xs bg-bg-deep border border-bg-border rounded px-2 py-0.5"
                    >
                      ≥{tier.min_qty} шт. → <span className="text-accent font-medium">{tier.price.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : preview.price_min ? (
              <div className="text-accent text-sm mt-1">
                {preview.price_min === preview.price_max
                  ? `${preview.price_min} ${preview.currency || "CNY"}`
                  : `${preview.price_min} — ${preview.price_max} ${preview.currency || "CNY"}`}
              </div>
            ) : null}
          </div>

          {/* SKU grid */}
          {preview.skus.length > 0 && (
            <div className="mb-4">
              <div className="text-text-secondary text-xs mb-2">
                Выберите вариант ({preview.skus.length} шт.)
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
                {preview.skus.map((sku) => {
                  const imgSrc = sku.image || preview.images[0] || null
                  return (
                    <button
                      key={sku.sku_id}
                      type="button"
                      onClick={() => setSelectedSku(sku)}
                      className={`text-left p-2 rounded border transition-colors ${
                        selectedSku?.sku_id === sku.sku_id
                          ? "border-accent bg-accent/10"
                          : "border-bg-border bg-bg-surface hover:border-text-muted"
                      }`}
                    >
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt=""
                          className="w-full aspect-square object-cover rounded mb-1.5"
                        />
                      ) : (
                        <div className="w-full aspect-square rounded mb-1.5 bg-bg-deep flex items-center justify-center">
                          <span className="text-text-muted text-[10px]">нет фото</span>
                        </div>
                      )}
                      <div className="text-xs truncate">{sku.name}</div>
                      {sku.price != null && (
                        <div className="text-accent text-xs font-medium">{sku.price.toFixed(2)} CNY</div>
                      )}
                      {sku.stock != null && (
                        <div className="text-text-muted text-[10px]">Остаток: {sku.stock}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Link button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleLink}
              disabled={linkMutation.isPending}
              className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
            >
              {linkMutation.isPending ? "Сохраняю..." : link ? "Сохранить" : "Привязать"}
            </button>
            {link && (
              <button
                onClick={() => { setPreview(null); setSelectedSku(null) }}
                className="text-sm text-text-muted hover:text-text-secondary"
              >
                Отмена
              </button>
            )}
          </div>
          {linkMutation.isError && (
            <span className="text-outflow text-sm ml-2">Ошибка: {(linkMutation.error as Error).message}</span>
          )}
        </div>
      )}
    </div>
  )
}
