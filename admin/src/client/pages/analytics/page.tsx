import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet } from "../../lib/api"

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
const today = now.toISOString().slice(0, 10)

export default function AnalyticsPage() {
  const [report, setReport] = useState<"pnl" | "unit-economics" | "stock-valuation">("pnl")

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", report],
    queryFn: () => {
      const params = report === "stock-valuation"
        ? `report=${report}`
        : `report=${report}&from=${thisMonth}&to=${today}`
      return apiGet(`/api/analytics?${params}`)
    },
  })

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Аналитика</h1>
      <div className="flex gap-2 mb-6">
        {(["pnl", "unit-economics", "stock-valuation"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setReport(r)}
            className={`px-3 py-1.5 rounded text-sm ${
              report === r ? "bg-accent text-white" : "bg-bg-surface text-text-secondary hover:bg-bg-elevated"
            }`}
          >
            {r === "pnl" ? "P&L" : r === "unit-economics" ? "Unit Economics" : "Стоимость запасов"}
          </button>
        ))}
      </div>
      {isLoading ? <p className="text-text-secondary">Загрузка...</p> : (
        <pre className="bg-bg-surface border border-bg-border rounded-lg p-4 text-sm overflow-auto text-text-secondary">
          {JSON.stringify(data?.data, null, 2)}
        </pre>
      )}
    </div>
  )
}
