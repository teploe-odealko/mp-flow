import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Text, Tabs, Input, Label, Select } from "@medusajs/ui"
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
  const [channel, setChannel] = useState("")

  // Fetch channels for filter
  const { data: salesData } = useQuery<any>({
    queryKey: ["sales-channels"],
    queryFn: async () => {
      const res = await fetch(`/admin/sales?limit=0`, { credentials: "include" })
      return res.json()
    },
  })

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Аналитика</Heading>
        <div className="flex gap-3 items-end">
          <Select value={channel} onValueChange={setChannel}>
            <Select.Trigger>
              <Select.Value placeholder="Все каналы" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="">Все каналы</Select.Item>
              {(salesData?.channels || []).map((ch: any) => (
                <Select.Item key={ch.code} value={ch.code}>
                  {ch.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
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
          <UnitEconomicsTab dateFrom={dateFrom} dateTo={dateTo} channel={channel} />
        </Tabs.Content>
        <Tabs.Content value="pnl">
          <PnlTab dateFrom={dateFrom} dateTo={dateTo} channel={channel} />
        </Tabs.Content>
        <Tabs.Content value="stock-valuation">
          <StockValuationTab />
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

const UnitEconomicsTab = ({
  dateFrom,
  dateTo,
  channel,
}: {
  dateFrom: string
  dateTo: string
  channel: string
}) => {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["analytics", "unit-economics", dateFrom, dateTo, channel],
    queryFn: async () => {
      const params = new URLSearchParams({ report: "unit-economics", from: dateFrom, to: dateTo })
      if (channel) params.set("channel", channel)
      const res = await fetch(`/admin/analytics?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  if (isLoading)
    return (
      <Container className="mt-4">
        <Text>Загрузка...</Text>
      </Container>
    )

  const rows = data?.data || []
  if (!rows.length)
    return (
      <Container className="mt-4">
        <Text className="text-ui-fg-subtle">Нет продаж за выбранный период.</Text>
      </Container>
    )

  const totals = rows.reduce(
    (acc: any, r: any) => ({
      quantity: acc.quantity + r.quantity,
      revenue: acc.revenue + r.revenue,
      total_fees: acc.total_fees + r.total_fees,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { quantity: 0, revenue: 0, total_fees: 0, cogs: 0, profit: 0 }
  )

  // Collect all fee types across products
  const allFeeTypes = new Set<string>()
  for (const row of rows) {
    for (const ft of Object.keys(row.fees_by_type || {})) {
      allFeeTypes.add(ft)
    }
  }
  const feeTypes = Array.from(allFeeTypes)

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-5 gap-4 mb-4">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Продано (шт)</Text>
          <Heading level="h2">{totals.quantity}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Выручка</Text>
          <Heading level="h2">{fmtR(totals.revenue)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Комиссии</Text>
          <Heading level="h2">{fmtR(totals.total_fees)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">COGS</Text>
          <Heading level="h2">{fmtR(totals.cogs)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Прибыль</Text>
          <Heading level="h2">
            <span className={totals.profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
              {fmtR(totals.profit)}
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
              {feeTypes.map((ft) => (
                <Table.HeaderCell key={ft} className="text-right">
                  {ft}
                </Table.HeaderCell>
              ))}
              <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Прибыль</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Маржа</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row: any) => (
              <Table.Row key={row.master_card_id}>
                <Table.Cell>
                  <div>
                    <Text className="font-medium">{row.product_name || "—"}</Text>
                    <Text size="small" className="text-ui-fg-subtle font-mono">
                      {row.channel_sku || row.master_card_id}
                    </Text>
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right">{row.quantity}</Table.Cell>
                <Table.Cell className="text-right">{fmtR(row.revenue)}</Table.Cell>
                {feeTypes.map((ft) => (
                  <Table.Cell key={ft} className="text-right">
                    {fmtR(row.fees_by_type?.[ft] || 0)}
                  </Table.Cell>
                ))}
                <Table.Cell className="text-right">{fmtR(row.cogs)}</Table.Cell>
                <Table.Cell className="text-right">
                  <span className={row.profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                    {fmtR(row.profit)}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <Badge
                    color={row.margin >= 20 ? "green" : row.margin >= 0 ? "orange" : "red"}
                  >
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

const PnlTab = ({
  dateFrom,
  dateTo,
  channel,
}: {
  dateFrom: string
  dateTo: string
  channel: string
}) => {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["analytics", "pnl", dateFrom, dateTo, channel],
    queryFn: async () => {
      const params = new URLSearchParams({ report: "pnl", from: dateFrom, to: dateTo })
      if (channel) params.set("channel", channel)
      const res = await fetch(`/admin/analytics?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  if (isLoading)
    return (
      <Container className="mt-4">
        <Text>Загрузка...</Text>
      </Container>
    )

  const d = data?.data
  if (!d)
    return (
      <Container className="mt-4">
        <Text className="text-ui-fg-subtle">Нет данных.</Text>
      </Container>
    )

  const lines: Array<{
    label: string
    value: number
    indent?: boolean
    bold?: boolean
    color?: string
  }> = [
    { label: "Выручка", value: d.revenue, bold: true },
    { label: "COGS (себестоимость)", value: -d.cogs, indent: true },
    { label: "Валовая прибыль", value: d.gross_profit, bold: true },
  ]

  // Add fee breakdown
  if (d.fees_by_type && Object.keys(d.fees_by_type).length > 0) {
    lines.push({ label: "Комиссии и расходы", value: -d.fees, bold: true })
    for (const [type, amount] of Object.entries(d.fees_by_type)) {
      lines.push({ label: type, value: -(amount as number), indent: true })
    }
  }

  lines.push({
    label: "Операционная прибыль",
    value: d.operating_profit,
    bold: true,
    color: d.operating_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error",
  })

  // By channel breakdown
  const channels = d.by_channel ? Object.entries(d.by_channel) : []

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Продаж</Text>
          <Heading level="h2">{d.total_sales}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Выручка</Text>
          <Heading level="h2">{fmtR(d.revenue)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Операц. прибыль</Text>
          <Heading level="h2">
            <span className={d.operating_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
              {fmtR(d.operating_profit)}
            </span>
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Маржа</Text>
          <Heading level="h2">
            <Badge color={d.margin >= 15 ? "green" : d.margin >= 0 ? "orange" : "red"}>
              {d.margin.toFixed(1)}%
            </Badge>
          </Heading>
        </Container>
      </div>

      <Container>
        <Heading level="h2" className="mb-4">Отчёт о прибылях и убытках</Heading>
        <div className="divide-y">
          {lines.map((line) => (
            <div
              key={line.label}
              className={`flex justify-between py-2 ${line.indent ? "pl-6" : ""}`}
            >
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

      {channels.length > 1 && (
        <Container className="mt-6">
          <Heading level="h2" className="mb-4">По каналам</Heading>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Канал</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Выручка</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Комиссии</Table.HeaderCell>
                <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Прибыль</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {channels.map(([ch, vals]: [string, any]) => (
                <Table.Row key={ch}>
                  <Table.Cell>
                    <Badge color="grey">{ch}</Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">{fmtR(vals.revenue)}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(vals.fees)}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(vals.cogs)}</Table.Cell>
                  <Table.Cell className="text-right">
                    <span className={vals.profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                      {fmtR(vals.profit)}
                    </span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}
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

  if (isLoading)
    return (
      <Container className="mt-4">
        <Text>Загрузка...</Text>
      </Container>
    )

  const d = data?.data
  if (!d?.items?.length)
    return (
      <Container className="mt-4">
        <Text className="text-ui-fg-subtle">Нет запасов.</Text>
      </Container>
    )

  return (
    <Container className="mt-4">
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Уникальных товаров</Text>
          <Heading level="h2">{d.unique_products}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Единиц на складе</Text>
          <Heading level="h2">{fmt(d.total_quantity)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Стоимость запасов</Text>
          <Heading level="h2">{fmtR(d.total_value)}</Heading>
        </Container>
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Товар</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Остаток</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Ср. себестоимость</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Стоимость запаса</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {d.items.map((item: any) => (
            <Table.Row key={item.master_card_id}>
              <Table.Cell>
                <Text className="font-medium">{item.title || item.master_card_id}</Text>
              </Table.Cell>
              <Table.Cell className="text-right">{item.quantity}</Table.Cell>
              <Table.Cell className="text-right">{fmtR(item.avg_cost)}</Table.Cell>
              <Table.Cell className="text-right font-medium">{fmtR(item.total_cost)}</Table.Cell>
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
