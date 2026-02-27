import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"

type PnlResponse = {
  period: { from: string; to: string }
  income: number
  expense: number
  profit: number
  margin: number
  breakdown: Record<string, number>
}

const FinancePage = () => {
  const { data, isLoading } = useQuery<PnlResponse>({
    queryKey: ["finance-pnl"],
    queryFn: async () => {
      const res = await fetch("/admin/finance", { credentials: "include" })
      return res.json()
    },
  })

  const fmt = (val: number | undefined) =>
    val != null ? val.toLocaleString("ru-RU") + " ₽" : "—"

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Финансы</Heading>
        {data?.period && (
          <Text size="small" className="text-ui-fg-subtle">
            {new Date(data.period.from).toLocaleDateString("ru-RU")} —{" "}
            {new Date(data.period.to).toLocaleDateString("ru-RU")}
          </Text>
        )}
      </div>

      {isLoading ? (
        <Text>Загрузка...</Text>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Доход</Text>
              <Heading level="h2" className="text-ui-fg-interactive">
                {fmt(data?.income)}
              </Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Расход</Text>
              <Heading level="h2" className="text-ui-fg-error">
                {fmt(data?.expense)}
              </Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Прибыль</Text>
              <Heading level="h2">
                {fmt(data?.profit)}
              </Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Маржа</Text>
              <Heading level="h2">
                {data?.margin != null ? `${data.margin.toFixed(1)}%` : "—"}
              </Heading>
            </Container>
          </div>

          {data?.breakdown && Object.keys(data.breakdown).length > 0 && (
            <Container>
              <Heading level="h2" className="mb-4">Разбивка по типам</Heading>
              <div className="space-y-2">
                {Object.entries(data.breakdown).map(([type, amount]) => (
                  <div key={type} className="flex justify-between py-2 border-b border-ui-border-base">
                    <Text>{type}</Text>
                    <Text className="font-mono">{fmt(amount)}</Text>
                  </div>
                ))}
              </div>
            </Container>
          )}
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Финансы",
  icon: ChartBar,
})

export default FinancePage
