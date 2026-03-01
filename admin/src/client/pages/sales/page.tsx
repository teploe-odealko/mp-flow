import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"

export default function SalesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: () => apiGet("/api/sales"),
  })

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Продажи</h1>
      {data?.stats && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs">Продаж</p>
            <p className="text-2xl font-semibold">{data.stats.count}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs">Выручка</p>
            <p className="text-2xl font-semibold">{data.stats.total_revenue?.toLocaleString()} ₽</p>
          </div>
        </div>
      )}
      {isLoading ? <p className="text-text-secondary">Загрузка...</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="p-2">Товар</th>
              <th className="p-2">Канал</th>
              <th className="p-2">Статус</th>
              <th className="p-2 text-right">Кол-во</th>
              <th className="p-2 text-right">Выручка</th>
              <th className="p-2 text-right">Дата</th>
            </tr>
          </thead>
          <tbody>
            {data?.sales?.map((s: any) => (
              <tr key={s.id} className="border-b border-bg-border hover:bg-bg-elevated">
                <td className="p-2">{s.product_name || s.channel_sku || "—"}</td>
                <td className="p-2">{s.channel}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    s.status === "delivered" ? "bg-inflow/20 text-inflow" :
                    s.status === "returned" ? "bg-loss/20 text-loss" :
                    "bg-accent/20 text-accent"
                  }`}>{s.status}</span>
                </td>
                <td className="p-2 text-right">{s.quantity}</td>
                <td className="p-2 text-right">{Number(s.revenue).toLocaleString()} ₽</td>
                <td className="p-2 text-right text-text-secondary">{new Date(s.sold_at).toLocaleDateString("ru")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
