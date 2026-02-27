import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Container, Heading, Table, Badge, Button, Text, Input, Label } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

type OzonAccount = {
  id: string
  name: string
  client_id: string
  is_active: boolean
  last_sync_at: string | null
  last_error: string | null
  total_products: number
  freshness?: {
    products: { status: string; minutes_ago: number | null }
    stocks: { status: string; minutes_ago: number | null }
    sales: { status: string; minutes_ago: number | null }
  }
}

const freshnessColor = (status: string) => {
  switch (status) {
    case "fresh": return "green" as const
    case "stale": return "orange" as const
    case "outdated": return "red" as const
    default: return "grey" as const
  }
}

const freshnessLabel = (f: { status: string; minutes_ago: number | null }) => {
  if (!f.minutes_ago && f.minutes_ago !== 0) return "Не синхр."
  if (f.minutes_ago < 60) return `${f.minutes_ago} мин назад`
  if (f.minutes_ago < 1440) return `${Math.floor(f.minutes_ago / 60)} ч назад`
  return `${Math.floor(f.minutes_ago / 1440)} дн назад`
}

const OzonSyncPage = () => {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    client_id: "",
    api_key: "",
  })

  const { data, isLoading } = useQuery<any>({
    queryKey: ["ozon-sync"],
    queryFn: async () => {
      const res = await fetch("/admin/ozon-sync", { credentials: "include" })
      return res.json()
    },
    refetchInterval: 30000,
  })

  const syncMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await fetch("/admin/ozon-sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; client_id: string; api_key: string }) => {
      const res = await fetch("/admin/ozon-accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
      setShowForm(false)
      setFormData({ name: "", client_id: "", api_key: "" })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/admin/ozon-accounts/${id}`, {
        method: "DELETE",
        credentials: "include",
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
    },
  })

  const accounts: OzonAccount[] = data?.accounts || []
  const hasAccounts = accounts.length > 0

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Ozon Синхронизация</Heading>
        <Button variant="secondary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Отмена" : "Добавить аккаунт"}
        </Button>
      </div>

      {showForm && (
        <Container className="mb-6">
          <Heading level="h2" className="mb-4">Новый аккаунт Ozon</Heading>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <Label>Название</Label>
              <Input
                placeholder="Мой магазин"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Client ID</Label>
              <Input
                placeholder="1234567"
                value={formData.client_id}
                onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
              />
            </div>
            <div>
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              />
            </div>
          </div>
          <Button
            onClick={() => createMutation.mutate(formData)}
            isLoading={createMutation.isPending}
            disabled={!formData.name || !formData.client_id || !formData.api_key}
          >
            Сохранить
          </Button>
          {createMutation.error && (
            <Text size="small" className="text-ui-fg-error mt-2">
              {(createMutation.error as Error).message}
            </Text>
          )}
        </Container>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Аккаунты Ozon</Text>
          <Heading level="h2">{data?.stats?.total_accounts ?? "—"}</Heading>
        </Container>
        <Container>
          <Text size="small" className="text-ui-fg-subtle">Связанных товаров</Text>
          <Heading level="h2">{data?.stats?.total_linked_products ?? "—"}</Heading>
        </Container>
      </div>

      {/* Sync actions */}
      {hasAccounts && (
        <Container className="mb-6">
          <Heading level="h2" className="mb-4">Синхронизация</Heading>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                onClick={() => syncMutation.mutate("products")}
                isLoading={syncMutation.isPending}
                className="w-full"
              >
                Синк товаров
              </Button>
              {accounts[0]?.freshness?.products && (
                <div className="text-center">
                  <Badge color={freshnessColor(accounts[0].freshness.products.status)}>
                    {freshnessLabel(accounts[0].freshness.products)}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                onClick={() => syncMutation.mutate("stocks")}
                isLoading={syncMutation.isPending}
                className="w-full"
              >
                Синк остатков
              </Button>
              {accounts[0]?.freshness?.stocks && (
                <div className="text-center">
                  <Badge color={freshnessColor(accounts[0].freshness.stocks.status)}>
                    {freshnessLabel(accounts[0].freshness.stocks)}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                onClick={() => syncMutation.mutate("sales")}
                isLoading={syncMutation.isPending}
                className="w-full"
              >
                Синк продаж
              </Button>
              {accounts[0]?.freshness?.sales && (
                <div className="text-center">
                  <Badge color={freshnessColor(accounts[0].freshness.sales.status)}>
                    {freshnessLabel(accounts[0].freshness.sales)}
                  </Badge>
                </div>
              )}
            </div>
          </div>
          {syncMutation.data && (
            <div className="mt-4 p-3 bg-ui-bg-subtle rounded">
              <Text size="small" className="font-medium mb-1">Результат:</Text>
              <pre className="text-xs whitespace-pre-wrap">
                {JSON.stringify(syncMutation.data.results, null, 2)}
              </pre>
            </div>
          )}
        </Container>
      )}

      {/* Accounts table */}
      <Container>
        <Heading level="h2" className="mb-4">Аккаунты</Heading>
        {isLoading ? (
          <Text>Загрузка...</Text>
        ) : !hasAccounts ? (
          <Text className="text-ui-fg-subtle">
            Нет аккаунтов Ozon. Нажмите «Добавить аккаунт» для начала работы.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Название</Table.HeaderCell>
                <Table.HeaderCell>Client ID</Table.HeaderCell>
                <Table.HeaderCell>Статус</Table.HeaderCell>
                <Table.HeaderCell>Товаров</Table.HeaderCell>
                <Table.HeaderCell>Последний синк</Table.HeaderCell>
                <Table.HeaderCell>Ошибка</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {accounts.map((account) => (
                <Table.Row key={account.id}>
                  <Table.Cell>{account.name}</Table.Cell>
                  <Table.Cell className="font-mono text-xs">{account.client_id}</Table.Cell>
                  <Table.Cell>
                    <Badge color={account.is_active ? "green" : "grey"}>
                      {account.is_active ? "Активен" : "Неактивен"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{account.total_products}</Table.Cell>
                  <Table.Cell>
                    {account.last_sync_at
                      ? new Date(account.last_sync_at).toLocaleString("ru-RU")
                      : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    {account.last_error ? (
                      <Text size="small" className="text-ui-fg-error">{account.last_error}</Text>
                    ) : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => deleteMutation.mutate(account.id)}
                      isLoading={deleteMutation.isPending}
                    >
                      Удалить
                    </Button>
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
  label: "Ozon Синк",
  icon: ArrowPath,
})

export default OzonSyncPage
