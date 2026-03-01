import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingBag } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Text, Input, Label, Select } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

const fmt = (v: number) => Number(v).toLocaleString("ru-RU")
const fmtR = (v: number) => `${fmt(v)} ₽`

const defaultFrom = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}
const defaultTo = () => new Date().toISOString().slice(0, 10)

const statusColors: Record<string, string> = {
  active: "blue",
  delivered: "green",
  returned: "red",
}

const statusLabels: Record<string, string> = {
  active: "В работе",
  delivered: "Доставлено",
  returned: "Возврат",
}

const channelBadge = (channel: string) => {
  const map: Record<string, { color: string; label: string }> = {
    ozon: { color: "blue", label: "Ozon" },
    wb: { color: "purple", label: "WB" },
    manual: { color: "grey", label: "Ручная" },
    "write-off": { color: "orange", label: "Списание" },
  }
  return map[channel] || { color: "grey", label: channel }
}

type FeeDetail = { key: string; label: string; amount: number }

type SaleRow = {
  id: string
  channel: string
  channel_order_id: string | null
  channel_sku: string | null
  product_name: string | null
  quantity: number
  price_per_unit: number
  revenue: number
  unit_cogs: number
  total_cogs: number
  fee_details: FeeDetail[]
  status: string
  sold_at: string
  notes: string | null
}

type SalesResponse = {
  sales: SaleRow[]
  stats: {
    count: number
    total_revenue: number
  }
}

const sumFees = (fees: FeeDetail[]) =>
  (fees || []).reduce((s, f) => s + Number(f.amount || 0), 0)

