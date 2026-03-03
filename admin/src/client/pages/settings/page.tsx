import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost, apiDelete } from "../../lib/api"
import { Key, Plus, Trash2, Copy, Check, ExternalLink } from "lucide-react"

interface ApiKeyItem {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
}

// ── API Keys Section ──

function ApiKeysSection() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiGet<{ keys: ApiKeyItem[] }>("/api/api-keys"),
  })

  const createMut = useMutation({
    mutationFn: (name: string) => apiPost<{ id: string; name: string; key: string }>("/api/api-keys", { name }),
    onSuccess: (data) => {
      setCreatedKey(data.key)
      setNewName("")
      queryClient.invalidateQueries({ queryKey: ["api-keys"] })
    },
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  })

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">API ключи</h2>
          <p className="text-sm text-text-muted mt-0.5">Токены для программного доступа к API и MCP</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreatedKey(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent-dark transition-colors"
        >
          <Plus size={16} /> Создать ключ
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="mb-4 p-4 bg-bg-surface border border-bg-border rounded-lg">
          {createdKey ? (
            <div>
              <p className="text-sm text-text-secondary mb-2">
                Ключ создан. Скопируйте его сейчас — он больше не будет показан.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm font-mono text-accent break-all">
                  {createdKey}
                </code>
                <button
                  onClick={() => handleCopy(createdKey)}
                  className="shrink-0 p-2 hover:bg-bg-elevated rounded transition-colors"
                  title="Копировать"
                >
                  {copied ? <Check size={16} className="text-inflow" /> : <Copy size={16} className="text-text-muted" />}
                </button>
              </div>
              <button
                onClick={() => { setShowCreate(false); setCreatedKey(null) }}
                className="mt-3 text-sm text-text-muted hover:text-text-secondary"
              >
                Закрыть
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-muted block mb-1">Название ключа</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Cursor, Claude Code..."
                  className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
                  onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMut.mutate(newName.trim())}
                />
              </div>
              <button
                onClick={() => newName.trim() && createMut.mutate(newName.trim())}
                disabled={!newName.trim() || createMut.isPending}
                className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
              >
                {createMut.isPending ? "..." : "Создать"}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      )}

      {/* Keys table */}
      {isLoading ? (
        <p className="text-sm text-text-muted">Загрузка...</p>
      ) : !keys?.keys?.length ? (
        <p className="text-sm text-text-muted">Нет API ключей</p>
      ) : (
        <div className="border border-bg-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface border-b border-bg-border">
                <th className="text-left px-4 py-2.5 text-text-muted font-medium">Название</th>
                <th className="text-left px-4 py-2.5 text-text-muted font-medium">Ключ</th>
                <th className="text-left px-4 py-2.5 text-text-muted font-medium">Создан</th>
                <th className="text-left px-4 py-2.5 text-text-muted font-medium">Использован</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {keys.keys.map((k) => (
                <tr key={k.id} className="border-b border-bg-border last:border-b-0 hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 text-text-primary">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-text-muted">{k.key_prefix}...</td>
                  <td className="px-4 py-2.5 text-text-muted">{fmtDate(k.created_at)}</td>
                  <td className="px-4 py-2.5 text-text-muted">{fmtDate(k.last_used_at)}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => revokeMut.mutate(k.id)}
                      disabled={revokeMut.isPending}
                      className="text-text-muted hover:text-outflow transition-colors"
                      title="Отозвать ключ"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── MCP Instructions Section ──

function McpSection() {
  const baseUrl = window.location.origin
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const claudeConfig = JSON.stringify({
    mcpServers: {
      mpflow: {
        type: "http",
        url: `${baseUrl}/mcp`,
        headers: {
          Authorization: "Bearer YOUR_API_KEY",
        },
      },
    },
  }, null, 2)

  const cursorConfig = JSON.stringify({
    mcpServers: {
      mpflow: {
        url: `${baseUrl}/mcp`,
        headers: {
          Authorization: "Bearer YOUR_API_KEY",
        },
      },
    },
  }, null, 2)

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-1">MCP (AI-агенты)</h2>
      <p className="text-sm text-text-muted mb-4">
        Подключите AI-агентов (Cursor, Claude Code) к MPFlow через MCP протокол.
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-sm text-text-secondary mb-1">MCP endpoint</p>
          <code className="inline-block px-3 py-1.5 bg-bg-surface border border-bg-border rounded text-sm font-mono text-accent">
            {baseUrl}/mcp
          </code>
        </div>

        {/* Claude Code */}
        <div className="p-4 bg-bg-surface border border-bg-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-primary">Claude Code</h3>
            <button
              onClick={() => copyText("claude", claudeConfig)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              {copiedId === "claude" ? <Check size={14} className="text-inflow" /> : <Copy size={14} />}
              {copiedId === "claude" ? "Скопировано" : "Копировать"}
            </button>
          </div>
          <p className="text-xs text-text-muted mb-2">
            Добавьте в <code className="text-accent">.mcp.json</code> в корне проекта:
          </p>
          <pre className="p-3 bg-bg-deep border border-bg-border rounded text-xs font-mono text-text-secondary overflow-x-auto">
            {claudeConfig}
          </pre>
        </div>

        {/* Cursor */}
        <div className="p-4 bg-bg-surface border border-bg-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-primary">Cursor</h3>
            <button
              onClick={() => copyText("cursor", cursorConfig)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              {copiedId === "cursor" ? <Check size={14} className="text-inflow" /> : <Copy size={14} />}
              {copiedId === "cursor" ? "Скопировано" : "Копировать"}
            </button>
          </div>
          <p className="text-xs text-text-muted mb-2">
            Добавьте в <code className="text-accent">.cursor/mcp.json</code> в корне проекта:
          </p>
          <pre className="p-3 bg-bg-deep border border-bg-border rounded text-xs font-mono text-text-secondary overflow-x-auto">
            {cursorConfig}
          </pre>
        </div>

        <p className="text-xs text-text-muted">
          Замените <code className="text-accent">YOUR_API_KEY</code> на ваш API ключ (создайте выше).
        </p>
      </div>
    </section>
  )
}

// ── API Playground Section ──

function PlaygroundSection() {
  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-1">API Playground</h2>
      <p className="text-sm text-text-muted mb-3">
        Интерактивная документация и тестирование API эндпоинтов.
      </p>
      <a
        href="/api/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-bg-surface border border-bg-border rounded-lg text-sm text-text-primary hover:bg-bg-elevated transition-colors"
      >
        <ExternalLink size={16} />
        Открыть API Docs
      </a>
    </section>
  )
}

// ── Settings Page ──

export default function SettingsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-text-primary mb-6">Настройки</h1>

      <div className="space-y-8">
        <ApiKeysSection />
        <div className="border-t border-bg-border" />
        <McpSection />
        <div className="border-t border-bg-border" />
        <PlaygroundSection />
      </div>
    </div>
  )
}
