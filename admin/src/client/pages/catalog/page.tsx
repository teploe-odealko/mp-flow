import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { apiGet } from "../../lib/api"
import { DocTableHeader } from "../../components/doc-table-header"

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("ru-RU")
}

export default function CatalogPage() {
  const navigate = useNavigate()
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
                <DocTableHeader pageId="catalog" columnKey="title" className="p-2">Название</DocTableHeader>
                <DocTableHeader pageId="catalog" columnKey="purchase_price" className="p-2 text-right w-28">Цена</DocTableHeader>
                <DocTableHeader pageId="catalog" columnKey="purchase_currency" className="p-2 w-16">Валюта</DocTableHeader>
                <DocTableHeader pageId="catalog" columnKey="stock" className="p-2 text-right w-20">Склад</DocTableHeader>
                <DocTableHeader pageId="catalog" columnKey="avg_cost" className="p-2 text-right w-28">Себестоимость</DocTableHeader>
              </tr>
            </thead>
            <tbody>
              {data?.products?.map((p: any) => (
                <tr
                  key={p.id}
                  className="border-b border-bg-border hover:bg-bg-elevated cursor-pointer"
                  onClick={() => navigate(`/catalog/${p.id}`)}
                >
                  <td className="p-2">{p.title}</td>
                  <td className="p-2 text-right tabular-nums">
                    {p.purchase_price != null ? fmtNumber(Number(p.purchase_price)) : "—"}
                  </td>
                  <td className="p-2 text-text-secondary">{p.purchase_currency || "—"}</td>
                  <td className="p-2 text-right tabular-nums">{p.warehouse_stock || 0}</td>
                  <td className="p-2 text-right tabular-nums">
                    {p.avg_cost > 0 ? `${fmtNumber(p.avg_cost)} ₽` : "—"}
                  </td>
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
