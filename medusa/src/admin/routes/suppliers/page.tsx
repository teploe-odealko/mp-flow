import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Button, Text, Input, Tabs } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

const fmt = (v: number) => Number(v).toLocaleString("ru-RU")
const fmtR = (v: number) => `${fmt(v)} ₽`

const statusColor = (status: string) => {
  switch (status) {
    case "received": return "green" as const
    case "shipped": return "blue" as const
    case "ordered": return "orange" as const
    case "cancelled": return "red" as const
    default: return "grey" as const
  }
}

const statusLabel = (status: string) => {
  switch (status) {
    case "draft": return "Черновик"
    case "ordered": return "Заказано"
    case "shipped": return "Отправлено"
    case "received": return "Получено"
    case "cancelled": return "Отменено"
    default: return status
  }
}

const SuppliersPage = () => {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<any>({
    queryKey: ["supplier-orders", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set("q", search)
      if (statusFilter !== "all") params.set("status", statusFilter)
      params.set("limit", "50")
      const res = await fetch(`/admin/suppliers?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  const orders = data?.supplier_orders || []

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Закупки</Heading>
        <Button onClick={() => navigate("/suppliers/create")}>
          Создать заказ
        </Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Поиск по поставщику или номеру заказа..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Всего заказов</Text>
          <Heading level="h2">{data?.count ?? "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Ожидают приёмки</Text>
          <Heading level="h2">
            {orders.filter((o: any) => o.status === "shipped").length || "—"}
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Общая сумма</Text>
          <Heading level="h2">
            {orders.length > 0
              ? fmtR(orders.reduce((s: number, o: any) => s + Number(o.total_cost || o.total_amount || 0), 0))
              : "—"}
          </Heading>
        </Container>
      </div>

      <Tabs defaultValue="all" onValueChange={setStatusFilter}>
        <Tabs.List>
          <Tabs.Trigger value="all">Все</Tabs.Trigger>
          <Tabs.Trigger value="draft">Черновики</Tabs.Trigger>
          <Tabs.Trigger value="shipped">В пути</Tabs.Trigger>
          <Tabs.Trigger value="received">Получено</Tabs.Trigger>
        </Tabs.List>
      </Tabs>

      <Container className="mt-4">
        {isLoading ? (
          <Text>Загрузка...</Text>
        ) : !orders.length ? (
          <Text className="text-ui-fg-subtle">
            Нет заказов поставщикам. Создайте первый заказ.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Поставщик</Table.HeaderCell>
                <Table.HeaderCell>Номер</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Позиций</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Сумма</Table.HeaderCell>
                <Table.HeaderCell>Трек-номер</Table.HeaderCell>
                <Table.HeaderCell>Дата</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orders.map((order: any) => (
                <Table.Row
                  key={order.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/suppliers/${order.id}`)}
                >
                  <Table.Cell>
                    <Text className="font-medium">{order.supplier_name}</Text>
                  </Table.Cell>
                  <Table.Cell className="font-mono text-xs">
                    {order.order_number || order.id.slice(0, 8)}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={statusColor(order.status)}>
                      {statusLabel(order.status)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">{order.items_count ?? "—"}</Table.Cell>
                  <Table.Cell className="text-right">
                    {fmtR(Number(order.total_cost || order.total_amount || 0))}
                  </Table.Cell>
                  <Table.Cell>{order.tracking_number || "—"}</Table.Cell>
                  <Table.Cell>
                    {order.order_date
                      ? new Date(order.order_date).toLocaleDateString("ru-RU")
                      : order.created_at
                      ? new Date(order.created_at).toLocaleDateString("ru-RU")
                      : "—"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Закупки",
  icon: BuildingStorefront,
})

export default SuppliersPage
