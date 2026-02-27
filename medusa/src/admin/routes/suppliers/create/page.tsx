import { Container, Heading, Button, Text, Input, Label } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"

type ItemRow = {
  variant_id: string
  variant_title: string
  ordered_qty: number
  purchase_price_rub: number
  packaging_cost_rub: number
  logistics_cost_rub: number
  customs_cost_rub: number
  extra_cost_rub: number
}

type SharedCostRow = {
  name: string
  total_rub: number
  method: string
}

const emptyItem = (): ItemRow => ({
  variant_id: "",
  variant_title: "",
  ordered_qty: 1,
  purchase_price_rub: 0,
  packaging_cost_rub: 0,
  logistics_cost_rub: 0,
  customs_cost_rub: 0,
  extra_cost_rub: 0,
})

const emptySharedCost = (): SharedCostRow => ({
  name: "",
  total_rub: 0,
  method: "equal",
})

const CreateSupplierOrderPage = () => {
  const navigate = useNavigate()
  const [supplierName, setSupplierName] = useState("")
  const [orderNumber, setOrderNumber] = useState("")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<ItemRow[]>([emptyItem()])
  const [sharedCosts, setSharedCosts] = useState<SharedCostRow[]>([])

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        supplier_name: supplierName,
        order_number: orderNumber || undefined,
        order_date: orderDate || undefined,
        notes: notes || undefined,
        status: "draft",
        currency_code: "RUB",
        items: items.filter((i) => i.variant_id).map((i) => ({
          variant_id: i.variant_id,
          variant_title: i.variant_title || i.variant_id,
          ordered_qty: i.ordered_qty,
          purchase_price_rub: i.purchase_price_rub,
          packaging_cost_rub: i.packaging_cost_rub,
          logistics_cost_rub: i.logistics_cost_rub,
          customs_cost_rub: i.customs_cost_rub,
          extra_cost_rub: i.extra_cost_rub,
        })),
        shared_costs: sharedCosts.filter((c) => c.name),
      }
      const res = await fetch("/admin/suppliers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data) => {
      navigate(`/suppliers/${data.supplier_order?.id || ""}`)
    },
  })

  const updateItem = (idx: number, field: keyof ItemRow, value: any) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  const updateSharedCost = (idx: number, field: keyof SharedCostRow, value: any) => {
    setSharedCosts((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)))
  }

  return (
    <Container>
      <div className="mb-6">
        <Button variant="transparent" size="small" onClick={() => navigate("/suppliers")}>
          &larr; Закупки
        </Button>
        <Heading level="h1" className="mt-2">Создать заказ поставщику</Heading>
      </div>

      {/* Header fields */}
      <Container className="mb-6">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <Label>Поставщик *</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Название поставщика" />
          </div>
          <div>
            <Label>Номер заказа</Label>
            <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-001" />
          </div>
          <div>
            <Label>Дата заказа</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div>
            <Label>Заметки</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Доп. информация" />
          </div>
        </div>
      </Container>

      {/* Items */}
      <Container className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <Heading level="h2">Товары</Heading>
          <Button variant="secondary" size="small" onClick={() => setItems([...items, emptyItem()])}>
            + Добавить товар
          </Button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-8 gap-2 items-end">
              <div className="col-span-2">
                {idx === 0 && <Label>Variant ID *</Label>}
                <Input
                  value={item.variant_id}
                  onChange={(e) => updateItem(idx, "variant_id", e.target.value)}
                  placeholder="prodvar_..."
                />
              </div>
              <div>
                {idx === 0 && <Label>Название</Label>}
                <Input
                  value={item.variant_title}
                  onChange={(e) => updateItem(idx, "variant_title", e.target.value)}
                  placeholder="Товар"
                />
              </div>
              <div>
                {idx === 0 && <Label>Кол-во *</Label>}
                <Input
                  type="number"
                  value={item.ordered_qty}
                  onChange={(e) => updateItem(idx, "ordered_qty", Number(e.target.value))}
                />
              </div>
              <div>
                {idx === 0 && <Label>Цена закуп.</Label>}
                <Input
                  type="number"
                  value={item.purchase_price_rub || ""}
                  onChange={(e) => updateItem(idx, "purchase_price_rub", Number(e.target.value))}
                  placeholder="₽"
                />
              </div>
              <div>
                {idx === 0 && <Label>Упаковка</Label>}
                <Input
                  type="number"
                  value={item.packaging_cost_rub || ""}
                  onChange={(e) => updateItem(idx, "packaging_cost_rub", Number(e.target.value))}
                  placeholder="₽"
                />
              </div>
              <div>
                {idx === 0 && <Label>Логистика</Label>}
                <Input
                  type="number"
                  value={item.logistics_cost_rub || ""}
                  onChange={(e) => updateItem(idx, "logistics_cost_rub", Number(e.target.value))}
                  placeholder="₽"
                />
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1">
                  {idx === 0 && <Label>Таможня</Label>}
                  <Input
                    type="number"
                    value={item.customs_cost_rub || ""}
                    onChange={(e) => updateItem(idx, "customs_cost_rub", Number(e.target.value))}
                    placeholder="₽"
                  />
                </div>
                {items.length > 1 && (
                  <Button
                    variant="transparent"
                    size="small"
                    className="mt-auto"
                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  >
                    ×
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Shared costs */}
      <Container className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <Heading level="h2">Общие расходы</Heading>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setSharedCosts([...sharedCosts, emptySharedCost()])}
          >
            + Добавить расход
          </Button>
        </div>

        {sharedCosts.length === 0 ? (
          <Text className="text-ui-fg-subtle">Нет общих расходов. Они будут распределены между товарами.</Text>
        ) : (
          <div className="space-y-3">
            {sharedCosts.map((cost, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 items-end">
                <div>
                  {idx === 0 && <Label>Название</Label>}
                  <Input
                    value={cost.name}
                    onChange={(e) => updateSharedCost(idx, "name", e.target.value)}
                    placeholder="Доставка / Карго"
                  />
                </div>
                <div>
                  {idx === 0 && <Label>Сумма (руб)</Label>}
                  <Input
                    type="number"
                    value={cost.total_rub || ""}
                    onChange={(e) => updateSharedCost(idx, "total_rub", Number(e.target.value))}
                  />
                </div>
                <div>
                  {idx === 0 && <Label>Метод</Label>}
                  <Input
                    value={cost.method}
                    onChange={(e) => updateSharedCost(idx, "method", e.target.value)}
                    placeholder="equal"
                  />
                </div>
                <div>
                  <Button
                    variant="transparent"
                    size="small"
                    onClick={() => setSharedCosts(sharedCosts.filter((_, i) => i !== idx))}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>

      {/* Submit */}
      <div className="flex gap-3">
        <Button
          onClick={() => mutation.mutate()}
          isLoading={mutation.isPending}
          disabled={!supplierName || !items.some((i) => i.variant_id)}
        >
          Создать заказ
        </Button>
        <Button variant="secondary" onClick={() => navigate("/suppliers")}>
          Отмена
        </Button>
      </div>

      {mutation.error && (
        <Text size="small" className="text-ui-fg-error mt-2">
          {(mutation.error as Error).message}
        </Text>
      )}
    </Container>
  )
}

export default CreateSupplierOrderPage
