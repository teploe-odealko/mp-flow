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

interface PreviewData {
  item_id: string | null
  title: string | null
  url: string | null
  supplier_name: string | null
  images: string[]
  price_min: string | null
  price_max: string | null
  skus: Sku[]
}

export default function Ali1688Tab({ productId, onRefresh }: MasterCardTabProps) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState("")
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [selectedSku, setSelectedSku] = useState<Sku | null>(null)
  const [previewError, setPreviewError] = useState("")

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
      onRefresh()
    },
  })

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => apiDelete<any>(`/api/ali1688/link/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ali1688-link", productId] })
      onRefresh()
    },
  })

  function handlePreview() {
    if (!url.trim()) return
    previewMutation.mutate(url.trim())
  }

  function handleLink() {
    if (!preview) return
    const skuPrice = selectedSku?.price ?? (preview.price_min ? Number(preview.price_min) : null)
    linkMutation.mutate({
      master_card_id: productId,
      url: preview.url || url.trim(),
      item_id: preview.item_id || "",
      sku_id: selectedSku?.sku_id || null,
      sku_name: selectedSku?.name || null,
      sku_image: selectedSku?.image || (preview.images[0] || null),
      sku_price: skuPrice,
      supplier_name: preview.supplier_name,
      title: preview.title,
      images: preview.images,
      raw_data: preview,
    })
  }

  if (isLoading) return <p className="text-text-secondary text-sm">Загрузка...</p>

  // Linked state
  if (link) {
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
          <button
            onClick={() => unlinkMutation.mutate(link.id)}
            disabled={unlinkMutation.isPending}
            className="mt-3 text-text-muted hover:text-outflow text-sm"
          >
            {unlinkMutation.isPending ? "Отвязываю..." : "Отвязать"}
          </button>
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
            <div className="text-sm font-medium mb-1">{preview.title || "—"}</div>
            {preview.supplier_name && (
              <div className="text-text-secondary text-xs">Поставщик: {preview.supplier_name}</div>
            )}
            {preview.price_min && (
              <div className="text-accent text-sm mt-1">
                {preview.price_min === preview.price_max
                  ? `${preview.price_min} CNY`
                  : `${preview.price_min} — ${preview.price_max} CNY`}
              </div>
            )}
          </div>

          {/* SKU grid */}
          {preview.skus.length > 0 && (
            <div className="mb-4">
              <div className="text-text-secondary text-xs mb-2">
                Выберите вариант ({preview.skus.length} шт.)
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
                {preview.skus.map((sku) => (
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
                    {sku.image && (
                      <img
                        src={sku.image}
                        alt=""
                        className="w-full aspect-square object-cover rounded mb-1.5"
                      />
                    )}
                    <div className="text-xs truncate">{sku.name}</div>
                    {sku.price != null && (
                      <div className="text-accent text-xs font-medium">{sku.price.toFixed(2)} CNY</div>
                    )}
                    {sku.stock != null && (
                      <div className="text-text-muted text-[10px]">Остаток: {sku.stock}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No SKUs — show images */}
          {preview.skus.length === 0 && preview.images.length > 0 && (
            <div className="mb-4">
              <div className="flex gap-2 overflow-x-auto">
                {preview.images.slice(0, 5).map((img, i) => (
                  <img key={i} src={img} alt="" className="w-20 h-20 object-cover rounded border border-bg-border shrink-0" />
                ))}
              </div>
            </div>
          )}

          {/* Link button */}
          <button
            onClick={handleLink}
            disabled={linkMutation.isPending}
            className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {linkMutation.isPending ? "Привязываю..." : "Привязать"}
          </button>
          {linkMutation.isError && (
            <span className="text-outflow text-sm ml-2">Ошибка: {(linkMutation.error as Error).message}</span>
          )}
        </div>
      )}
    </div>
  )
}
