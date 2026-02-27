import { defineRouteConfig } from "@medusajs/admin-sdk"
import { TagSolid } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Button, Text, Input } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

type CatalogProduct = {
  id: string
  title: string
  handle: string
  status: string
  thumbnail: string | null
  source?: "medusa" | "ozon"
  variants: Array<{ id: string; title: string; sku: string | null }>
  warehouse_stock: number
  avg_cost: number
  ozon_fbo_stock: number
  ozon: { offer_id: string; ozon_status: string; ozon_price: string; ozon_product_id?: number } | null
}

const statusBadge = (product: CatalogProduct) => {
  if (product.source === "ozon") {
    const map: Record<string, { color: any; label: string }> = {
      active: { color: "blue", label: "Ozon" },
      inactive: { color: "grey", label: "Ozon (неакт.)" },
      archived: { color: "red", label: "Ozon (архив)" },
    }
    return map[product.status] || { color: "blue", label: "Ozon" }
  }
  const map: Record<string, { color: any; label: string }> = {
    published: { color: "green", label: "Активен" },
    draft: { color: "grey", label: "Черновик" },
    proposed: { color: "orange", label: "Предложен" },
    rejected: { color: "red", label: "Отклонён" },
  }
  return map[product.status] || { color: "grey", label: product.status }
}

const CatalogPage = () => {
  const [search, setSearch] = useState("")
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<{ products: CatalogProduct[]; count: number }>({
    queryKey: ["catalog", search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set("q", search)
      params.set("limit", "50")
      const res = await fetch(`/admin/catalog?${params}`, { credentials: "include" })
      return res.json()
    },
  })

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Каталог</Heading>
        <Button onClick={() => navigate("/catalog/create")}>
          Добавить товар
        </Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Поиск по названию или SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Товаров</Text>
          <Heading level="h2">{data?.count ?? "..."}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">На складе (шт)</Text>
          <Heading level="h2">
            {data?.products?.reduce((s, p) => s + p.warehouse_stock, 0) ?? "..."}
          </Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">На Ozon FBO</Text>
          <Heading level="h2">
            {data?.products?.reduce((s, p) => s + p.ozon_fbo_stock, 0) ?? "..."}
          </Heading>
        </Container>
      </div>

      <Container>
        {isLoading ? (
          <Text>Загрузка...</Text>
        ) : !data?.products?.length ? (
          <Text className="text-ui-fg-subtle">Нет товаров в каталоге.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Товар</Table.HeaderCell>
                <Table.HeaderCell>SKU</Table.HeaderCell>
                <Table.HeaderCell>Ozon</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Склад</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Ozon FBO</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Цена Ozon</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Себестоимость</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.products.map((product) => {
                const badge = statusBadge(product)
                const sku = product.variants?.[0]?.sku || "—"
                return (
                  <Table.Row
                    key={product.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/catalog/${product.id}`)}
                  >
                    <Table.Cell>
                      <div className="flex items-center gap-3">
                        {product.thumbnail && (
                          <img
                            src={product.thumbnail}
                            alt=""
                            className="w-8 h-8 rounded object-cover"
                          />
                        )}
                        <Text className="font-medium">{product.title}</Text>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs">{sku}</Table.Cell>
                    <Table.Cell className="font-mono text-xs">
                      {product.ozon?.offer_id || "—"}
                    </Table.Cell>
                    <Table.Cell className="text-right">{product.warehouse_stock}</Table.Cell>
                    <Table.Cell className="text-right">{product.ozon_fbo_stock}</Table.Cell>
                    <Table.Cell className="text-right">
                      {product.ozon?.ozon_price
                        ? `${Number(product.ozon.ozon_price).toLocaleString("ru-RU")} ₽`
                        : "—"}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      {product.avg_cost > 0
                        ? `${product.avg_cost.toLocaleString("ru-RU")} ₽`
                        : "—"}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={badge.color}>{badge.label}</Badge>
                    </Table.Cell>
                  </Table.Row>
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
  label: "Каталог",
  icon: TagSolid,
})

export default CatalogPage
