import { useState, useEffect, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api"
import { ProductSelector } from "./product-selector"
import { ReceiveModal } from "./receive-modal"
import { computeAllocations, STATUS_LABELS, STATUS_COLORS } from "./utils"
import type { OrderItem, SharedCostEntry } from "./utils"

interface ItemDraft extends OrderItem {
  _key: string
  id?: string
  purchase_price_tiers?: Array<{ min_qty: number; price: number }> | null
  _price_auto?: boolean
}

/** Find the best matching price tier for given quantity */
function priceFromTiers(tiers: Array<{ min_qty: number; price: number }> | null | undefined, qty: number): number | null {
  if (!tiers || tiers.length === 0) return null
  const sorted = [...tiers].sort((a, b) => b.min_qty - a.min_qty)
  return sorted.find((t) => qty >= t.min_qty)?.price ?? null
}

function newItem(): ItemDraft {
  return {
    _key: crypto.randomUUID(),
    master_card_id: "",
    title: "",
    ordered_qty: 1,
    purchase_price: 0,
    purchase_currency: "CNY",
  }
}

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("ru-RU")
}

const CURRENCIES = ["CNY", "RUB", "USD"]

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Form state
  const [supplierName, setSupplierName] = useState("")
  const [orderNumber, setOrderNumber] = useState("")
  const [notes, setNotes] = useState("")
  const [orderDate, setOrderDate] = useState("")
  const [status, setStatus] = useState("draft")
  const [items, setItems] = useState<ItemDraft[]>([newItem()])
  const [showReceive, setShowReceive] = useState(false)

  // Load existing order
  const { data: orderData, isLoading } = useQuery({
    queryKey: ["supplier-order", id],
    queryFn: () => apiGet<any>(`/api/suppliers/${id}`),
    enabled: !!id,
  })

  // Load expenses for allocation preview (saved orders only)
  const { data: expensesData } = useQuery({
    queryKey: ["supplier-payments", id],
    queryFn: () => apiGet<{ payments: any[]; total_paid: number }>(`/api/suppliers/${id}/payments`),
    enabled: !!id,
  })

  useEffect(() => {
    if (!orderData?.supplier_order) return
    const o = orderData.supplier_order
    setSupplierName(o.supplier_name || "")
    setOrderNumber(o.order_number || "")
    setNotes(o.notes || "")
    setOrderDate(o.order_date ? o.order_date.slice(0, 10) : "")
    setStatus(o.status || "draft")

    if (o.items?.length) {
      setItems(
        o.items.map((item: any) => ({
          _key: item.id || crypto.randomUUID(),
          id: item.id,
          master_card_id: item.master_card_id,
          title: item.title || item.master_card_id,
          ordered_qty: item.ordered_qty || 0,
          purchase_price: Number(item.purchase_price) || 0,
          purchase_currency: item.purchase_currency || "CNY",
          purchase_price_tiers: item.purchase_price_tiers ?? null,
          _price_auto: false,
        })),
      )
    }
  }, [orderData])

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (isNew) {
        return apiPost("/api/suppliers", payload)
      }
      return apiPut(`/api/suppliers/${id}`, payload)
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      if (isNew && data?.supplier_order?.id) {
        navigate(`/suppliers/${data.supplier_order.id}`, { replace: true })
      } else {
        queryClient.invalidateQueries({ queryKey: ["supplier-order", id] })
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete(`/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      navigate("/suppliers")
    },
  })

  const receiveMutation = useMutation({
    mutationFn: (receiveItems: Array<{ item_id: string; received_qty: number }>) =>
      apiPost(`/api/suppliers/${id}`, { action: "receive", items: receiveItems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-order", id] })
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
      setShowReceive(false)
    },
  })

  const unreceiveMutation = useMutation({
    mutationFn: () => apiPost(`/api/suppliers/${id}`, { action: "unreceive" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-order", id] })
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
    },
  })

  // Shared costs from saved expenses (for allocation preview)
  const sharedCosts: SharedCostEntry[] = useMemo(() => {
    return (expensesData?.payments || [])
      .filter((p: any) => p.metadata?.allocation_method && p.metadata.allocation_method !== "none")
      .map((p: any) => ({
        name: p.description || "Расход",
        total_rub: Number(p.amount),
        method: p.metadata.allocation_method as "equal" | "by_price",
      }))
  }, [expensesData])

  // Computed
  const validItems = items.filter((i) => i.master_card_id)
  const allocations = useMemo(
    () => computeAllocations(validItems, sharedCosts),
    [validItems, sharedCosts],
  )
  const grandTotal = allocations.reduce((s, a) => s + a.total_cost, 0)
  const canEdit = status === "draft" || status === "ordered"
  const canDelete = status === "draft" && !isNew

  function buildPayload() {
    return {
      supplier_name: supplierName,
      order_number: orderNumber || undefined,
      notes: notes || undefined,
      order_date: orderDate || undefined,
      items: validItems.map((i) => ({
        master_card_id: i.master_card_id,
        ordered_qty: i.ordered_qty,
        purchase_price: i.purchase_price,
        purchase_currency: i.purchase_currency,
      })),
    }
  }

  function handleSave() {
    saveMutation.mutate(buildPayload())
  }

  function handleMarkOrdered() {
    if (!id) return
    saveMutation.mutate({ ...buildPayload(), status: "ordered" })
  }

  function handleDelete() {
    if (confirm("Удалить документ?")) deleteMutation.mutate()
  }

  function handleUnreceive() {
    if (confirm("Отменить приёмку?")) unreceiveMutation.mutate()
  }

  // Item helpers
  function updateItem(key: string, field: string, value: any) {
    setItems((prev) => prev.map((i) => (i._key === key ? { ...i, [field]: value } : i)))
  }

  function removeItem(key: string) {
    setItems((prev) => {
      const filtered = prev.filter((i) => i._key !== key)
      return filtered.length > 0 ? filtered : [newItem()]
    })
  }

  if (!isNew && isLoading) {
    return <p className="text-text-secondary">Загрузка...</p>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/suppliers")}
          className="text-text-secondary hover:text-text-primary text-sm"
        >
          ← Назад
        </button>
        <h1 className="text-xl font-semibold flex-1">
          {isNew ? "Новый документ" : `Поставка ${orderNumber || ""}`}
        </h1>
        {!isNew && (
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[status] || ""}`}>
            {STATUS_LABELS[status] || status}
          </span>
        )}
      </div>

      {/* Action bar */}
      <div className="flex gap-2 mb-6">
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !supplierName}
            className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {saveMutation.isPending ? "Сохраняю..." : "Сохранить"}
          </button>
        )}
        {status === "draft" && !isNew && (
          <button
            onClick={handleMarkOrdered}
            disabled={saveMutation.isPending || validItems.length === 0}
            className="px-3 py-1.5 bg-bg-surface border border-accent text-accent rounded text-sm hover:bg-accent/10 disabled:opacity-50"
          >
            В заказ
          </button>
        )}
        {(status === "ordered" || status === "shipped") && (
          <button
            onClick={() => setShowReceive(true)}
            className="px-3 py-1.5 bg-inflow text-white rounded text-sm hover:opacity-90"
          >
            Приёмка
          </button>
        )}
        {status === "received" && (
          <button
            onClick={handleUnreceive}
            disabled={unreceiveMutation.isPending}
            className="px-3 py-1.5 bg-bg-surface border border-bg-border text-text-secondary rounded text-sm hover:text-text-primary disabled:opacity-50"
          >
            Отменить приёмку
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="px-3 py-1.5 text-text-muted hover:text-outflow text-sm ml-auto"
          >
            Удалить
          </button>
        )}
      </div>

      {saveMutation.isError && (
        <p className="text-outflow text-sm mb-4">Ошибка: {(saveMutation.error as Error).message}</p>
      )}
      {unreceiveMutation.isError && (
        <p className="text-outflow text-sm mb-4">Ошибка отмены приёмки: {(unreceiveMutation.error as Error).message}</p>
      )}
      {receiveMutation.isError && (
        <p className="text-outflow text-sm mb-4">Ошибка приёмки: {(receiveMutation.error as Error).message}</p>
      )}
      {deleteMutation.isError && (
        <p className="text-outflow text-sm mb-4">Ошибка удаления: {(deleteMutation.error as Error).message}</p>
      )}

      {/* Basic fields */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="text-text-secondary text-xs block mb-1">Поставщик</label>
          <input
            type="text"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            disabled={!canEdit}
            placeholder="Название поставщика"
            className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-text-secondary text-xs block mb-1">Номер заказа</label>
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            disabled={!canEdit}
            placeholder="ORD-001"
            className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-text-secondary text-xs block mb-1">Заметки</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit}
            placeholder="Примечания"
            className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
          />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="text-text-secondary text-xs block mb-1">Дата заказа</label>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
          />
        </div>
      </div>

      {/* Items table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-text-secondary mb-2">Товары</h2>
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary min-w-[200px]">Товар</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-16">Кол-во</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-24">Цена</th>
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Валюта</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-24">Итого</th>
                {canEdit && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const lineTotal = item.purchase_price * item.ordered_qty

                return (
                  <tr key={item._key} className="border-b border-bg-border">
                    <td className="px-2 py-1.5">
                      {canEdit ? (
                        <ProductSelector
                          value={item.master_card_id ? { master_card_id: item.master_card_id, title: item.title || "" } : null}
                          onChange={(p) => {
                            const qty = item.ordered_qty || 1
                            const tiersPrice = priceFromTiers(p.purchase_price_tiers, qty)
                            const autoPrice = tiersPrice ?? (p.purchase_price != null ? Number(p.purchase_price) : null)
                            setItems((prev) => prev.map((i) =>
                              i._key === item._key
                                ? {
                                    ...i,
                                    master_card_id: p.master_card_id,
                                    title: p.title,
                                    purchase_price_tiers: p.purchase_price_tiers ?? null,
                                    purchase_price: autoPrice != null ? autoPrice : i.purchase_price,
                                    purchase_currency: p.purchase_currency || i.purchase_currency,
                                    _price_auto: autoPrice != null,
                                  }
                                : i,
                            ))
                          }}
                          excludeIds={items.filter((i) => i._key !== item._key && i.master_card_id).map((i) => i.master_card_id)}
                        />
                      ) : (
                        <span>{item.title || item.master_card_id}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput
                        value={item.ordered_qty}
                        onChange={(v) => {
                          if (item._price_auto && item.purchase_price_tiers) {
                            const newPrice = priceFromTiers(item.purchase_price_tiers, v)
                            setItems((prev) => prev.map((i) =>
                              i._key === item._key
                                ? { ...i, ordered_qty: v, purchase_price: newPrice ?? i.purchase_price }
                                : i,
                            ))
                          } else {
                            updateItem(item._key, "ordered_qty", v)
                          }
                        }}
                        disabled={!canEdit}
                        min={1}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput
                        value={item.purchase_price}
                        onChange={(v) => {
                          setItems((prev) => prev.map((i) =>
                            i._key === item._key ? { ...i, purchase_price: v, _price_auto: false } : i,
                          ))
                        }}
                        disabled={!canEdit}
                        step={0.01}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {canEdit ? (
                        <select
                          value={item.purchase_currency || "CNY"}
                          onChange={(e) => updateItem(item._key, "purchase_currency", e.target.value)}
                          className="bg-transparent text-sm text-text-primary rounded border border-transparent hover:border-bg-border focus:border-accent focus:bg-bg-deep focus:outline-none transition-colors px-1 py-1"
                        >
                          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="text-text-secondary text-xs">{item.purchase_currency || "CNY"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                      {lineTotal > 0 ? fmtNumber(lineTotal) : "—"}
                    </td>
                    {canEdit && (
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(item._key)}
                          className="text-text-muted hover:text-outflow text-sm"
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, newItem()])}
            className="mt-2 text-accent hover:text-accent-dark text-sm"
          >
            + Добавить товар
          </button>
        )}
      </div>

      {/* Allocation preview — shown when there are expenses with allocation */}
      {!isNew && allocations.length > 0 && sharedCosts.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Превью себестоимости</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Закупка</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Накладные</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">За ед.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Итого</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.master_card_id} className="border-b border-bg-border">
                  <td className="px-2 py-1.5 truncate max-w-[200px]">{a.title}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a.ordered_qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNumber(a.individual_cost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-accent">{fmtNumber(a.shared_allocation)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtNumber(a.unit_cost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtNumber(a.total_cost)}</td>
                </tr>
              ))}
              <tr className="bg-bg-surface font-semibold">
                <td className="px-2 py-1.5" colSpan={5}>Итого</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {fmtNumber(allocations.reduce((s, a) => s + a.total_cost, 0))} ₽
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Received info (read-only) */}
      {status === "received" && orderData?.supplier_order?.items?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Результат приёмки</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Заказано</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Получено</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">За ед.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Итого</th>
              </tr>
            </thead>
            <tbody>
              {orderData.supplier_order.items.map((item: any) => (
                <tr key={item.id} className="border-b border-bg-border">
                  <td className="px-2 py-1.5 truncate max-w-[200px]">{item.title || item.master_card_id}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{item.ordered_qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{item.received_qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNumber(Number(item.unit_cost || 0))} ₽</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtNumber(Number(item.total_cost || 0))} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unified expenses section */}
      {!isNew && (
        <ExpensesSection orderId={id!} orderNumber={orderNumber} />
      )}

      {/* Receive Modal */}
      {showReceive && orderData?.supplier_order?.items && (
        <ReceiveModal
          items={orderData.supplier_order.items.map((i: any) => ({
            id: i.id,
            master_card_id: i.master_card_id,
            title: i.title || i.master_card_id,
            ordered_qty: i.ordered_qty,
          }))}
          onClose={() => setShowReceive(false)}
          onSubmit={(receiveItems) => receiveMutation.mutate(receiveItems)}
          isPending={receiveMutation.isPending}
        />
      )}
    </div>
  )
}

const ALLOCATION_LABELS: Record<string, string> = {
  none: "Только ДДС",
  equal: "Поровну",
  by_price: "По цене закупки",
}

function ExpensesSection({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState("")
  const [allocationMethod, setAllocationMethod] = useState("none")
  const [saving, setSaving] = useState(false)

  const { data } = useQuery({
    queryKey: ["supplier-payments", orderId],
    queryFn: () => apiGet<{ payments: any[]; total_paid: number }>(`/api/suppliers/${orderId}/payments`),
  })

  const expenses = data?.payments || []

  const deleteMutation = useMutation({
    mutationFn: (txId: string) => apiDelete(`/api/finance/${txId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-payments", orderId] }),
  })

  async function handleAdd() {
    if (!amount || Number(amount) <= 0) return
    setSaving(true)
    try {
      await apiPost(`/api/suppliers/${orderId}/payment`, {
        amount: Number(amount),
        transaction_date: date,
        description: description || `Оплата заявки ${orderNumber || orderId}`,
        allocation_method: allocationMethod,
      })
      queryClient.invalidateQueries({ queryKey: ["supplier-payments", orderId] })
      queryClient.invalidateQueries({ queryKey: ["finance-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["finance-summary"] })
      setAmount("")
      setDescription("")
      setAllocationMethod("none")
      setAddOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-text-secondary">Расходы</h2>
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="text-xs text-accent hover:underline"
        >
          + Добавить расход
        </button>
      </div>

      {addOpen && (
        <div className="bg-bg-surface border border-bg-border rounded p-3 mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Сумма, ₽</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-28 px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-1">Дата</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] text-text-muted mb-1">Описание</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Доставка, карго..."
              className="w-full px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-[11px] text-text-muted mb-1">В себестоимость</label>
            <select
              value={allocationMethod}
              onChange={(e) => setAllocationMethod(e.target.value)}
              className="px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            >
              <option value="none">Только ДДС</option>
              <option value="equal">Поровну по товарам</option>
              <option value="by_price">По цене закупки</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !amount || Number(amount) <= 0}
              className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? "..." : "Сохранить"}
            </button>
            <button
              onClick={() => setAddOpen(false)}
              className="px-3 py-1.5 text-sm rounded border border-bg-border text-text-secondary hover:bg-bg-elevated"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {expenses.length === 0 ? (
        <p className="text-text-muted text-xs py-2">Расходов нет</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-surface border-b border-bg-border">
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</th>
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Описание</th>
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Себестоимость</th>
              <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Сумма</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e: any) => (
              <tr key={e.id} className="border-b border-bg-border">
                <td className="px-2 py-1.5 text-text-secondary text-xs whitespace-nowrap">
                  {new Date(e.transaction_date).toLocaleDateString("ru-RU")}
                </td>
                <td className="px-2 py-1.5 text-xs truncate max-w-[200px]">{e.description || "—"}</td>
                <td className="px-2 py-1.5 text-xs text-text-secondary">
                  {ALLOCATION_LABELS[e.metadata?.allocation_method] || ALLOCATION_LABELS.none}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-outflow font-medium">
                  -{Math.round(Number(e.amount)).toLocaleString("ru-RU")} ₽
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => { if (confirm("Удалить расход?")) deleteMutation.mutate(e.id) }}
                    className="text-text-muted hover:text-outflow"
                    title="Удалить"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Tiny inline number input
function NumInput({
  value,
  onChange,
  disabled,
  min = 0,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  min?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value || ""}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      disabled={disabled}
      min={min}
      step={step}
      className="no-spin w-full px-2 py-1 bg-transparent text-sm text-right tabular-nums text-text-primary rounded border border-transparent hover:border-bg-border focus:border-accent focus:bg-bg-deep focus:outline-none disabled:opacity-60 transition-colors"
    />
  )
}
