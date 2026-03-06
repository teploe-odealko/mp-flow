import React, { useState, useEffect, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPut, apiDelete } from "../../lib/api"
import { useUrlNumber } from "../../lib/use-url-state"
import type { MasterCardTabProps } from "./tab-types"

// Discover plugin tabs via Vite glob (eager — small components, need labels immediately)
const pluginTabModules = import.meta.glob<{
  default: React.ComponentType<MasterCardTabProps>
  tabLabel?: string
  tabOrder?: number
}>("../../../../plugins/*/src/client/tabs/master-card.tsx", { eager: true })

interface PluginTab {
  dirName: string
  label: string
  order: number
  Component: React.ComponentType<MasterCardTabProps>
}

const allPluginTabs: PluginTab[] = []
for (const path in pluginTabModules) {
  const mod = pluginTabModules[path]
  const match = path.match(/\/plugins\/([^/]+)\//)
  const dirName = match ? match[1] : "plugin"
  allPluginTabs.push({
    dirName,
    label: mod.tabLabel || dirName,
    order: mod.tabOrder ?? 10,
    Component: mod.default,
  })
}
allPluginTabs.sort((a, b) => a.order - b.order)

const CURRENCIES = ["CNY", "RUB", "USD"]

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("ru-RU")
}

export default function CatalogDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useUrlNumber("tab")

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["catalog-product", id],
    queryFn: () => apiGet<any>(`/api/catalog/${id}`),
    enabled: !!id,
  })

  const { data: pluginsData } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => apiGet<any>("/api/plugins"),
  })

  // Filter tabs to only show enabled plugins
  const enabledTabs = useMemo(() => {
    if (!pluginsData?.plugins) return []
    const enabledDirs = new Set(
      pluginsData.plugins
        .filter((p: any) => p.is_enabled)
        .map((p: any) => p.name.replace("mpflow-plugin-", ""))
    )
    return allPluginTabs.filter((t) => enabledDirs.has(t.dirName))
  }, [pluginsData])

  const product = data?.product

  // Form state
  const [title, setTitle] = useState("")
  const [purchasePrice, setPurchasePrice] = useState<number | string>("")
  const [purchaseCurrency, setPurchaseCurrency] = useState("CNY")
  const [status, setStatus] = useState("draft")
  const [weightG, setWeightG] = useState<number | string>("")
  const [lengthMm, setLengthMm] = useState<number | string>("")
  const [widthMm, setWidthMm] = useState<number | string>("")
  const [heightMm, setHeightMm] = useState<number | string>("")

  useEffect(() => {
    if (!product) return
    setTitle(product.title || "")
    setPurchasePrice(product.purchase_price != null ? product.purchase_price : "")
    setPurchaseCurrency(product.purchase_currency || "CNY")
    setStatus(product.status || "draft")
    setWeightG(product.weight_g != null ? product.weight_g : "")
    setLengthMm(product.length_mm != null ? product.length_mm : "")
    setWidthMm(product.width_mm != null ? product.width_mm : "")
    setHeightMm(product.height_mm != null ? product.height_mm : "")
  }, [product])

  const saveMutation = useMutation({
    mutationFn: (payload: any) => apiPut(`/api/catalog/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-product", id] })
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
    },
  })

  // Movement editing state
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ quantity: string; unit_cost: string; write_off_method: string; notes: string }>({
    quantity: "", unit_cost: "", write_off_method: "", notes: "",
  })

  const updateMovementMutation = useMutation({
    mutationFn: ({ movId, data }: { movId: string; data: any }) =>
      apiPut(`/api/inventory/movements/${movId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-product", id] })
      setEditingMovementId(null)
    },
  })

  const deleteMovementMutation = useMutation({
    mutationFn: (movId: string) => apiDelete(`/api/inventory/movements/${movId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-product", id] })
    },
  })

  function startEditMovement(m: any) {
    setEditingMovementId(m.id)
    setEditForm({
      quantity: String(m.quantity),
      unit_cost: String(m.unit_cost),
      write_off_method: m.write_off_method || "",
      notes: m.notes || "",
    })
  }

  function saveMovement(movId: string) {
    updateMovementMutation.mutate({
      movId,
      data: {
        quantity: Number(editForm.quantity),
        unit_cost: Number(editForm.unit_cost),
        write_off_method: editForm.write_off_method || null,
        notes: editForm.notes || null,
      },
    })
  }

  function handleSave() {
    saveMutation.mutate({
      title,
      purchase_price: purchasePrice !== "" ? Number(purchasePrice) : null,
      purchase_currency: purchaseCurrency,
      status,
      weight_g: weightG !== "" ? Number(weightG) : null,
      length_mm: lengthMm !== "" ? Number(lengthMm) : null,
      width_mm: widthMm !== "" ? Number(widthMm) : null,
      height_mm: heightMm !== "" ? Number(heightMm) : null,
    })
  }

  const tabs = [
    { label: "Основное", id: "core" },
    ...enabledTabs.map((t, i) => ({ label: t.label, id: `plugin-${i}` })),
  ]

  if (isLoading) {
    return <p className="text-text-secondary">Загрузка...</p>
  }

  if (!product) {
    return <p className="text-text-secondary">Товар не найден</p>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/catalog")}
          className="text-text-secondary hover:text-text-primary text-sm"
        >
          ← Каталог
        </button>
        <h1 className="text-xl font-semibold flex-1 truncate">{product.title}</h1>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="flex gap-0 border-b border-bg-border mb-6">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === i
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Core tab */}
      {activeTab === 0 && (
        <div>
          {/* Edit form */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2">
              <label className="text-text-secondary text-xs block mb-1">Название</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="text-text-secondary text-xs block mb-1">Статус</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
              >
                <option value="draft">Черновик</option>
                <option value="active">Активный</option>
                <option value="archived">Архив</option>
              </select>
            </div>
          </div>

          {/* Pricing block */}
          <div className="mb-6 border border-bg-border rounded p-4">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Цена закупки</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-text-secondary text-xs block mb-1">Цена</label>
                <input
                  type="number"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="—"
                  step="0.01"
                  className="no-spin w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="text-text-secondary text-xs block mb-1">Валюта</label>
                <select
                  value={purchaseCurrency}
                  onChange={(e) => setPurchaseCurrency(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {product.purchase_price_tiers?.length > 0 && (
                <div className="col-span-2">
                  <label className="text-text-secondary text-xs block mb-2">Таблица закупочных цен</label>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bg-border">
                        <th className="text-left pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Количество от</th>
                        <th className="text-right pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Цена за ед.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.purchase_price_tiers.map((tier: { min_qty: number; price: number }) => (
                        <tr key={tier.min_qty} className="border-b border-bg-border last:border-0">
                          <td className="py-1.5 text-text-secondary">{tier.min_qty} шт.</td>
                          <td className="py-1.5 text-right tabular-nums font-medium">
                            {tier.price.toFixed(2)} {product.purchase_currency || "CNY"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Weight & dimensions block */}
          <div className="mb-6 border border-bg-border rounded p-4">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Вес и габариты</div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="text-text-secondary text-xs block mb-1">Вес, г</label>
                <input
                  type="number"
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  placeholder="—"
                  className="no-spin w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="text-text-secondary text-xs block mb-1">Длина, мм</label>
                <input
                  type="number"
                  value={lengthMm}
                  onChange={(e) => setLengthMm(e.target.value)}
                  placeholder="—"
                  className="no-spin w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="text-text-secondary text-xs block mb-1">Ширина, мм</label>
                <input
                  type="number"
                  value={widthMm}
                  onChange={(e) => setWidthMm(e.target.value)}
                  placeholder="—"
                  className="no-spin w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="text-text-secondary text-xs block mb-1">Высота, мм</label>
                <input
                  type="number"
                  value={heightMm}
                  onChange={(e) => setHeightMm(e.target.value)}
                  placeholder="—"
                  className="no-spin w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-6">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || !title}
              className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
            >
              {saveMutation.isPending ? "Сохраняю..." : "Сохранить"}
            </button>
            {saveMutation.isError && (
              <span className="text-outflow text-sm self-center">Ошибка: {(saveMutation.error as Error).message}</span>
            )}
            {saveMutation.isSuccess && (
              <span className="text-inflow text-sm self-center">Сохранено</span>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-bg-surface rounded p-3 border border-bg-border">
              <div className="text-text-muted text-xs mb-1">Склад</div>
              <div className="text-lg font-semibold tabular-nums">{product.warehouse_stock || 0} шт.</div>
            </div>
            <div className="bg-bg-surface rounded p-3 border border-bg-border">
              <div className="text-text-muted text-xs mb-1">Ср. себестоимость</div>
              <div className="text-lg font-semibold tabular-nums">
                {product.avg_cost > 0 ? `${fmtNumber(product.avg_cost)} ₽` : "—"}
              </div>
            </div>
          </div>

          {/* Unified movements history */}
          {product.stock_movements?.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-text-secondary mb-2">История движений</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-surface border-b border-bg-border">
                    <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</th>
                    <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Тип</th>
                    <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</th>
                    <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">За ед.</th>
                    <th className="text-right px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Итого</th>
                    <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Метод</th>
                    <th className="text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Причина</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {product.stock_movements.map((m: any) => {
                    const isEdit = editingMovementId === m.id
                    const canEdit = m.type !== "supplier_receive"
                    const typeLabel = m.type === "supplier_receive" ? "Поставка"
                      : m.type === "initial_balance" ? "Оприходование"
                      : m.type === "write_off" ? "Списание" : m.type
                    const methodLabel = m.write_off_method === "ignore" ? "Не учитывать"
                      : m.write_off_method === "redistribute" ? "Перераспределить"
                      : m.write_off_method === "expense" ? "Потери"
                      : null
                    const sign = m.direction === "in" ? "+" : "−"
                    const signClass = m.direction === "in" ? "text-inflow" : "text-outflow"

                    if (isEdit) {
                      return (
                        <tr key={m.id} className="border-b border-bg-border bg-bg-elevated">
                          <td className="px-2 py-1.5 text-text-muted text-xs">
                            {new Date(m.moved_at).toLocaleDateString("ru-RU")}
                          </td>
                          <td className="px-2 py-1.5 text-text-secondary">{typeLabel}</td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={1}
                              value={editForm.quantity}
                              onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                              className="w-16 px-1 py-0.5 bg-bg-deep border border-bg-border rounded text-xs text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={editForm.unit_cost}
                              onChange={(e) => setEditForm((f) => ({ ...f, unit_cost: e.target.value }))}
                              className="w-20 px-1 py-0.5 bg-bg-deep border border-bg-border rounded text-xs text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-text-muted text-xs">
                            {(Number(editForm.quantity) * Number(editForm.unit_cost)).toFixed(0)} ₽
                          </td>
                          {m.type === "write_off" ? (
                            <td className="px-2 py-1.5">
                              <select
                                value={editForm.write_off_method}
                                onChange={(e) => setEditForm((f) => ({ ...f, write_off_method: e.target.value }))}
                                className="px-1 py-0.5 bg-bg-deep border border-bg-border rounded text-xs"
                              >
                                <option value="ignore">Не учитывать</option>
                                <option value="redistribute">Перераспределить</option>
                                <option value="expense">Потери</option>
                              </select>
                            </td>
                          ) : (
                            <td className="px-2 py-1.5 text-text-muted">—</td>
                          )}
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={editForm.notes}
                              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                              placeholder="Причина..."
                              className="w-full px-1 py-0.5 bg-bg-deep border border-bg-border rounded text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => saveMovement(m.id)}
                              disabled={updateMovementMutation.isPending}
                              className="text-accent hover:text-accent-dark text-xs mr-2"
                            >
                              {updateMovementMutation.isPending ? "..." : "Сохр."}
                            </button>
                            <button
                              onClick={() => setEditingMovementId(null)}
                              className="text-text-muted hover:text-text-primary text-xs"
                            >
                              Отмена
                            </button>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={m.id} className="border-b border-bg-border hover:bg-bg-elevated">
                        <td className="px-2 py-1.5 text-text-muted text-xs">
                          {new Date(m.moved_at).toLocaleDateString("ru-RU")}
                        </td>
                        <td className="px-2 py-1.5">
                          {m.type === "supplier_receive" && m.reference_id ? (
                            <button
                              onClick={() => {
                                const so = product.supplier_orders?.find((s: any) => s.id === m.reference_id)
                                if (so) navigate(`/suppliers/${so.supplier_order_id}`)
                              }}
                              className="text-accent hover:underline text-xs"
                            >
                              {typeLabel} ↗
                            </button>
                          ) : (
                            <span className="text-text-secondary">{typeLabel}</span>
                          )}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${signClass}`}>
                          {sign}{m.quantity}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">
                          {Number(m.unit_cost) > 0 ? `${fmtNumber(Number(m.unit_cost))} ₽` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {Number(m.total_cost) > 0 ? `${fmtNumber(Number(m.total_cost))} ₽` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-text-muted text-xs">
                          {methodLabel || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-text-secondary text-xs max-w-[150px] truncate">
                          {m.notes || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {canEdit && (
                            <>
                              <button
                                onClick={() => startEditMovement(m)}
                                className="text-text-muted hover:text-accent text-xs mr-2"
                                title="Редактировать"
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm("Удалить запись?")) deleteMovementMutation.mutate(m.id)
                                }}
                                disabled={deleteMovementMutation.isPending}
                                className="text-text-muted hover:text-outflow text-xs"
                                title="Удалить"
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Plugin tabs */}
      {activeTab > 0 && enabledTabs[activeTab - 1] && (
        React.createElement(enabledTabs[activeTab - 1].Component, {
          productId: id!,
          product,
          onRefresh: () => refetch(),
        })
      )}
    </div>
  )
}
