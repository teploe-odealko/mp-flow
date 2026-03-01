import { Container, Heading, Table, Badge, Text, Button, Tabs } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useNavigate } from "react-router-dom"
import { useState } from "react"

const CatalogDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data, isLoading } = useQuery<{ product: any }>({
    queryKey: ["catalog", id],
    queryFn: async () => {
      const res = await fetch(`/admin/catalog/${id}`, { credentials: "include" })
      return res.json()
    },
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/catalog/${id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      navigate("/catalog")
    },
  })

  if (isLoading) return <Container><Text>Загрузка...</Text></Container>
  if (!data?.product) return <Container><Text>Товар не найден</Text></Container>

  const product = data.product
  const variant = product.variants?.[0]
  const isOzon = product.source === "ozon"

  const statusColor = isOzon
    ? (product.status === "active" ? "blue" : "grey")
    : (product.status === "published" ? "green" : "grey")
  const statusLabel = isOzon
    ? (product.status === "active" ? "Ozon" : `Ozon (${product.status})`)
    : (product.status === "published" ? "Активен" : product.status)

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="transparent" size="small" onClick={() => navigate("/catalog")}>
            &larr; Каталог
          </Button>
          <Heading level="h1" className="mt-2">{product.title}</Heading>
          <Text className="text-ui-fg-subtle">
            {variant?.sku ? `SKU: ${variant.sku}` : product.handle}
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Badge color={statusColor}>{statusLabel}</Badge>
          {!confirmDelete ? (
            <Button variant="danger" size="small" onClick={() => setConfirmDelete(true)}>
              Удалить
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Text size="small" className="text-ui-fg-error">Уверены?</Text>
              <Button
                variant="danger"
                size="small"
                onClick={() => deleteMutation.mutate()}
                isLoading={deleteMutation.isPending}
              >
                Да, удалить
              </Button>
              <Button variant="secondary" size="small" onClick={() => setConfirmDelete(false)}>
                Отмена
              </Button>
            </div>
          )}
        </div>
      </div>

      {deleteMutation.error && (
        <Text size="small" className="text-ui-fg-error mb-4">
          {(deleteMutation.error as Error).message}
        </Text>
      )}

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">Обзор</Tabs.Trigger>
          <Tabs.Trigger value="orders">Закупки</Tabs.Trigger>
          <Tabs.Trigger value="ozon">Ozon</Tabs.Trigger>
          <Tabs.Trigger value="sales">Продажи</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <div className="grid grid-cols-4 gap-4 mt-4">
            <Container>
              <Text size="small" className="text-ui-fg-subtle">На складе</Text>
              <Heading level="h2">{variant?.warehouse_stock ?? 0}</Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Средняя себестоимость</Text>
              <Heading level="h2">
                {variant?.avg_cost > 0 ? `${Number(variant.avg_cost).toLocaleString("ru-RU")} ₽` : "—"}
              </Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Ozon FBO</Text>
              <Heading level="h2">{variant?.ozon_stock?.fbo_present ?? "—"}</Heading>
            </Container>
            <Container>
              <Text size="small" className="text-ui-fg-subtle">Ozon цена</Text>
              <Heading level="h2">
                {variant?.ozon?.ozon_price ? `${Number(variant.ozon.ozon_price).toLocaleString("ru-RU")} ₽` : "—"}
              </Heading>
            </Container>
          </div>
          {product.description && (
            <Container className="mt-4">
              <Text size="small" className="text-ui-fg-subtle mb-2">Описание</Text>
              <Text>{product.description}</Text>
            </Container>
          )}
        </Tabs.Content>

        <Tabs.Content value="orders">
          <Container className="mt-4">
            <Heading level="h2" className="mb-4">Заказы поставщикам</Heading>
            {!variant?.supplier_orders?.length ? (
              <Text className="text-ui-fg-subtle">Нет заказов поставщикам с этим товаром.</Text>
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
                  {variant.supplier_orders.map((item: any) => (
                    <Table.Row
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/suppliers/${item.supplier_order_id}`)}
                    >
                      <Table.Cell className="font-mono text-xs">{item.supplier_order_id}</Table.Cell>
                      <Table.Cell className="text-right">{item.ordered_qty}</Table.Cell>
                      <Table.Cell className="text-right">{item.received_qty}</Table.Cell>
                      <Table.Cell className="text-right">
                        {Number(item.unit_cost).toLocaleString("ru-RU")} ₽
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={item.status === "received" ? "green" : "grey"}>
                          {item.status}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </Container>
        </Tabs.Content>

        <Tabs.Content value="ozon">
          <Container className="mt-4">
            <Heading level="h2" className="mb-4">Ozon</Heading>
            {!variant?.ozon ? (
              <Text className="text-ui-fg-subtle">Товар не связан с Ozon.</Text>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Ozon Product ID</Text>
                  <Text>{variant.ozon.ozon_product_id}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Offer ID</Text>
                  <Text className="font-mono">{variant.ozon.offer_id}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">SKU</Text>
                  <Text>{variant.ozon.ozon_sku}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">FBO SKU</Text>
                  <Text>{variant.ozon.ozon_fbo_sku}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Статус</Text>
                  <Badge color={variant.ozon.ozon_status === "active" ? "green" : "grey"}>
                    {variant.ozon.ozon_status}
                  </Badge>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">Цена на Ozon</Text>
                  <Text>{variant.ozon.ozon_price ? `${Number(variant.ozon.ozon_price).toLocaleString("ru-RU")} ₽` : "—"}</Text>
                </div>
                {variant.ozon_stock && (
                  <>
                    <div>
                      <Text size="small" className="text-ui-fg-subtle">FBO в наличии</Text>
                      <Text>{variant.ozon_stock.fbo_present}</Text>
                    </div>
                    <div>
                      <Text size="small" className="text-ui-fg-subtle">FBO зарезервировано</Text>
                      <Text>{variant.ozon_stock.fbo_reserved}</Text>
                    </div>
                  </>
                )}
              </div>
            )}
          </Container>
        </Tabs.Content>

        <Tabs.Content value="sales">
          <Container className="mt-4">
            <Heading level="h2" className="mb-4">Последние продажи</Heading>
            {!variant?.recent_sales?.length ? (
              <Text className="text-ui-fg-subtle">Нет продаж.</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Дата</Table.HeaderCell>
                    <Table.HeaderCell>Заказ</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">Кол-во</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">Выручка</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">COGS</Table.HeaderCell>
                    <Table.HeaderCell>Статус</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {variant.recent_sales.map((sale: any) => (
                    <Table.Row key={sale.id}>
                      <Table.Cell>
                        {new Date(sale.sold_at).toLocaleDateString("ru-RU")}
                      </Table.Cell>
                      <Table.Cell className="font-mono text-xs">{sale.channel_order_id}</Table.Cell>
                      <Table.Cell className="text-right">{sale.quantity}</Table.Cell>
                      <Table.Cell className="text-right">
                        {Number(sale.revenue).toLocaleString("ru-RU")} ₽
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {sale.total_cogs ? `${Number(sale.total_cogs).toLocaleString("ru-RU")} ₽` : "—"}
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
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

export default CatalogDetailPage
