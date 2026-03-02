import { useState } from "react"

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
  onSubmit: (items: Array<{ item_id: string; received_qty: number }>) => void
  isPending: boolean
}

export function ReceiveModal({ items, onClose, onSubmit, isPending }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of items) {
      init[item.id] = item.ordered_qty
    }
    return init
  })

  function handleSubmit() {
    const result = items.map((item) => ({
      item_id: item.id,
      received_qty: quantities[item.id] || 0,
    }))
    onSubmit(result)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-5 w-[560px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
            {items.map((item) => (
              <tr key={item.id} className="border-b border-bg-border">
                <td className="py-1.5 pr-2 truncate max-w-[280px]">{item.title || item.master_card_id}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{item.ordered_qty}</td>
                <td className="py-1.5 pl-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={item.ordered_qty * 2}
                    value={quantities[item.id] || 0}
                    onChange={(e) => setQuantities({ ...quantities, [item.id]: Number(e.target.value) })}
                    className="w-20 px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-right tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