const SalesPage = () => {
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)
  const [channel, setChannel] = useState("")
  const [status, setStatus] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<SalesResponse>({
    queryKey: ["sales", dateFrom, dateTo, channel, status],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set("from", dateFrom)
      if (dateTo) params.set("to", dateTo)
      if (channel) params.set("channel", channel)
      if (status) params.set("status", status)
      const res = await fetch(`/admin/sales?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  // Compute totals from flat sales
  const totalFees = (data?.sales || []).reduce((s, sale) => s + sumFees(sale.fee_details), 0)
  const totalCogs = (data?.sales || []).reduce((s, sale) => s + Number(sale.total_cogs || 0), 0)
  const totalRevenue = data?.stats?.total_revenue ?? 0
  const totalProfit = totalRevenue - totalCogs - totalFees
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Продажи</Heading>
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

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <Select value={channel || "__all__"} onValueChange={(v) => setChannel(v === "__all__" ? "" : v)}>
          <Select.Trigger>
            <Select.Value placeholder="Все каналы" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__">Все каналы</Select.Item>
            <Select.Item value="ozon">Ozon</Select.Item>
            <Select.Item value="wb">WB</Select.Item>
            <Select.Item value="manual">Ручная</Select.Item>
            <Select.Item value="write-off">Списание</Select.Item>
          </Select.Content>
        </Select>

        <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : v)}>
          <Select.Trigger>
            <Select.Value placeholder="Все статусы" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__">Все статусы</Select.Item>
            <Select.Item value="active">В работе</Select.Item>
            <Select.Item value="delivered">Доставлено</Select.Item>
            <Select.Item value="returned">Возврат</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Продаж</Text>
          <Heading level="h2">{data?.stats?.count ?? "..."}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Выручка</Text>
          <Heading level="h2">{data?.stats ? fmtR(totalRevenue) : "..."}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Прибыль</Text>
          <Heading level="h2">
            {data?.stats ? (
              <span className={totalProfit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                {fmtR(totalProfit)}
              </span>
            ) : "..."}
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Маржа</Text>
          <Heading level="h2">
            {data?.stats ? (
              <Badge color={margin >= 20 ? "green" : margin >= 0 ? "orange" : "red"}>
                {margin.toFixed(1)}%
              </Badge>
            ) : "..."}
          </Heading>
        </Container>
      </div>

      {/* Sales Table */}
      <Container>
        {isLoading ? (
          <Text>Загрузка...</Text>
        ) : !data?.sales?.length ? (
          <Text className="text-ui-fg-subtle">Нет продаж за выбранный период.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Дата</Table.HeaderCell>
                <Table.HeaderCell>Канал</Table.HeaderCell>
                <Table.HeaderCell>№ заказа</Table.HeaderCell>
                <Table.HeaderCell>Товар</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Кол-во</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Выручка</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Комиссии</Table.HeaderCell>
                <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Прибыль</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.sales.map((sale) => {
                const ch = channelBadge(sale.channel)
                const st = statusColors[sale.status] || "grey"
                const isExpanded = expandedId === sale.id
                const fees = sumFees(sale.fee_details)
                const profit = Number(sale.revenue || 0) - Number(sale.total_cogs || 0) - fees

                return (
                  <>
                    <Table.Row
                      key={sale.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : sale.id)}
                    >
                      <Table.Cell>
                        {new Date(sale.sold_at).toLocaleDateString("ru-RU")}
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={ch.color as any}>{ch.label}</Badge>
                      </Table.Cell>
                      <Table.Cell className="font-mono text-xs">
                        {sale.channel_order_id || "—"}
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="small" className="max-w-[200px] truncate">
                          {sale.product_name || "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell className="text-right">{sale.quantity}</Table.Cell>
                      <Table.Cell className="text-right">{fmtR(Number(sale.revenue || 0))}</Table.Cell>
                      <Table.Cell className="text-right">{fmtR(fees)}</Table.Cell>
                      <Table.Cell className="text-right">{fmtR(Number(sale.total_cogs || 0))}</Table.Cell>
                      <Table.Cell className="text-right">
                        <span className={profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                          {fmtR(profit)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={st as any}>{statusLabels[sale.status] || sale.status}</Badge>
                      </Table.Cell>
                    </Table.Row>

                    {isExpanded && (
                      <Table.Row key={`${sale.id}-detail`}>
                        <td colSpan={10}>
                          <div className="p-4 bg-ui-bg-subtle rounded-lg">
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <Text className="font-semibold mb-2">Детали</Text>
                                <div className="flex justify-between py-1">
                                  <Text size="small">Цена за ед.</Text>
                                  <Text size="small" className="font-mono">{fmtR(Number(sale.price_per_unit || 0))}</Text>
                                </div>
                                <div className="flex justify-between py-1">
                                  <Text size="small">Себестоимость/ед</Text>
                                  <Text size="small" className="font-mono">{fmtR(Number(sale.unit_cogs || 0))}</Text>
                                </div>
                                {sale.channel_sku && (
                                  <div className="flex justify-between py-1">
                                    <Text size="small">SKU канала</Text>
                                    <Text size="small" className="font-mono">{sale.channel_sku}</Text>
                                  </div>
                                )}
                              </div>
                              <div>
                                <Text className="font-semibold mb-2">Комиссии</Text>
                                {(sale.fee_details || []).map((fee, idx) => (
                                  <div key={idx} className="flex justify-between py-1">
                                    <Text size="small">{fee.label || fee.key}</Text>
                                    <Text size="small" className="font-mono">
                                      {fmtR(Number(fee.amount || 0))}
                                    </Text>
                                  </div>
                                ))}
                                {(!sale.fee_details || sale.fee_details.length === 0) && (
                                  <Text size="small" className="text-ui-fg-subtle">Нет комиссий</Text>
                                )}
                              </div>
                            </div>
                            {sale.notes && (
                              <div className="mt-3 pt-3 border-t border-ui-border-base">
                                <Text size="small" className="text-ui-fg-subtle">{sale.notes}</Text>
                              </div>
                            )}
                          </div>
                        </td>
                      </Table.Row>
                    )}
                  </>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Продажи",
  icon: ShoppingBag,
})

export default SalesPage
