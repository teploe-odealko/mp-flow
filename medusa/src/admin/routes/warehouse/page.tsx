import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingsSolid } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Text, Tabs, Button, Input, Label } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

const fmt = (v: number) => Number(v).toLocaleString("ru-RU")
const fmtR = (v: number) => `${fmt(v)} ₽`

const InventoryPage = () => {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<any>({
    queryKey: ["inventory-matrix"],
    queryFn: async () => {
      const res = await fetch("/admin/inventory", { credentials: "include" })
      return res.json()
    },
  })

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Склад</Heading>
      </div>

      {!isLoading && data?.totals && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Container>
            <Text size="small" className="text-ui-fg-subtle">Товарных позиций</Text>
            <Heading level="h2">{data.totals.products}</Heading>
          </Container>
          <Container>
            <Text size="small" className="text-ui-fg-subtle">На складе (шт)</Text>
            <Heading level="h2">{fmt(data.totals.warehouse_stock)}</Heading>
          </Container>
          {data.totals.ozon_fbo != null && (
            <Container>
              <Text size="small" className="text-ui-fg-subtle">На Ozon FBO</Text>
              <Heading level="h2">{fmt(data.totals.ozon_fbo)}</Heading>
            </Container>
          )}
          <Container>
            <Text size="small" className="text-ui-fg-subtle">Стоимость запасов</Text>
            <Heading level="h2">{fmtR(data.totals.stock_value)}</Heading>
          </Container>
        </div>
      )}

      <Tabs defaultValue="matrix">
        <Tabs.List>
          <Tabs.Trigger value="matrix">Матрица</Tabs.Trigger>
          <Tabs.Trigger value="actions">Действия</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="matrix">
          <Container className="mt-4">
            {isLoading ? (
              <Text>Загрузка...</Text>
            ) : !data?.rows?.length ? (
              <Text className="text-ui-fg-subtle">Нет товаров с остатками.</Text>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Товар</Table.HeaderCell>
                      <Table.HeaderCell>SKU</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">Заказано</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">Получено</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">Наш склад</Table.HeaderCell>
                      {data.rows.some((r: any) => r.ozon_fbo != null) && (
                        <Table.HeaderCell className="text-right">Ozon FBO</Table.HeaderCell>
                      )}
                      {data.rows.some((r: any) => r.sold_qty != null) && (
                        <Table.HeaderCell className="text-right">Продано</Table.HeaderCell>
                      )}
                      <Table.HeaderCell className="text-right">Ср. себест.</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.rows.map((row: any) => {
                      const hasOzonFbo = data.rows.some((r: any) => r.ozon_fbo != null)
                      const hasSoldQty = data.rows.some((r: any) => r.sold_qty != null)
                      return (
                        <Table.Row
                          key={row.variant_id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/warehouse/sku/${row.variant_id}`)}
                        >
                          <Table.Cell>
                            <Text className="font-medium">{row.product_title}</Text>
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs">{row.sku || "—"}</Table.Cell>
                          <Table.Cell className="text-right">{row.ordered_qty}</Table.Cell>
                          <Table.Cell className="text-right">{row.received_qty}</Table.Cell>
                          <Table.Cell className="text-right">
                            <Badge color={row.warehouse_stock > 0 ? "green" : "grey"}>
                              {row.warehouse_stock}
                            </Badge>
                          </Table.Cell>
                          {hasOzonFbo && (
                            <Table.Cell className="text-right">{row.ozon_fbo ?? "—"}</Table.Cell>
                          )}
                          {hasSoldQty && (
                            <Table.Cell className="text-right">{row.sold_qty ?? "—"}</Table.Cell>
                          )}
                          <Table.Cell className="text-right">
                            {row.avg_cost > 0 ? fmtR(row.avg_cost) : "—"}
                          </Table.Cell>
                        </Table.Row>
                      )
                    })}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Container>
        </Tabs.Content>

        <Tabs.Content value="actions">
          <div className="mt-4 grid grid-cols-2 gap-6">
            <InitialBalanceForm />
            <WriteOffForm />
          </div>
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

const InitialBalanceForm = () => {
  const queryClient = useQueryClient()
  const [variantId, setVariantId] = useState("")
  const [qty, setQty] = useState("")
  const [costPerUnit, setCostPerUnit] = useState("")

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/inventory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initial-balance",
          items: [{ variant_id: variantId, quantity: Number(qty), cost_per_unit: Number(costPerUnit) }],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-matrix"] })
      setVariantId("")
      setQty("")
      setCostPerUnit("")
    },
  })

  return (
    <Container>
      <Heading level="h2" className="mb-4">Начальный остаток</Heading>
      <div className="space-y-3">
        <div>
          <Label>Variant ID</Label>
          <Input placeholder="prodvar_..." value={variantId} onChange={(e) => setVariantId(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Количество</Label>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Label>Себестоимость/ед (руб)</Label>
            <Input type="number" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} />
          </div>
        </div>
        <Button
          onClick={() => mutation.mutate()}
          isLoading={mutation.isPending}
          disabled={!variantId || !qty || !costPerUnit}
        >
          Добавить остаток
        </Button>
        {mutation.error && (
          <Text size="small" className="text-ui-fg-error">{(mutation.error as Error).message}</Text>
        )}
        {mutation.isSuccess && (
          <Text size="small" className="text-ui-fg-interactive">Остаток добавлен.</Text>
        )}
      </div>
    </Container>
  )
}

const WriteOffForm = () => {
  const queryClient = useQueryClient()
  const [variantId, setVariantId] = useState("")
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState("")

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/inventory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "write-off",
          variant_id: variantId,
          quantity: Number(qty),
          reason: reason || "Списание",
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-matrix"] })
      setVariantId("")
      setQty("")
      setReason("")
    },
  })

  return (
    <Container>
      <Heading level="h2" className="mb-4">Списание</Heading>
      <div className="space-y-3">
        <div>
          <Label>Variant ID</Label>
          <Input placeholder="prodvar_..." value={variantId} onChange={(e) => setVariantId(e.target.value)} />
        </div>
        <div>
          <Label>Количество</Label>
          <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <Label>Причина</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Расхождение при инвентаризации" />
        </div>
        <Button
          variant="danger"
          onClick={() => mutation.mutate()}
          isLoading={mutation.isPending}
          disabled={!variantId || !qty}
        >
          Списать
        </Button>
        {mutation.error && (
          <Text size="small" className="text-ui-fg-error">{(mutation.error as Error).message}</Text>
        )}
        {mutation.isSuccess && (
          <Text size="small" className="text-ui-fg-interactive">Списание выполнено.</Text>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Склад",
  icon: BuildingsSolid,
})

export default InventoryPage
