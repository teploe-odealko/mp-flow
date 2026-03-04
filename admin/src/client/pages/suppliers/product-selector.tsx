import { useState, useRef, useEffect } from "react"
import { apiGet } from "../../lib/api"

interface Product {
  id: string
  title: string
  purchase_price?: number | null
  purchase_currency?: string | null
  purchase_price_tiers?: Array<{ min_qty: number; price: number }> | null
}

interface ProductValue {
  master_card_id: string
  title: string
  purchase_price?: number | null
  purchase_currency?: string | null
  purchase_price_tiers?: Array<{ min_qty: number; price: number }> | null
}

interface Props {
  value: ProductValue | null
  onChange: (product: ProductValue) => void
  excludeIds?: string[]
}

export function ProductSelector({ value, onChange, excludeIds = [] }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([])
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await apiGet<any>(`/api/catalog?q=${encodeURIComponent(query)}`)
        const all: Product[] = (data.products || []).map((p: any) => ({
          id: p.id,
          title: p.title,
          purchase_price: p.purchase_price ?? null,
          purchase_currency: p.purchase_currency ?? null,
          purchase_price_tiers: p.purchase_price_tiers ?? null,
        }))
        setResults(excludeIds.length > 0 ? all.filter((p) => !excludeIds.includes(p.id)) : all)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  if (value && value.master_card_id) {
    return (
      <div className="group/sel flex items-center gap-1">
        <span className="text-sm truncate">{value.title}</span>
        <button
          type="button"
          onClick={() => onChange({ master_card_id: "", title: "" })}
          className="text-text-muted hover:text-outflow text-xs shrink-0 opacity-0 group-hover/sel:opacity-100 transition-opacity"
          title="Убрать"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => query.length >= 2 && setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Поиск товара..."
        className="w-full px-2 py-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted rounded border border-transparent hover:border-bg-border focus:border-accent focus:bg-bg-deep focus:outline-none transition-colors"
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 top-full left-0 mt-0.5 bg-bg-surface border border-bg-border rounded shadow-lg max-h-48 overflow-y-auto min-w-[280px]">
          {loading && <div className="px-2 py-1.5 text-text-muted text-xs">Поиск...</div>}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-bg-elevated text-sm"
              onClick={() => {
                onChange({
                  master_card_id: p.id,
                  title: p.title,
                  purchase_price: p.purchase_price,
                  purchase_currency: p.purchase_currency,
                  purchase_price_tiers: p.purchase_price_tiers,
                })
                setQuery("")
                setOpen(false)
              }}
            >
              <div className="truncate">{p.title}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
