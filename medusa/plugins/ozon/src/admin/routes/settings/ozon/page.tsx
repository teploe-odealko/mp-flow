import { defineRouteConfig } from "@medusajs/admin-sdk"
import { BuildingStorefront } from "@medusajs/icons"
import { Container, Heading, Text, Input, Label, Button, Badge } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect } from "react"

type OzonAccount = {
  id: string
  name: string
  client_id: string
  is_active: boolean
  last_sync_at: string | null
}

const OzonSettingsPage = () => {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [existingId, setExistingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const { data, isLoading } = useQuery<{ accounts: OzonAccount[] }>({
    queryKey: ["ozon-accounts"],
    queryFn: async () => {
      const res = await fetch("/admin/ozon-accounts", { credentials: "include" })
      return res.json()
    },
  })

  useEffect(() => {
    if (data?.accounts?.length) {
      const account = data.accounts[0]
      setClientId(account.client_id)
      setApiKey("") // Don't show existing key
      setExistingId(account.id)
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (existingId) {
        const body: Record<string, string> = { client_id: clientId }
        if (apiKey) body.api_key = apiKey
        const res = await fetch(`/admin/ozon-accounts/${existingId}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      } else {
        const res = await fetch("/admin/ozon-accounts", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Ozon",
            client_id: clientId,
            api_key: apiKey,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/ozon-accounts/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, api_key: apiKey }),
      })
      return res.json()
    },
    onSuccess: (result: any) => {
      setTestResult(
        result.ok
          ? { ok: true, message: `Подключено: ${result.seller_name}` }
          : { ok: false, message: result.error }
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!existingId) return
      const res = await fetch(`/admin/ozon-accounts/${existingId}`, {
        method: "DELETE",
        credentials: "include",
      })
      return res.json()
    },
    onSuccess: () => {
      setClientId("")
      setApiKey("")
      setExistingId(null)
      setTestResult(null)
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
    },
  })

  const account = data?.accounts?.[0]
  const isConnected = !!account

  if (isLoading) {
    return (
      <Container>
        <Heading level="h1">Ozon</Heading>
        <Text>Загрузка...</Text>
      </Container>
    )
  }

  return (
    <Container>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Heading level="h1">Ozon</Heading>
          <Text className="text-ui-fg-subtle mt-1">
            Подключение к Ozon Seller API
          </Text>
        </div>
        <Badge color={isConnected ? "green" : "grey"}>
          {isConnected ? "Подключено" : "Не подключено"}
        </Badge>
      </div>

      <Container className="mb-6">
        <div className="grid grid-cols-1 gap-4 mb-4">
          <div>
            <Label>Client ID</Label>
            <Input
              placeholder="1234567"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div>
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder={existingId ? "••••••••  (оставьте пустым, чтобы не менять)" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending}
            disabled={!clientId || (!apiKey && !existingId)}
          >
            Сохранить
          </Button>
          <Button
            variant="secondary"
            onClick={() => testMutation.mutate()}
            isLoading={testMutation.isPending}
            disabled={!clientId || !apiKey}
          >
            Проверить подключение
          </Button>
          {existingId && (
            <Button
              variant="danger"
              onClick={() => deleteMutation.mutate()}
              isLoading={deleteMutation.isPending}
            >
              Удалить подключение
            </Button>
          )}
        </div>

        {saveMutation.error && (
          <Text size="small" className="text-ui-fg-error mt-3">
            {(saveMutation.error as Error).message}
          </Text>
        )}

        {testResult && (
          <div className={`mt-3 p-3 rounded ${testResult.ok ? "bg-ui-bg-success" : "bg-ui-bg-error"}`}>
            <Text size="small" className={testResult.ok ? "text-ui-fg-success" : "text-ui-fg-error"}>
              {testResult.message}
            </Text>
          </div>
        )}
      </Container>

      {isConnected && account && (
        <Container>
          <Heading level="h2" className="mb-3">Статус</Heading>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Text size="small" className="text-ui-fg-subtle">Client ID</Text>
              <Text className="font-mono">{account.client_id}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Последний синк</Text>
              <Text>
                {account.last_sync_at
                  ? new Date(account.last_sync_at).toLocaleString("ru-RU")
                  : "Не синхронизировано"}
              </Text>
            </div>
          </div>
        </Container>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Ozon",
  icon: BuildingStorefront,
})

export default OzonSettingsPage
