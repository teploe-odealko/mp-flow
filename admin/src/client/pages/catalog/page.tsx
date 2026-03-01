import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"

export default function CatalogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => apiGet("/api/catalog"),
  })

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Каталог</h1>
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border text-text-secondary text-left">
                <th className="p-2">Название</th>
                <th className="p-2">SKU</th>
                <th className="p-2">Статус</th>
                <th className="p-2 text-right">Склад</th>
                <th className="p-2 text-right">Ср. себестоимость</th>
              </tr>
            </thead>
            <tbody>
              {data?.products?.map((p: any) => (
                <tr key={p.id} className="border-b border-bg-border hover:bg-bg-elevated">
                  <td className="p-2">{p.title}</td>
                  <td className="p-2 text-text-secondary">{p.sku || "—"}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      p.status === "active" ? "bg-inflow/20 text-inflow" :
                      p.status === "draft" ? "bg-risk/20 text-risk" :
                      "bg-text-muted/20 text-text-muted"
                    }`}>{p.status}</span>
                  </td>
                  <td className="p-2 text-right">{p.warehouse_stock}</td>
                  <td className="p-2 text-right">{p.avg_cost?.toFixed(2)} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.products?.length && <p className="text-text-secondary mt-4 text-center">Нет товаров</p>}
        </div>
      )}
    </div>
  )
}
