import { useQuery } from "@tanstack/react-query"
import { apiGet } from "../../lib/api"
import { useAuth } from "../../app/auth-provider"
import { CreditCard, TrendingDown, TrendingUp, RotateCcw, ExternalLink } from "lucide-react"

interface CreditTransaction {
  id: string
  user_id: string
  amount: number
  balance_after: number
  type: string
  plugin_name: string | null
  operation: string | null
  description: string | null
  created_at: string
}

interface CreditStats {
  daily: Array<{ date: string; used: number; refunded: number }>
  byOperation: Array<{ plugin_name: string; operation: string; count: number; credits: number }>
  totalUsed: number
  totalRefunded: number
  totalTopups: number
}

interface CreditPackage {
  id: string
  credits: number
  price_rub: number
  sort_order: number
}

interface BillableOp {
  name: string
  description: string
  creditCost: number
}

interface PluginOps {
  plugin: string
  pluginLabel: string
  operations: BillableOp[]
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function tierLabel(tier: string | null): string {
  if (!tier) return "Trial"
  if (tier === "core" || tier === "plus") return "Core"
  return tier
}

function pricePerToken(pkg: CreditPackage): string {
  return (pkg.price_rub / pkg.credits).toFixed(2)
}

// ── Subscription Section ──

function SubscriptionSection() {
  const { subscription } = useAuth()

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">Подписка</h2>
      <div className="p-4 bg-bg-surface border border-bg-border rounded-lg">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              subscription?.active ? "bg-inflow" : "bg-outflow"
            }`}
          />
          <span className="text-sm font-medium text-text-primary">
            {tierLabel(subscription?.tier ?? null)}
          </span>
          <span className="text-sm text-text-muted">
            — 300 ₽/мес
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${subscription?.active ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {subscription?.active ? "Активна" : "Не активна"}
          </span>
        </div>
        {subscription?.activeUntil && (
          <p className="text-sm text-text-muted">
            Действует до: {fmtDate(subscription.activeUntil)}
          </p>
        )}
        <p className="text-xs text-text-muted mt-3">
          Включает все функции ядра: каталог, склад, поставки, продажи, финансы, аналитику.
          Токены для плагинов приобретаются отдельно.
        </p>
        <p className="text-sm text-text-muted mt-2">
          Для изменения подписки обратитесь в{" "}
          <a
            href="https://t.me/teploe_odealko"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline inline-flex items-center gap-1"
          >
            Telegram <ExternalLink size={12} />
          </a>
        </p>
      </div>
    </section>
  )
}

// ── Credit Balance Section ──

function CreditBalanceSection() {
  const { subscription } = useAuth()
  const balance = subscription?.creditBalance ?? 0

  const { data: statsData } = useQuery({
    queryKey: ["billing-stats"],
    queryFn: () => apiGet<CreditStats>("/api/billing/credits/stats?days=30"),
    staleTime: 30_000,
  })

  const { data: packagesData } = useQuery({
    queryKey: ["billing-packages"],
    queryFn: () => apiGet<{ packages: CreditPackage[] }>("/api/billing/packages"),
    staleTime: 60_000,
  })

  const packages = packagesData?.packages ?? []
  const usedThisMonth = statsData?.totalUsed ?? 0

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">Токены</h2>
      <div className="p-4 bg-bg-surface border border-bg-border rounded-lg">
        <div className="flex items-center gap-3 mb-3">
          <CreditCard size={24} className="text-accent shrink-0" />
          <span className="text-2xl font-bold text-text-primary">{balance}</span>
          <span className="text-sm text-text-muted">токенов</span>
        </div>

        {usedThisMonth > 0 && (
          <p className="text-sm text-text-muted mb-4">
            Использовано за 30 дней: {usedThisMonth}
          </p>
        )}

        {packages.length > 0 && (
          <div>
            <p className="text-sm text-text-muted mb-2">Пополнить баланс:</p>
            <div className="flex gap-3 flex-wrap">
              {packages.map((pkg) => (
                <a
                  key={pkg.id}
                  href="https://t.me/teploe_odealko"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center px-4 py-3 text-sm bg-bg-elevated border border-bg-border rounded-lg hover:border-accent transition-colors min-w-[120px]"
                >
                  <span className="text-lg font-bold text-text-primary">{pkg.credits}</span>
                  <span className="text-text-muted text-xs mb-1">токенов</span>
                  <span className="font-medium text-accent">{pkg.price_rub} ₽</span>
                  <span className="text-text-muted text-[10px] mt-0.5">{pricePerToken(pkg)} ₽/токен</span>
                </a>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-2">
              Чем больше пакет, тем выгоднее цена за токен
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Usage Stats Section ──

function UsageStatsSection() {
  const { data: statsData, isLoading } = useQuery({
    queryKey: ["billing-stats"],
    queryFn: () => apiGet<CreditStats>("/api/billing/credits/stats?days=30"),
    staleTime: 30_000,
  })

  if (isLoading) return null

  const stats = statsData
  if (!stats || (stats.totalUsed === 0 && stats.totalTopups === 0)) return null

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">Статистика за 30 дней</h2>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Использовано" value={stats.totalUsed} icon={TrendingDown} color="text-outflow" />
        <StatCard label="Возвращено" value={stats.totalRefunded} icon={RotateCcw} color="text-text-muted" />
        <StatCard label="Пополнено" value={stats.totalTopups} icon={TrendingUp} color="text-inflow" />
      </div>

      {stats.byOperation.length > 0 && (
        <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border text-text-muted text-left">
                <th className="px-4 py-2 font-medium">Операция</th>
                <th className="px-4 py-2 font-medium text-right">Вызовов</th>
                <th className="px-4 py-2 font-medium text-right">Токенов</th>
              </tr>
            </thead>
            <tbody>
              {stats.byOperation.map((op, i) => (
                <tr key={i} className="border-b border-bg-border last:border-0">
                  <td className="px-4 py-2">
                    <span className="text-text-primary">{op.operation}</span>
                    <span className="text-text-muted ml-1 text-xs">({op.plugin_name})</span>
                  </td>
                  <td className="px-4 py-2 text-right text-text-secondary">{op.count}</td>
                  <td className="px-4 py-2 text-right text-outflow font-medium">{op.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="p-3 bg-bg-surface border border-bg-border rounded-lg">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={color} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <span className={`text-lg font-semibold ${color}`}>{value}</span>
    </div>
  )
}

// ── Transaction History ──

function HistorySection() {
  const { data, isLoading } = useQuery({
    queryKey: ["billing-history"],
    queryFn: () =>
      apiGet<{ transactions: CreditTransaction[]; total: number }>(
        "/api/billing/credits/history?limit=20",
      ),
    staleTime: 30_000,
  })

  if (isLoading) return null

  const transactions = data?.transactions ?? []
  if (transactions.length === 0) return null

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">История операций</h2>
      <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-muted text-left">
              <th className="px-4 py-2 font-medium">Дата</th>
              <th className="px-4 py-2 font-medium">Операция</th>
              <th className="px-4 py-2 font-medium text-right">Токены</th>
              <th className="px-4 py-2 font-medium text-right">Баланс</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-b border-bg-border last:border-0">
                <td className="px-4 py-2 text-text-muted whitespace-nowrap">
                  {fmtDateTime(tx.created_at)}
                </td>
                <td className="px-4 py-2">
                  <span className="text-text-primary">
                    {tx.description || tx.operation || tx.type}
                  </span>
                  {tx.plugin_name && (
                    <span className="text-text-muted ml-1 text-xs">
                      ({tx.plugin_name.replace("mpflow-plugin-", "")})
                    </span>
                  )}
                </td>
                <td className={`px-4 py-2 text-right font-medium ${
                  tx.amount > 0 ? "text-inflow" : tx.type === "refund" ? "text-text-muted" : "text-outflow"
                }`}>
                  {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                </td>
                <td className="px-4 py-2 text-right text-text-secondary">
                  {tx.balance_after}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Operations Pricing ──

function OperationsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["billing-operations"],
    queryFn: () => apiGet<{ operations: PluginOps[] }>("/api/billing/operations"),
    staleTime: 60_000,
  })

  if (isLoading) return null

  const ops = data?.operations ?? []
  if (ops.length === 0) return null

  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">Тарифы на операции</h2>
      <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-muted text-left">
              <th className="px-4 py-2 font-medium">Плагин</th>
              <th className="px-4 py-2 font-medium">Операция</th>
              <th className="px-4 py-2 font-medium text-right">Токенов</th>
            </tr>
          </thead>
          <tbody>
            {ops.flatMap((plugin) =>
              plugin.operations.map((op) => (
                <tr key={`${plugin.plugin}-${op.name}`} className="border-b border-bg-border last:border-0">
                  <td className="px-4 py-2 text-text-secondary">{plugin.pluginLabel}</td>
                  <td className="px-4 py-2 text-text-primary">{op.description}</td>
                  <td className="px-4 py-2 text-right font-medium text-accent">{op.creditCost}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Billing Page ──

export default function BillingPage() {
  const { authMode } = useAuth()

  // Selfhosted: no billing
  if (authMode !== "logto") {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-text-primary mb-4">Биллинг</h1>
        <p className="text-sm text-text-muted">
          В self-hosted режиме биллинг не используется. Плагины работают с вашими собственными API ключами.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-text-primary mb-6">Биллинг</h1>
      <div className="space-y-8">
        <SubscriptionSection />
        <CreditBalanceSection />
        <UsageStatsSection />
        <HistorySection />
        <OperationsSection />
      </div>
    </div>
  )
}
