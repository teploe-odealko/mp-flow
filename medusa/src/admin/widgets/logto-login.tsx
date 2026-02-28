import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Spinner } from "@medusajs/icons"
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

type LogtoConfig = { endpoint: string; app_id: string }

/**
 * Full-screen login widget that uses @logto/browser SDK directly.
 * Replaces the built-in Medusa email/password form with Logto SSO.
 *
 * Flow:
 * 1. Fetch /auth/logto-config → { endpoint, app_id }
 * 2. Init LogtoClient (CDN import)
 * 3. If callback (URL has code+state) → handleSignInCallback → exchange → redirect
 * 4. If already authenticated → exchange → redirect
 * 5. Otherwise → signIn → redirect to Logto
 */
const LogtoLoginWidget = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("Загрузка...")
  const initiated = useRef(false)

  const run = useCallback(async () => {
    if (initiated.current) return
    initiated.current = true

    try {
      // 1. Fetch Logto config
      setStatus("Загрузка конфигурации...")
      const cfgRes = await fetch("/auth/logto-config")
      const cfg: LogtoConfig = await cfgRes.json()

      if (!cfg.app_id || !cfg.endpoint) {
        // Logto not configured — show default Medusa login form
        setError(null)
        setStatus("")
        initiated.current = false
        return
      }

      // 2. Init @logto/browser SDK (CDN import)
      setStatus("Инициализация...")
      const { default: LogtoClient } = await import(
        /* @vite-ignore */
        "https://cdn.jsdelivr.net/npm/@logto/browser@3/+esm"
      )

      const callbackUrl = `${window.location.origin}/app/login`
      const client = new LogtoClient({
        endpoint: cfg.endpoint,
        appId: cfg.app_id,
        scopes: ["openid", "profile", "email"],
      })

      // 3. Handle callback (Logto redirected back with code+state)
      const hasCode = searchParams.has("code") && searchParams.has("state")

      if (hasCode) {
        setStatus("Авторизация...")
        await client.handleSignInCallback(window.location.href)
        // Clean URL params
        window.history.replaceState(null, "", "/app/login")
      }

      // 4. Check if authenticated
      const isAuth = await client.isAuthenticated()

      if (isAuth) {
        setStatus("Создание сессии...")
        const token = await client.getAccessToken()

        const exchangeRes = await fetch("/auth/logto-exchange", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: token }),
        })

        if (!exchangeRes.ok) {
          const body = await exchangeRes.text()
          throw new Error(`Ошибка создания сессии (${exchangeRes.status}): ${body}`)
        }

        // Session cookie is now set — redirect to catalog
        navigate("/catalog", { replace: true })
        return
      }

      // 5. Not authenticated — redirect to Logto sign-in
      setStatus("Перенаправление...")
      await client.signIn(callbackUrl)
    } catch (e: any) {
      console.error("Logto login error:", e)
      setError(e.message || "Ошибка авторизации")
    }
  }, [navigate, searchParams])

  useEffect(() => {
    run()
  }, [run])

  // If no status — Logto not configured, don't cover the default form
  if (!status && !error) return null

  if (error) {
    return (
      <div className="bg-ui-bg-subtle fixed inset-0 z-50 flex flex-col items-center justify-center gap-4">
        <p className="text-ui-fg-subtle text-sm">{error}</p>
        <button
          onClick={() => {
            setError(null)
            setStatus("Загрузка...")
            initiated.current = false
            run()
          }}
          className="text-ui-fg-interactive text-sm underline"
        >
          Попробовать снова
        </button>
      </div>
    )
  }

  return (
    <div className="bg-ui-bg-subtle fixed inset-0 z-50 flex flex-col items-center justify-center gap-4">
      <Spinner className="text-ui-fg-subtle animate-spin" />
      <p className="text-ui-fg-subtle text-sm">{status}</p>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LogtoLoginWidget
