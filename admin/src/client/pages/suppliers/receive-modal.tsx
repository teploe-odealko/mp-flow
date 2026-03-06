import { useState, useMemo } from "react"

type WriteOffMethod = "ignore" | "redistribute" | "expense"

interface OrderItem {
  id: string
  master_card_id: string
  title?: string
  ordered_qty: number
  received_qty?: number
}

interface Props {
  items: OrderItem[]
  onClose: () => void
  onSubmit: (items: Array<{ item_id: string; received_qty: number }>, write_off_method?: WriteOffMethod) => void
  isPending: boolean
}

const METHOD_OPTIONS: Array<{ value: WriteOffMethod; label: string; description: string }> = [
  { value: "ignore", label: "Не учитывать", description: "Убрать недостачу из остатков без финансовых последствий" },
  { value: "redistribute", label: "Распределить по себестоимости", description: "Стоимость недостающих товаров поглощается принятыми (повышает unit cost)" },
  { value: "expense", label: "Списать как потери", description: "Создать статью расходов «Потери» на сумму недостачи" },
]

export function ReceiveModal({ items, onClose, onSubmit, isPending }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of items) {
      init[item.id] = item.ordered_qty
    }
    return init
  })
  const [writeOffMethod, setWriteOffMethod] = useState<WriteOffMethod>("ignore")

  const hasShortfall = useMemo(
    () => items.some((item) => (quantities[item.id] || 0) < item.ordered_qty),
    [items, quantities],
  )

  function handleSubmit() {
    const result = items.map((item) => ({
      item_id: item.id,
      received_qty: quantities[item.id] || 0,
    }))
    onSubmit(result, hasShortfall ? writeOffMethod : undefined)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-5 w-[560px] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-4">Приёмка товара</h3>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="py-1.5 pr-2">Товар</th>
              <th className="py-1.5 px-2 text-right w-20">Заказано</th>
              <th className="py-1.5 pl-2 text-right w-28">Получено</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const received = quantities[item.id] || 0
              const isShort = received < item.ordered_qty
              return (
                <tr key={item.id} className="border-b border-bg-border">
                  <td className="py-1.5 pr-2 truncate max-w-[280px]">{item.title || item.master_card_id}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{item.ordered_qty}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {isShort && <span className="text-xs text-outflow tabular-nums">−{item.ordered_qty - received}</span>}
                      <input
                        type="number"
                        min={0}
                        max={item.ordered_qty * 2}
                        value={received}
                        onChange={(e) => setQuantities({ ...quantities, [item.id]: Number(e.target.value) })}
                        className={`w-20 px-2 py-1 bg-bg-deep border rounded text-sm text-right tabular-nums ${isShort ? "border-outflow/50" : "border-bg-border"}`}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {hasShortfall && (
          <div className="mb-4 border border-outflow/30 rounded-lg p-3 bg-outflow/5">
            <p className="text-xs font-medium text-outflow mb-2">Обнаружена недостача — выберите способ списания:</p>
            <div className="space-y-2">
              {METHOD_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="write_off_method"
                    value={opt.value}
                    checked={writeOffMethod === opt.value}
                    onChange={() => setWriteOffMethod(opt.value)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <span className="text-sm text-text-primary">{opt.label}</span>
                    <p className="text-xs text-text-muted">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-3 py-1.5 bg-inflow text-white rounded text-sm hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Принимаю..." : "Принять"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-text-secondary text-sm hover:text-text-primary">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
