import { Container, Heading, Table, Badge, Text, Button } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useNavigate } from "react-router-dom"

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

const SupplierDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<any>({
    queryKey: ["supplier-order", id],
    queryFn: async () => {
      const res = await fetch(`/admin/suppliers/${id}`, { credentials: "include" })
      return res.json()
    },
    enabled: !!id,
  })

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const items = (data?.order?.items || []).map((item: any) => ({
        item_id: item.id,
        received_qty: item.ordered_qty,
      }))
      const res = await fetch(`/admin/suppliers/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "receive", items }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-order", id] })
    },
  })

  const unreceiveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/suppliers/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unreceive" }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-order", id] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/suppliers/${id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      navigate("/suppliers")
    },
  })

  if (isLoading) return <Container><Text>Загрузка...</Text></Container>
  if (!data?.order) return <Container><Text>Заказ не найден</Text></Container>

  const order = data.order
  const items = order.items || []
  const sharedCosts = typeof order.shared_costs === "string"
    ? JSON.parse(order.shared_costs)
    : (Array.isArray(order.shared_costs) ? order.shared_costs : [])
  const totalItemsCost = items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0)

  return (
    <Container>
      <div className="mb-6">
        <Button variant="transparent" size="small" onClick={() => navigate("/suppliers")}>
          &larr; Закупки
        </Button>
        <div className="flex items-center justify-between mt-2">
          <div>
            <Heading level="h1">{order.supplier_name}</Heading>
            <Text className="text-ui-fg-subtle">
              {order.order_number ? `Заказ #${order.order_number}` : `ID: ${order.id}`}
              {order.order_date && ` | ${new Date(order.order_date).toLocaleDateString("ru-RU")}`}
            </Text>
          </div>
          <div className="flex items-center gap-3">
            <Badge color={statusColor(order.status)}>
              {statusLabel(order.status)}
            </Badge>
            {order.status === "draft" && (
              <Button
                variant="danger"
                size="small"
                onClick={() => deleteMutation.mutate()}
                isLoading={deleteMutation.isPending}
              >
                Удалить
              </Button>
            )}
            {(order.status === "draft" || order.status === "shipped" || order.status === "ordered") && (
              <Button
                onClick={() => receiveMutation.mutate()}
                isLoading={receiveMutation.isPending}
              >
                Принять поставку
              </Button>
            )}
            {order.status === "received" && (
              <Button
                variant="secondary"
                onClick={() => unreceiveMutation.mutate()}
                isLoading={unreceiveMutation.isPending}
              >
                Отменить приёмку
              </Button>
            )}
          </div>
        </div>
      </div>

      {(receiveMutation.error || unreceiveMutation.error || deleteMutation.error) && (
        <Container className="mb-4">
          <Text className="text-ui-fg-error">
            {((receiveMutation.error || unreceiveMutation.error || deleteMutation.error) as Error)?.message}
          </Text>
        </Container>
      )}

      {/* Order info */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Позиций</Text>
          <Heading level="h2">{items.length}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Сумма товаров</Text>
          <Heading level="h2">{fmtR(totalItemsCost)}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Трек-номер</Text>
          <Heading level="h2">{order.tracking_number || "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Получено</Text>
          <Heading level="h2">
            {order.received_at ? new Date(order.received_at).toLocaleDateString("ru-RU") : "—"}
          </Heading>
        </Container>
      </div>

      {order.notes && (
        <Container className="mb-6">
          <Text size="small" className="text-ui-fg-subtle mb-1">Заметки</Text>
          <Text>{order.notes}</Text>
        </Container>
      )}

      {/* Items table */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">Товары</Heading>
        {!items.length ? (
          <Text className="text-ui-fg-subtle">Нет товаров в заказе.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Товар</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Заказано</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Получено</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Цена закуп.</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Упаковка</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Логистика</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Таможня</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость/ед</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Итого</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item: any) => (
                <Table.Row key={item.id}>
                  <Table.Cell>
                    <div>
                      <Text className="font-medium">{item.variant_title || item.variant_id}</Text>
                      <Text size="small" className="text-ui-fg-subtle font-mono">{item.variant_id}</Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">{item.ordered_qty}</Table.Cell>
                  <Table.Cell className="text-right">{item.received_qty ?? "—"}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(item.purchase_price_rub || item.unit_cost || 0))}</Table.Cell>
                  <Table.Cell className="text-right">{Number(item.packaging_cost_rub || 0) > 0 ? fmtR(Number(item.packaging_cost_rub)) : "—"}</Table.Cell>
                  <Table.Cell className="text-right">{Number(item.logistics_cost_rub || 0) > 0 ? fmtR(Number(item.logistics_cost_rub)) : "—"}</Table.Cell>
                  <Table.Cell className="text-right">{Number(item.customs_cost_rub || 0) > 0 ? fmtR(Number(item.customs_cost_rub)) : "—"}</Table.Cell>
                  <Table.Cell className="text-right font-medium">{fmtR(Number(item.unit_cost || 0))}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(item.total_cost || 0))}</Table.Cell>
                  <Table.Cell>
                    <Badge color={item.status === "received" ? "green" : "grey"}>
                      {item.status || "draft"}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Shared costs */}
      {sharedCosts.length > 0 && (
        <Container className="mb-6">
          <Heading level="h2" className="mb-4">Общие расходы</Heading>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Название</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Сумма</Table.HeaderCell>
                <Table.HeaderCell>Метод распределения</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sharedCosts.map((cost: any, i: number) => (
                <Table.Row key={i}>
                  <Table.Cell>{cost.name}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(cost.total_rub || 0))}</Table.Cell>
                  <Table.Cell>{cost.method || "Поровну"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      {/* FIFO lots (only for received) */}
      {order.status === "received" && items.some((i: any) => i.fifo_lots?.length) && (
        <Container>
          <Heading level="h2" className="mb-4">FIFO Лоты</Heading>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Товар</Table.HeaderCell>
                <Table.HeaderCell>Дата получения</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Начальное</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Остаток</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость/ед</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.flatMap((item: any) =>
                (item.fifo_lots || []).map((lot: any) => (
                  <Table.Row key={lot.id}>
                    <Table.Cell>{item.variant_title || item.variant_id}</Table.Cell>
                    <Table.Cell>{new Date(lot.received_at).toLocaleDateString("ru-RU")}</Table.Cell>
                    <Table.Cell className="text-right">{lot.initial_qty}</Table.Cell>
                    <Table.Cell className="text-right">
                      <Badge color={lot.remaining_qty > 0 ? "green" : "grey"}>
                        {lot.remaining_qty}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="text-right">{fmtR(Number(lot.cost_per_unit))}</Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </Container>
      )}
    </Container>
  )
}

export default SupplierDetailPage
