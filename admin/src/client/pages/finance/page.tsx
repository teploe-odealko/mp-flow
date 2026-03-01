import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"

export default function FinancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["finance"],
    queryFn: () => apiGet("/api/finance"),
  })

  if (isLoading) return <p className="text-text-secondary">Загрузка...</p>

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Финансы</h1>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Доходы</p>
          <p className="text-2xl font-semibold text-inflow">{data?.income?.toLocaleString()} ₽</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Расходы</p>
          <p className="text-2xl font-semibold text-outflow">{data?.expense?.toLocaleString()} ₽</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Прибыль</p>
          <p className={`text-2xl font-semibold ${(data?.profit || 0) >= 0 ? "text-inflow" : "text-loss"}`}>
            {data?.profit?.toLocaleString()} ₽
          </p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Маржа</p>
          <p className="text-2xl font-semibold">{data?.margin?.toFixed(1)}%</p>
        </div>
      </div>
      <p className="text-text-secondary text-sm">Период: {data?.period?.from?.slice(0, 10)} — {data?.period?.to?.slice(0, 10)}</p>
    </div>
  )
}
