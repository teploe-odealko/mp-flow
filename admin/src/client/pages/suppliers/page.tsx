import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"

export default function SuppliersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiGet("/api/suppliers"),
  })

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Закупки</h1>
      {isLoading ? <p className="text-text-secondary">Загрузка...</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="p-2">Поставщик</th>
              <th className="p-2">Номер</th>
              <th className="p-2">Статус</th>
              <th className="p-2 text-right">Позиций</th>
              <th className="p-2 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {data?.supplier_orders?.map((o: any) => (
              <tr key={o.id} className="border-b border-bg-border hover:bg-bg-elevated">
                <td className="p-2">{o.supplier_name}</td>
                <td className="p-2 text-text-secondary">{o.order_number || "—"}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    o.status === "received" ? "bg-inflow/20 text-inflow" :
                    o.status === "draft" ? "bg-text-muted/20 text-text-muted" :
                    "bg-accent/20 text-accent"
                  }`}>{o.status}</span>
                </td>
                <td className="p-2 text-right">{o.items_count}</td>
                <td className="p-2 text-right">{o.calculated_total?.toLocaleString()} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
