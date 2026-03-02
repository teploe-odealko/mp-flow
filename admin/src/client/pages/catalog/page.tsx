import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"
import { DocTableHeader } from "../../components/doc-table-header"

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
                <DocTableHeader pageId="catalog" columnKey="title" className="p-2">Название</DocTableHeader>
              </tr>
            </thead>
            <tbody>
              {data?.products?.map((p: any) => (
                <tr key={p.id} className="border-b border-bg-border hover:bg-bg-elevated">
                  <td className="p-2">{p.title}</td>
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
