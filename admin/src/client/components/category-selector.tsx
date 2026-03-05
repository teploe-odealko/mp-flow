import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost } from "../lib/api"

interface Category {
  id: string
  name: string
}

interface CategorySelectorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function CategorySelector({ value, onChange, placeholder = "Категория...", className = "" }: CategorySelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => apiGet<{ categories: Category[] }>("/api/finance/categories"),
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => apiPost<{ category: Category }>("/api/finance/categories", { name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["expense-categories"] })
      onChange(res.category.name)
      setSearch("")
      setOpen(false)
    },
  })

  const categories = data?.categories || []
  const filtered = search
    ? categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : categories

  const showCreate = search.trim() && !categories.some((c) => c.name.toLowerCase() === search.trim().toLowerCase())

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  function handleOpen() {
    setOpen(true)
    setSearch("")
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function selectCategory(name: string) {
    onChange(name)
    setSearch("")
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {!open ? (
        <button
          type="button"
          onClick={handleOpen}
          className="w-full text-left px-2 py-1 text-sm rounded border border-transparent hover:border-bg-border focus:border-accent focus:outline-none text-text-primary truncate"
        >
          {value || <span className="text-text-muted">{placeholder}</span>}
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={value || placeholder}
          className="w-full px-2 py-1 text-sm rounded border border-accent bg-bg-deep focus:outline-none text-text-primary"
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setSearch("") }
            if (e.key === "Enter" && showCreate) createMutation.mutate(search.trim())
            if (e.key === "Enter" && filtered.length === 1) selectCategory(filtered[0].name)
          }}
        />
      )}

      {open && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-full min-w-[180px] bg-bg-surface border border-bg-border rounded shadow-lg overflow-hidden">
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-xs text-text-muted">Нет категорий</div>
          )}
          {filtered.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectCategory(cat.name) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-elevated text-text-primary"
            >
              {cat.name}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); createMutation.mutate(search.trim()) }}
              className="w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-bg-elevated border-t border-bg-border"
            >
              + Создать «{search.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}
