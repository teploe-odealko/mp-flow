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
  pending: "orange",
  processing: "blue",
  delivered: "green",
  returned: "red",
  cancelled: "grey",
}

const statusLabels: Record<string, string> = {
  pending: "Ожидание",
  processing: "Обработка",
  delivered: "Доставлено",
  returned: "Возврат",
  cancelled: "Отменено",
}

const channelBadge = (channel: string) => {
  const map: Record<string, { color: string; label: string }> = {
    ozon: { color: "blue", label: "Ozon" },
    wildberries: { color: "purple", label: "WB" },
    manual: { color: "grey", label: "Ручная" },
  }
  return map[channel] || { color: "grey", label: channel }
}

type SaleRow = {
  id: string
  channel: string
  channel_order_id: string | null
  status: string
  sold_at: string
  total_revenue: number
  total_fees: number
  total_cogs: number
  total_profit: number
  notes: string | null
  items: Array<{ product_name: string; quantity: number; price_per_unit: number }>
  fees: Array<{ fee_type: string; amount: number }>
}

type SalesResponse = {
  sales: SaleRow[]
  channels: Array<{ code: string; name: string }>
  stats: {
    count: number
    total_revenue: number
    total_profit: number
    margin: number
  }
}

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
        <Select value={channel} onValueChange={setChannel}>
          <Select.Trigger>
            <Select.Value placeholder="Все каналы" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="">Все каналы</Select.Item>
            {(data?.channels || []).map((ch) => (
              <Select.Item key={ch.code} value={ch.code}>
                {ch.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <Select.Trigger>
            <Select.Value placeholder="Все статусы" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="">Все статусы</Select.Item>
            <Select.Item value="delivered">Доставлено</Select.Item>
            <Select.Item value="pending">Ожидание</Select.Item>
            <Select.Item value="processing">Обработка</Select.Item>
            <Select.Item value="returned">Возврат</Select.Item>
            <Select.Item value="cancelled">Отменено</Select.Item>
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
          <Heading level="h2">{data?.stats ? fmtR(data.stats.total_revenue) : "..."}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Прибыль</Text>
          <Heading level="h2">
            {data?.stats ? (
              <span className={data.stats.total_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                {fmtR(data.stats.total_profit)}
              </span>
            ) : "..."}
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Маржа</Text>
          <Heading level="h2">
            {data?.stats ? (
              <Badge color={data.stats.margin >= 20 ? "green" : data.stats.margin >= 0 ? "orange" : "red"}>
                {data.stats.margin.toFixed(1)}%
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
                <Table.HeaderCell>Товары</Table.HeaderCell>
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
                const itemsSummary = (sale.items || [])
                  .map((i) => `${i.product_name || "Товар"} x${i.quantity}`)
                  .join(", ")

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
                          {itemsSummary || "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell className="text-right">{fmtR(sale.total_revenue)}</Table.Cell>
                      <Table.Cell className="text-right">{fmtR(sale.total_fees)}</Table.Cell>
                      <Table.Cell className="text-right">{fmtR(sale.total_cogs)}</Table.Cell>
                      <Table.Cell className="text-right">
                        <span className={sale.total_profit >= 0 ? "text-ui-fg-interactive" : "text-ui-fg-error"}>
                          {fmtR(sale.total_profit)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={st as any}>{statusLabels[sale.status] || sale.status}</Badge>
                      </Table.Cell>
                    </Table.Row>

                    {isExpanded && (
                      <Table.Row key={`${sale.id}-detail`}>
                        <td colSpan={9}>
                          <div className="p-4 bg-ui-bg-subtle rounded-lg">
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <Text className="font-semibold mb-2">Позиции</Text>
                                {(sale.items || []).map((item, idx) => (
                                  <div key={idx} className="flex justify-between py-1">
                                    <Text size="small">
                                      {item.product_name || "Товар"} x{item.quantity}
                                    </Text>
                                    <Text size="small" className="font-mono">
                                      {fmtR(item.quantity * item.price_per_unit)}
                                    </Text>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <Text className="font-semibold mb-2">Комиссии</Text>
                                {(sale.fees || []).map((fee, idx) => (
                                  <div key={idx} className="flex justify-between py-1">
                                    <Text size="small">{fee.fee_type}</Text>
                                    <Text size="small" className="font-mono">
                                      {fmtR(fee.amount)}
                                    </Text>
                                  </div>
                                ))}
                                {(!sale.fees || sale.fees.length === 0) && (
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
