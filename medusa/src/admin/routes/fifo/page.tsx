import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"

type FifoLot = {
  id: string
  variant_id: string
  batch_number: string | null
  initial_qty: number
  remaining_qty: number
  cost_per_unit: string
  currency_code: string
  received_at: string
}

type FifoResponse = {
  lots: FifoLot[]
  count: number
  total_remaining_qty: number
  total_value: number
}

const FifoPage = () => {
  const { data, isLoading } = useQuery<FifoResponse>({
    queryKey: ["fifo-lots"],
    queryFn: async () => {
      const res = await fetch("/admin/fifo", { credentials: "include" })
      return res.json()
    },
  })

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">FIFO Лоты</Heading>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Всего лотов</Text>
          <Heading level="h2">{data?.count ?? "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Остаток (шт)</Text>
          <Heading level="h2">{data?.total_remaining_qty ?? "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Стоимость остатков</Text>
          <Heading level="h2">
            {data?.total_value != null
              ? `${data.total_value.toLocaleString("ru-RU")} ₽`
              : "—"}
          </Heading>
        </Container>
      </div>

      <Container>
        {isLoading ? (
          <Text>Загрузка...</Text>
        ) : !data?.lots?.length ? (
          <Text className="text-ui-fg-subtle">
            Нет FIFO лотов. Создайте поставку для добавления лотов.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Партия</Table.HeaderCell>
                <Table.HeaderCell>Вариант</Table.HeaderCell>
                <Table.HeaderCell>Начальное кол-во</Table.HeaderCell>
                <Table.HeaderCell>Остаток</Table.HeaderCell>
                <Table.HeaderCell>Себестоимость</Table.HeaderCell>
                <Table.HeaderCell>Дата приёмки</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.lots.map((lot) => (
                <Table.Row key={lot.id}>
                  <Table.Cell>{lot.batch_number || "—"}</Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="font-mono">{lot.variant_id.slice(0, 8)}</Text>
                  </Table.Cell>
                  <Table.Cell>{lot.initial_qty}</Table.Cell>
                  <Table.Cell>
                    <Badge color={lot.remaining_qty > 0 ? "green" : "grey"}>
                      {lot.remaining_qty}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {Number(lot.cost_per_unit).toLocaleString("ru-RU")} {lot.currency_code}
                  </Table.Cell>
                  <Table.Cell>
                    {new Date(lot.received_at).toLocaleDateString("ru-RU")}
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
  label: "FIFO Лоты",
  icon: CurrencyDollar,
})

export default FifoPage
