import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Container, Heading, Badge, Button, Text } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

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

  const accounts: OzonAccount[] = data?.accounts || []
  const hasAccounts = accounts.length > 0

  if (isLoading) {
    return (
      <Container>
        <Heading level="h1">Ozon Синхронизация</Heading>
        <Text>Загрузка...</Text>
      </Container>
    )
  }

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <Heading level="h1">Ozon Синхронизация</Heading>
      </div>

      {!hasAccounts ? (
        <Container>
          <Text className="text-ui-fg-subtle">
            Нет подключённых аккаунтов Ozon.{" "}
            <a href="/app/settings/ozon" className="text-ui-fg-interactive underline">
              Настройте подключение
            </a>{" "}
            в разделе Settings.
          </Text>
        </Container>
      ) : (
        <>
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

          {accounts[0]?.last_error && (
            <Container>
              <Text size="small" className="text-ui-fg-error">
                Последняя ошибка: {accounts[0].last_error}
              </Text>
            </Container>
          )}
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Ozon Синк",
  icon: ArrowPath,
})

export default OzonSyncPage
