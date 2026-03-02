import { useAuth } from "../app/auth-provider"

export function Paywall() {
  const { logout, subscription } = useAuth()

  const daysText = subscription?.activeUntil
    ? (() => {
        const until = new Date(subscription.activeUntil)
        const now = new Date()
        const diff = Math.ceil((until.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        if (diff > 0) return `Осталось ${diff} дн.`
        return "Срок истёк"
      })()
    : null

  return (
    <div className="flex items-center justify-center h-screen bg-bg-deep text-text-primary">
      <div className="bg-bg-surface border border-bg-border rounded-2xl p-8 max-w-md w-full mx-4 text-center">
        <div className="w-16 h-16 rounded-xl bg-accent/20 flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold mb-2">Подписка неактивна</h2>
        <p className="text-text-secondary text-sm mb-1">
          Ваш пробный период завершился.
        </p>
        <p className="text-text-secondary text-sm mb-6">
          Для продолжения работы оформите подписку.
        </p>

        {daysText && (
          <p className="text-text-muted text-xs mb-4">{daysText}</p>
        )}

        <div className="bg-bg-elevated rounded-xl p-4 mb-6">
          <p className="text-2xl font-bold text-accent mb-1">300 ₽/мес</p>
          <p className="text-text-muted text-xs">Полный доступ ко всем функциям</p>
        </div>

        <a
          href="https://t.me/teploe_odealko"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-medium mb-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
          </svg>
          Написать для оплаты
        </a>

        <button
          onClick={logout}
          className="text-text-muted hover:text-text-secondary text-sm transition-colors"
        >
          Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}
