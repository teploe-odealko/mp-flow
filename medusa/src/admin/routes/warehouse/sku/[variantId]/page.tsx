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
  if (!data?.variant) return <Container><Text>Вариант не найден</Text></Container>

  const v = data.variant

  return (
    <Container>
      <div className="mb-6">
        <Button variant="transparent" size="small" onClick={() => navigate("/warehouse")}>
          &larr; Склад
        </Button>
        <Heading level="h1" className="mt-2">{v.product_title}</Heading>
        <Text className="text-ui-fg-subtle">
          {v.sku ? `SKU: ${v.sku}` : v.variant_title} | Variant: {variantId}
        </Text>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">На складе</Text>
          <Heading level="h2">{v.warehouse_stock}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Средняя себестоимость</Text>
          <Heading level="h2">{v.avg_cost > 0 ? fmtR(v.avg_cost) : "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Ozon FBO</Text>
          <Heading level="h2">{v.ozon_stock?.fbo_present ?? "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Цена Ozon</Text>
          <Heading level="h2">{v.ozon?.ozon_price ? fmtR(Number(v.ozon.ozon_price)) : "—"}</Heading>
        </Container>
      </div>

      {/* FIFO Lots */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">FIFO Лоты</Heading>
        {!v.fifo_lots?.length ? (
          <Text className="text-ui-fg-subtle">Нет лотов.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Дата получения</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Начальное</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Остаток</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость/ед</Table.HeaderCell>
                <Table.HeaderCell>Заметки</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {v.fifo_lots.map((lot: any) => (
                <Table.Row key={lot.id}>
                  <Table.Cell>{new Date(lot.received_at).toLocaleDateString("ru-RU")}</Table.Cell>
                  <Table.Cell className="text-right">{lot.initial_qty}</Table.Cell>
                  <Table.Cell className="text-right">
                    <Badge color={lot.remaining_qty > 0 ? "green" : "grey"}>{lot.remaining_qty}</Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(lot.cost_per_unit))}</Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle text-xs">{lot.notes || "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Supplier Orders */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">Заказы поставщикам</Heading>
        {!v.supplier_orders?.length ? (
          <Text className="text-ui-fg-subtle">Нет заказов.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Заказ</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Заказано</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Получено</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость/ед</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {v.supplier_orders.map((item: any) => (
                <Table.Row
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/suppliers/${item.order_id}`)}
                >
                  <Table.Cell className="font-mono text-xs">{item.order_id}</Table.Cell>
                  <Table.Cell className="text-right">{item.ordered_qty}</Table.Cell>
                  <Table.Cell className="text-right">{item.received_qty}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(item.unit_cost))}</Table.Cell>
                  <Table.Cell>
                    <Badge color={item.status === "received" ? "green" : "grey"}>{item.status}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Recent Sales */}
      <Container className="mb-6">
        <Heading level="h2" className="mb-4">Последние продажи</Heading>
        {!v.recent_sales?.length ? (
          <Text className="text-ui-fg-subtle">Нет продаж.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Дата</Table.HeaderCell>
                <Table.HeaderCell>Posting</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Кол-во</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Цена</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Комиссия</Table.HeaderCell>
                <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {v.recent_sales.map((sale: any) => (
                <Table.Row key={sale.id}>
                  <Table.Cell>{new Date(sale.sold_at).toLocaleDateString("ru-RU")}</Table.Cell>
                  <Table.Cell className="font-mono text-xs">{sale.posting_number}</Table.Cell>
                  <Table.Cell className="text-right">{sale.quantity}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(sale.sale_price))}</Table.Cell>
                  <Table.Cell className="text-right">{fmtR(Number(sale.commission))}</Table.Cell>
                  <Table.Cell className="text-right">{sale.cogs ? fmtR(Number(sale.cogs)) : "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={sale.status === "delivered" ? "green" : "grey"}>{sale.status}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Ozon Link */}
      {v.ozon && (
        <Container className="mb-6">
          <Heading level="h2" className="mb-4">Ozon</Heading>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Text size="small" className="text-ui-fg-subtle">Offer ID</Text>
              <Text className="font-mono">{v.ozon.offer_id}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Product ID</Text>
              <Text>{v.ozon.ozon_product_id}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Статус</Text>
              <Badge color={v.ozon.ozon_status === "active" ? "green" : "grey"}>
                {v.ozon.ozon_status}
              </Badge>
            </div>
          </div>
        </Container>
      )}

      {/* Finance Movements */}
      <Container>
        <Heading level="h2" className="mb-4">Финансовые движения</Heading>
        {!v.finance_movements?.length ? (
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
              {v.finance_movements.map((tx: any) => (
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
