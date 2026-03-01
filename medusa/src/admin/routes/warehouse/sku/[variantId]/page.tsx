import { Container, Heading, Table, Badge, Text, Button } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useParams, useNavigate } from "react-router-dom"

const fmt = (v: number) => Number(v).toLocaleString("ru-RU")
const fmtR = (v: number) => `${fmt(v)} ₽`

const SkuDetailPage = () => {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<any>({
    queryKey: ["inventory-sku", variantId],
    queryFn: async () => {
      const res = await fetch(`/admin/inventory/sku/${variantId}`, { credentials: "include" })
      return res.json()
    },
    enabled: !!variantId,
  })

  if (isLoading) return <Container><Text>Загрузка...</Text></Container>
  if (!data?.card) return <Container><Text>Товар не найден</Text></Container>

  const card = data.card
  const summary = data.summary || {}

  return (
    <Container>
      <div className="mb-6">
        <Button variant="transparent" size="small" onClick={() => navigate("/warehouse")}>
          &larr; Склад
        </Button>
        <Heading level="h1" className="mt-2">{card.title}</Heading>
        <Text className="text-ui-fg-subtle">
          {card.sku ? `SKU: ${card.sku}` : card.id}
        </Text>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">На складе</Text>
          <Heading level="h2">{summary.warehouse_stock ?? 0}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Средняя себестоимость</Text>
          <Heading level="h2">{summary.avg_cost > 0 ? fmtR(summary.avg_cost) : "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Стоимость остатка</Text>
          <Heading level="h2">{summary.stock_value > 0 ? fmtR(summary.stock_value) : "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Ozon FBO</Text>
          <Heading level="h2">{data.ozon_stock?.fbo_present ?? "—"}</Heading>
        </Container>
      </div>

      {/* Supplier Orders */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">Заказы поставщикам</Heading>
        {!data.supplier_orders?.length ? (
          <Text className="text-ui-fg-subtle">Нет заказов.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Поставщик</Table.HeaderCell>
                <Table.HeaderCell>Заказ</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Заказано</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Получено</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость/ед</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.supplier_orders.map((item: any) => (
                <Table.Row
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/suppliers/${item.supplier_order_id || item.order_id}`)}
                >
                  <Table.Cell>{item.supplier_name || "—"}</Table.Cell>
                  <Table.Cell className="font-mono text-xs">{item.order_number || "—"}</Table.Cell>
                  <Table.Cell className="text-right">{item.ordered_qty}</Table.Cell>
                  <Table.Cell className="text-right">{item.received_qty}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(item.unit_cost))}</Table.Cell>
                  <Table.Cell>
                    <Badge color={item.order_status === "received" ? "green" : "grey"}>
                      {item.order_status || item.status}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Sales */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">Продажи</Heading>
        {!data.sales?.length ? (
          <Text className="text-ui-fg-subtle">Нет продаж.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Дата</Table.HeaderCell>
                <Table.HeaderCell>Канал</Table.HeaderCell>
                <Table.HeaderCell>Заказ</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Кол-во</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Выручка</Table.HeaderCell>
                <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.sales.map((sale: any) => (
                <Table.Row key={sale.id}>
                  <Table.Cell>{new Date(sale.sold_at).toLocaleDateString("ru-RU")}</Table.Cell>
                  <Table.Cell>
                    <Badge color="blue">{sale.channel}</Badge>
                  </Table.Cell>
                  <Table.Cell className="font-mono text-xs">{sale.channel_order_id || "—"}</Table.Cell>
                  <Table.Cell className="text-right">{sale.quantity}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(sale.revenue))}</Table.Cell>
                  <Table.Cell className="text-right">
                    {sale.total_cogs ? fmtR(Number(sale.total_cogs)) : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={sale.status === "delivered" ? "green" : sale.status === "active" ? "blue" : "grey"}>
                      {sale.status === "active" ? "В работе" : sale.status === "delivered" ? "Доставлен" : "Возврат"}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Ozon Link */}
      {data.ozon && (
        <Container className="mb-6">
          <Heading level="h2" className="mb-4">Ozon</Heading>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Text size="small" className="text-ui-fg-subtle">Offer ID</Text>
              <Text className="font-mono">{data.ozon.offer_id}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Product ID</Text>
              <Text>{data.ozon.ozon_product_id}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Статус</Text>
              <Badge color={data.ozon.ozon_status === "active" ? "green" : "grey"}>
                {data.ozon.ozon_status}
              </Badge>
            </div>
          </div>
        </Container>
      )}

      {/* Finance Movements */}
      <Container>
        <Heading level="h2" className="mb-4">Финансовые движения</Heading>
        {!data.finance_movements?.length ? (
          <Text className="text-ui-fg-subtle">Нет движений.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Дата</Table.HeaderCell>
                <Table.HeaderCell>Тип</Table.HeaderCell>
                <Table.HeaderCell>Описание</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Сумма</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.finance_movements.map((tx: any) => (
                <Table.Row key={tx.id}>
                  <Table.Cell>{new Date(tx.transaction_date).toLocaleDateString("ru-RU")}</Table.Cell>
                  <Table.Cell>
                    <Badge color={tx.direction === "income" ? "green" : "red"}>
                      {tx.type}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle text-xs">{tx.description}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(tx.amount))}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Container>
  )
}

export default SkuDetailPage
