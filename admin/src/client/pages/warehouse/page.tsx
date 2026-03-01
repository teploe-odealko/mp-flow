import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"

export default function WarehousePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => apiGet("/api/inventory"),
  })

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Склад</h1>
      {data?.totals && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs">Товаров</p>
            <p className="text-2xl font-semibold">{data.totals.products}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs">На складе</p>
            <p className="text-2xl font-semibold">{data.totals.warehouse_stock}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs">Стоимость</p>
            <p className="text-2xl font-semibold">{data.totals.stock_value?.toLocaleString()} ₽</p>
          </div>
        </div>
      )}
      {isLoading ? <p className="text-text-secondary">Загрузка...</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="p-2">Товар</th>
              <th className="p-2 text-right">Заказано</th>
              <th className="p-2 text-right">Получено</th>
              <th className="p-2 text-right">На складе</th>
              <th className="p-2 text-right">Ср. себестоимость</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows?.map((r: any) => (
              <tr key={r.card_id} className="border-b border-bg-border hover:bg-bg-elevated">
                <td className="p-2">{r.product_title}</td>
                <td className="p-2 text-right">{r.ordered_qty}</td>
                <td className="p-2 text-right">{r.received_qty}</td>
                <td className="p-2 text-right">{r.warehouse_stock}</td>
                <td className="p-2 text-right">{r.avg_cost?.toFixed(2)} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
