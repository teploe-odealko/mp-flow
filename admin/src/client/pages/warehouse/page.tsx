import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost } from "../../lib/api"

interface BreakdownEntry {
  source: string
  label: string
  qty: number
}

interface InventoryRow {
  card_id: string
  product_title: string
  sku: string
  thumbnail?: string
  received_qty: number
  stock_total: number
  stock_breakdown: BreakdownEntry[]
  sold_total: number
  sold_breakdown: BreakdownEntry[]
  delivering_total: number
  delivering_breakdown: BreakdownEntry[]
  written_off_qty: number
  discrepancy: number
  avg_cost: number
  has_cost: boolean
}

interface Totals {
  products: number
  stock_total: number
  stock_value: number
  no_cost_count: number
}

function BreakdownTooltip({ breakdown, children }: { breakdown: BreakdownEntry[]; children: React.ReactNode }) {
  const [show, setShow] = useState(false)

  if (!breakdown || breakdown.length <= 1) return <>{children}</>

  return (
    <span
      className="relative cursor-default"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="border-b border-dotted border-text-muted">{children}</span>
      {show && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 bg-bg-deep border border-bg-border rounded px-2 py-1.5 shadow-lg whitespace-nowrap text-xs">
          {breakdown.filter((e) => e.qty !== 0).map((e) => (
            <div key={e.source} className="flex justify-between gap-3">
              <span className="text-text-secondary">{e.label}</span>
              <span className="font-medium">{e.qty}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

function AssignCostModal({
  row,
  onClose,
  onSubmit,
  isPending,
}: {
  row: InventoryRow
  onClose: () => void
  onSubmit: (data: { master_card_id: string; quantity: number; unit_cost_rub: number }) => void
  isPending: boolean
}) {
  const [quantity, setQuantity] = useState(row.discrepancy > 0 ? row.discrepancy : 1)
  const [unitCost, setUnitCost] = useState("")

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-5 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-1">Оприходование</h3>
        <p className="text-text-secondary text-sm mb-4">{row.product_title}</p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Количество</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Себестоимость за ед., ₽</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onSubmit({ master_card_id: row.card_id, quantity, unit_cost_rub: Number(unitCost) })}
            disabled={isPending || !unitCost || Number(unitCost) <= 0 || quantity <= 0}
            className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {isPending ? "Сохраняю..." : "Оприходовать"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-text-secondary text-sm hover:text-text-primary">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

function WriteOffModal({
  row,
  onClose,
  onSubmit,
  isPending,
}: {
  row: InventoryRow
  onClose: () => void
  onSubmit: (data: { master_card_id: string; quantity: number; reason: string }) => void
  isPending: boolean
}) {
  const [quantity, setQuantity] = useState(row.discrepancy > 0 ? row.discrepancy : 1)
  const [reason, setReason] = useState("")

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-5 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-1">Списание</h3>
        <p className="text-text-secondary text-sm mb-4">{row.product_title}</p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Количество</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Причина</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Расхождение, потери и т.д."
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onSubmit({ master_card_id: row.card_id, quantity, reason })}
            disabled={isPending || quantity <= 0}
            className="px-3 py-1.5 bg-outflow text-white rounded text-sm hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Списываю..." : "Списать"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-text-secondary text-sm hover:text-text-primary">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WarehousePage() {
  const queryClient = useQueryClient()
  const [assignRow, setAssignRow] = useState<InventoryRow | null>(null)
  const [writeOffRow, setWriteOffRow] = useState<InventoryRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => apiGet<{ rows: InventoryRow[]; totals: Totals }>("/api/inventory"),
  })

  const assignMutation = useMutation({
    mutationFn: (d: { master_card_id: string; quantity: number; unit_cost_rub: number }) =>
      apiPost("/api/inventory", { action: "assign-cost", ...d }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
      setAssignRow(null)
    },
  })

  const writeOffMutation = useMutation({
    mutationFn: (d: { master_card_id: string; quantity: number; reason: string }) =>
      apiPost("/api/inventory", { action: "write-off", ...d }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
      setWriteOffRow(null)
    },
  })

  const rows = data?.rows || []
  const totals = data?.totals

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Склад</h1>

      {totals && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">Товаров</p>
            <p className="text-2xl font-semibold">{totals.products}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">На складах</p>
            <p className="text-2xl font-semibold">{totals.stock_total}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">Стоимость запасов</p>
            <p className="text-2xl font-semibold">{totals.stock_value?.toLocaleString()} ₽</p>
          </div>
          <div className={`bg-bg-surface border rounded-lg p-4 ${totals.no_cost_count > 0 ? "border-outflow" : "border-bg-border"}`}>
            <p className="text-text-secondary text-xs mb-1">Без себестоимости</p>
            <p className={`text-2xl font-semibold ${totals.no_cost_count > 0 ? "text-outflow" : ""}`}>
              {totals.no_cost_count}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : rows.length === 0 ? (
        <p className="text-text-secondary">Нет товаров. Синхронизируйте данные на странице Ozon.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="p-2">Товар</th>
              <th className="p-2 text-right">Получено</th>
              <th className="p-2 text-right">На складах</th>
              <th className="p-2 text-right">Продано</th>
              <th className="p-2 text-right">В доставке</th>
              <th className="p-2 text-right">Списано</th>
              <th className="p-2 text-right">Расхожд.</th>
              <th className="p-2 text-right">С/с</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.card_id}
                className={`border-b border-bg-border hover:bg-bg-elevated ${!r.has_cost ? "border-l-2 border-l-outflow" : ""}`}
              >
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    {r.thumbnail && (
                      <img src={r.thumbnail} alt="" className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <div className="truncate max-w-[200px]">{r.product_title}</div>
                      {r.sku && <div className="text-text-muted text-xs font-mono">{r.sku}</div>}
                    </div>
                  </div>
                </td>
                <td className="p-2 text-right">{r.received_qty}</td>
                <td className="p-2 text-right">
                  <BreakdownTooltip breakdown={r.stock_breakdown}>
                    {r.stock_total}
                  </BreakdownTooltip>
                </td>
                <td className="p-2 text-right">
                  <BreakdownTooltip breakdown={r.sold_breakdown}>
                    {r.sold_total || "—"}
                  </BreakdownTooltip>
                </td>
                <td className="p-2 text-right">
                  <BreakdownTooltip breakdown={r.delivering_breakdown}>
                    {r.delivering_total || "—"}
                  </BreakdownTooltip>
                </td>
                <td className="p-2 text-right">{r.written_off_qty || "—"}</td>
                <td className="p-2 text-right">
                  {r.discrepancy !== 0 ? (
                    <span className={r.discrepancy > 0 ? "text-yellow-500" : "text-outflow"}>
                      {r.discrepancy > 0 ? `+${r.discrepancy}` : r.discrepancy}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-2 text-right">
                  {r.has_cost ? `${r.avg_cost.toFixed(0)} ₽` : (
                    <span className="text-outflow">нет</span>
                  )}
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  {!r.has_cost && (
                    <button
                      onClick={() => setAssignRow(r)}
                      className="text-accent hover:text-accent-dark text-xs mr-2"
                    >
                      Оприходовать
                    </button>
                  )}
                  {r.discrepancy > 0 && (
                    <button
                      onClick={() => setWriteOffRow(r)}
                      className="text-text-muted hover:text-outflow text-xs"
                    >
                      Списать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {assignRow && (
        <AssignCostModal
          row={assignRow}
          onClose={() => setAssignRow(null)}
          onSubmit={(d) => assignMutation.mutate(d)}
          isPending={assignMutation.isPending}
        />
      )}

      {writeOffRow && (
        <WriteOffModal
          row={writeOffRow}
          onClose={() => setWriteOffRow(null)}
          onSubmit={(d) => writeOffMutation.mutate(d)}
          isPending={writeOffMutation.isPending}
        />
      )}
    </div>
  )
}
