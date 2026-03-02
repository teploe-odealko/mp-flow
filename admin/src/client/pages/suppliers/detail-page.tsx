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
}

function newItem(): ItemDraft {
  return {
    _key: crypto.randomUUID(),
    master_card_id: "",
    title: "",
    ordered_qty: 1,
    cny_price_per_unit: 0,
    purchase_price_rub: 0,
    packaging_cost_rub: 0,
    logistics_cost_rub: 0,
    customs_cost_rub: 0,
    extra_cost_rub: 0,
  }
}

function newSharedCost(): SharedCostEntry {
  return { name: "", total_rub: 0, method: "equal" }
}

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("ru-RU")
}

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
  const [sharedCosts, setSharedCosts] = useState<SharedCostEntry[]>([])
  const [showReceive, setShowReceive] = useState(false)

  // Load existing order
  const { data: orderData, isLoading } = useQuery({
    queryKey: ["supplier-order", id],
    queryFn: () => apiGet<any>(`/api/suppliers/${id}`),
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
    const sc = typeof o.shared_costs === "string" ? JSON.parse(o.shared_costs) : o.shared_costs
    setSharedCosts(Array.isArray(sc) && sc.length > 0 ? sc : [])

    if (o.items?.length) {
      setItems(
        o.items.map((item: any) => ({
          _key: item.id || crypto.randomUUID(),
          id: item.id,
          master_card_id: item.master_card_id,
          title: item.title || item.master_card_id,
          ordered_qty: item.ordered_qty || 0,
          cny_price_per_unit: Number(item.cny_price_per_unit) || 0,
          purchase_price_rub: Number(item.purchase_price_rub) || 0,
          packaging_cost_rub: Number(item.packaging_cost_rub) || 0,
          logistics_cost_rub: Number(item.logistics_cost_rub) || 0,
          customs_cost_rub: Number(item.customs_cost_rub) || 0,
          extra_cost_rub: Number(item.extra_cost_rub) || 0,
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
      shared_costs: sharedCosts.filter((c) => c.name && c.total_rub > 0),
      items: validItems.map((i) => ({
        master_card_id: i.master_card_id,
        ordered_qty: i.ordered_qty,
        cny_price_per_unit: i.cny_price_per_unit,
        purchase_price_rub: i.purchase_price_rub,
        packaging_cost_rub: i.packaging_cost_rub,
        logistics_cost_rub: i.logistics_cost_rub,
        customs_cost_rub: i.customs_cost_rub,
        extra_cost_rub: i.extra_cost_rub,
      })),
    }
  }

  function handleSave() {
    saveMutation.mutate(buildPayload())
  }

  function handleMarkOrdered() {
    if (!id) return
    const payload = {
      ...buildPayload(),
      status: "ordered",
    }
    saveMutation.mutate(payload)
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

  // Shared cost helpers
  function updateSharedCost(index: number, field: string, value: any) {
    setSharedCosts((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  function removeSharedCost(index: number) {
    setSharedCosts((prev) => prev.filter((_, i) => i !== index))
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
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Цена ¥</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Цена ₽</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Упак.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Логист.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Тамож.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20">Доп.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-24">Итого</th>
                {canEdit && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const lineTotal =
                  (item.purchase_price_rub + item.packaging_cost_rub + item.logistics_cost_rub +
                    item.customs_cost_rub + item.extra_cost_rub) * item.ordered_qty

                return (
                  <tr key={item._key} className="border-b border-bg-border">
                    <td className="px-2 py-1.5">
                      {canEdit ? (
                        <ProductSelector
                          value={item.master_card_id ? { master_card_id: item.master_card_id, title: item.title } : null}
                          onChange={(p) => {
                            updateItem(item._key, "master_card_id", p.master_card_id)
                            updateItem(item._key, "title", p.title)
                          }}
                        />
                      ) : (
                        <span>{item.title || item.master_card_id}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.ordered_qty} onChange={(v) => updateItem(item._key, "ordered_qty", v)} disabled={!canEdit} min={1} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.cny_price_per_unit} onChange={(v) => updateItem(item._key, "cny_price_per_unit", v)} disabled={!canEdit} step={0.01} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.purchase_price_rub} onChange={(v) => updateItem(item._key, "purchase_price_rub", v)} disabled={!canEdit} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.packaging_cost_rub} onChange={(v) => updateItem(item._key, "packaging_cost_rub", v)} disabled={!canEdit} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.logistics_cost_rub} onChange={(v) => updateItem(item._key, "logistics_cost_rub", v)} disabled={!canEdit} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.customs_cost_rub} onChange={(v) => updateItem(item._key, "customs_cost_rub", v)} disabled={!canEdit} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={item.extra_cost_rub} onChange={(v) => updateItem(item._key, "extra_cost_rub", v)} disabled={!canEdit} />
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

      {/* Shared costs */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-text-secondary mb-2">Общие расходы</h2>
        {sharedCosts.length > 0 && (
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Название</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-28">Сумма ₽</th>
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-40">Метод</th>
                {canEdit && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {sharedCosts.map((cost, i) => (
                <tr key={i} className="border-b border-bg-border">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={cost.name}
                      onChange={(e) => updateSharedCost(i, "name", e.target.value)}
                      disabled={!canEdit}
                      placeholder="Доставка, Карго..."
                      className="w-full px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumInput value={cost.total_rub} onChange={(v) => updateSharedCost(i, "total_rub", v)} disabled={!canEdit} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={cost.method}
                      onChange={(e) => updateSharedCost(i, "method", e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary disabled:opacity-60"
                    >
                      <option value="equal">Поровну</option>
                      <option value="by_cny_price">По цене ¥</option>
                      <option value="by_weight">По весу</option>
                      <option value="by_volume">По объёму</option>
                    </select>
                  </td>
                  {canEdit && (
                    <td className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeSharedCost(i)}
                        className="text-text-muted hover:text-outflow text-sm"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setSharedCosts((prev) => [...prev, newSharedCost()])}
            className="text-accent hover:text-accent-dark text-sm"
          >
            + Добавить расход
          </button>
        )}
      </div>

      {/* Allocation preview */}
      {allocations.length > 0 && sharedCosts.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Превью себестоимости</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Индив.</th>
                <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Общие</th>
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
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtNumber(grandTotal)} ₽</td>
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
      className="w-full px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-right tabular-nums text-text-primary disabled:opacity-60"
    />
  )
}
