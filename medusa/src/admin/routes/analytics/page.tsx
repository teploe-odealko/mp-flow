import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Text, Tabs, Input, Label } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

const fmt = (v: number) => Number(v).toLocaleString("ru-RU")
const fmtR = (v: number) => `${fmt(v)} ₽`

const defaultFrom = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}
const defaultTo = () => new Date().toISOString().slice(0, 10)

const AnalyticsPage = () => {
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Аналитика</Heading>
        <div className="flex gap-3 items-end">
          <div>
            <Label>С</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>По</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="unit-economics">
        <Tabs.List>
          <Tabs.Trigger value="unit-economics">Юнит-экономика</Tabs.Trigger>
          <Tabs.Trigger value="pnl">PnL</Tabs.Trigger>
          <Tabs.Trigger value="stock-valuation">Стоимость запасов</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="unit-economics">
          <UnitEconomicsTab dateFrom={dateFrom} dateTo={dateTo} />
        </Tabs.Content>
        <Tabs.Content value="pnl">
          <PnlTab dateFrom={dateFrom} dateTo={dateTo} />
        </Tabs.Content>
        <Tabs.Content value="stock-valuation">
          <StockValuationTab />
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

const UnitEconomicsTab = ({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) => {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["analytics", "unit-economics", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({ report: "unit-economics", date_from: dateFrom, date_to: dateTo })
      const res = await fetch(`/admin/analytics?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  if (isLoading) return <Container className="mt-4"><Text>Загрузка...</Text></Container>
  if (!data?.rows?.length) return <Container className="mt-4"><Text className="text-ui-fg-subtle">Нет продаж за выбранный период.</Text></Container>

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-5 gap-4 mb-4">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Продажи</Text>
          <Heading level="h2">{data.totals.quantity}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Выручка</Text>
          <Heading level="h2">{fmtR(data.totals.revenue)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Комиссии Ozon</Text>
          <Heading level="h2">{fmtR(data.totals.total_fees)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">COGS</Text>
          <Heading level="h2">{fmtR(data.totals.cogs)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Прибыль</Text>
          <Heading level="h2">
            <span className={data.totals.profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
              {fmtR(data.totals.profit)}
            </span>
          </Heading>
        </Container>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Товар</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Кол-во</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Выручка</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Комиссия</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Last mile</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Фулфилмент</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Эквайринг</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Прочие</Table.HeaderCell>
              <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Прибыль</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Маржа</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.rows.map((row: any) => (
              <Table.Row key={row.offer_id}>
                <Table.Cell>
                  <div>
                    <Text className="font-medium">{row.product_name}</Text>
                    <Text size="small" className="text-ui-fg-subtle font-mono">{row.offer_id}</Text>
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right">{row.quantity}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.revenue)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.commission)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.last_mile)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.fulfillment)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.acquiring)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.pipeline + row.direct_flow_trans + row.reverse_flow_trans + row.return_processing + row.marketplace_service + row.other_fees)}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.cogs)}</Table.Cell>
                <Table.Cell className="text-right">
                  <span className={row.profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                    {fmtR(row.profit)}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <Badge color={row.margin >= 20 ? "green" : row.margin >= 0 ? "orange" : "red"}>
                    {row.margin.toFixed(1)}%
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Container>
  )
}

const PnlTab = ({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) => {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["analytics", "pnl", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({ report: "pnl", date_from: dateFrom, date_to: dateTo })
      const res = await fetch(`/admin/analytics?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  if (isLoading) return <Container className="mt-4"><Text>Загрузка...</Text></Container>
  if (!data) return <Container className="mt-4"><Text className="text-ui-fg-subtle">Нет данных.</Text></Container>

  const lines: Array<{ label: string; value: number; indent?: boolean; bold?: boolean; color?: string }> = [
    { label: "Выручка", value: data.revenue, bold: true },
    { label: `COGS (себестоимость)`, value: -data.cogs, indent: true },
    { label: "Валовая прибыль", value: data.gross_profit, bold: true },
    { label: "Комиссии Ozon", value: -data.ozon_fees?.total, bold: true },
    { label: "Комиссия", value: -data.ozon_fees?.commission, indent: true },
    { label: "Last mile", value: -data.ozon_fees?.last_mile, indent: true },
    { label: "Магистраль", value: -data.ozon_fees?.pipeline, indent: true },
    { label: "Фулфилмент", value: -data.ozon_fees?.fulfillment, indent: true },
    { label: "Прямой поток", value: -data.ozon_fees?.direct_flow_trans, indent: true },
    { label: "Обратный поток", value: -data.ozon_fees?.reverse_flow_trans, indent: true },
    { label: "Обработка возвратов", value: -data.ozon_fees?.return_processing, indent: true },
    { label: "Эквайринг", value: -data.ozon_fees?.acquiring, indent: true },
    { label: "Маркетплейс", value: -data.ozon_fees?.marketplace_service, indent: true },
    { label: "Прочие сборы", value: -data.ozon_fees?.other_fees, indent: true },
    { label: "Операционная прибыль", value: data.operating_profit, bold: true },
    { label: "Налог УСН (6%)", value: -data.estimated_tax_usn, indent: true },
    { label: "Чистая прибыль", value: data.net_profit, bold: true, color: data.net_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error" },
  ]

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Продаж</Text>
          <Heading level="h2">{data.sales_count}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Выручка</Text>
          <Heading level="h2">{fmtR(data.revenue)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Чистая прибыль</Text>
          <Heading level="h2">
            <span className={data.net_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
              {fmtR(data.net_profit)}
            </span>
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Маржа</Text>
          <Heading level="h2">
            <Badge color={data.margin >= 15 ? "green" : data.margin >= 0 ? "orange" : "red"}>
              {data.margin.toFixed(1)}%
            </Badge>
          </Heading>
        </Container>
      </div>

      <Container>
        <Heading level="h2" className="mb-4">Отчёт о прибылях и убытках</Heading>
        <div className="divide-y">
          {lines.map((line) => (
            <div key={line.label} className={`flex justify-between py-2 ${line.indent ? "pl-6" : ""}`}>
              <Text className={line.bold ? "font-semibold" : "text-ui-fg-subtle"}>
                {line.label}
              </Text>
              <Text className={`${line.bold ? "font-semibold" : ""} ${line.color || ""}`}>
                {fmtR(line.value)}
              </Text>
            </div>
          ))}
        </div>
      </Container>
    </Container>
  )
}

const StockValuationTab = () => {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["analytics", "stock-valuation"],
    queryFn: async () => {
      const params = new URLSearchParams({ report: "stock-valuation" })
      const res = await fetch(`/admin/analytics?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  if (isLoading) return <Container className="mt-4"><Text>Загрузка...</Text></Container>
  if (!data?.rows?.length) return <Container className="mt-4"><Text className="text-ui-fg-subtle">Нет запасов.</Text></Container>

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Единиц на складе</Text>
          <Heading level="h2">{fmt(data.totals.total_units)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Стоимость запасов</Text>
          <Heading level="h2">{fmtR(data.totals.total_value)}</Heading>
        </Container>
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Товар</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Остаток</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Ср. себестоимость</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Стоимость запаса</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Цена Ozon</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Потенц. выручка</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {data.rows.map((row: any) => (
            <Table.Row key={row.variant_id}>
              <Table.Cell>
                <Text className="font-medium">{row.product_title}</Text>
              </Table.Cell>
              <Table.Cell className="font-mono text-xs">{row.sku || "—"}</Table.Cell>
              <Table.Cell className="text-right">{row.quantity}</Table.Cell>
              <Table.Cell className="text-right">{fmtR(row.avg_cost)}</Table.Cell>
              <Table.Cell className="text-right font-medium">{fmtR(row.stock_value)}</Table.Cell>
              <Table.Cell className="text-right">{row.ozon_price ? fmtR(row.ozon_price) : "—"}</Table.Cell>
              <Table.Cell className="text-right">{row.potential_revenue ? fmtR(row.potential_revenue) : "—"}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Аналитика",
  icon: ChartBar,
})

export default AnalyticsPage
