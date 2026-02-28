import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Spinner } from "@medusajs/icons"
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

const AUTH_PROVIDER = "logto"

function getSdk(): any {
  return (window as any).__sdk
}

function decodeJwtPayload(token: string): any {
  try {
    const payload = token.split(".")[1]
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

const LogtoLoginWidget = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const isCallback =
    searchParams.get("auth_provider") === AUTH_PROVIDER &&
    searchParams.has("code")

  // If Logto returned an error, or our callback failed — show error
  const hasError =
    searchParams.has("error") ||
    searchParams.get("login_error") === "1"

  const { handleLogin } = useLogtoLogin(setError)
  const { handleCallback } = useLogtoCallback(searchParams)

  const actionInitiated = useRef(false)
  useEffect(() => {
    if (actionInitiated.current) return
    if (hasError) return // Don't auto-redirect if there was an error

    if (isCallback) {
      actionInitiated.current = true
      handleCallback()
    } else {
      actionInitiated.current = true
      handleLogin()
    }
  }, [isCallback, hasError, handleCallback, handleLogin])

  if (error || hasError) {
    return (
      <div className="bg-ui-bg-subtle fixed inset-0 z-50 flex flex-col items-center justify-center gap-4">
        <p className="text-ui-fg-subtle text-sm">
          {error || "Ошибка авторизации"}
        </p>
        <button
          onClick={() => {
            setError(null)
            actionInitiated.current = false
            // Clear error params from URL
            setSearchParams({})
          }}
          className="text-ui-fg-interactive text-sm underline"
        >
          Попробовать снова
        </button>
      </div>
    )
  }

  // Full-screen spinner — covers the built-in email/password form
  return (
    <div className="bg-ui-bg-subtle fixed inset-0 z-50 flex flex-col items-center justify-center gap-4">
      <Spinner className="text-ui-fg-subtle animate-spin" />
      <p className="text-ui-fg-subtle text-sm">
        {isCallback ? "Авторизация..." : "Перенаправление..."}
      </p>
    </div>
  )
}

function useLogtoLogin(setError: (e: string | null) => void) {
  const [isPending, setIsPending] = useState(false)

  const handleLogin = useCallback(async () => {
    setIsPending(true)
    try {
      const sdk = getSdk()
      const result = await sdk.auth.login("user", AUTH_PROVIDER, {
        callback_url: `${window.location.origin}/app/login?auth_provider=${AUTH_PROVIDER}`,
      })

      if (typeof result === "object" && result.location) {
        window.location.href = result.location
        return
      }

      throw new Error("Unexpected login response")
    } catch (e: any) {
      console.error("Logto login error:", e)
      setError("Ошибка подключения к серверу авторизации")
    }
    setIsPending(false)
  }, [setError])

  return { handleLogin, isLoginPending: isPending }
}

function useLogtoCallback(searchParams: URLSearchParams) {
  const navigate = useNavigate()
  const [isPending, setIsPending] = useState(false)

  const handleCallback = useCallback(async () => {
    setIsPending(true)
    try {
      const sdk = getSdk()

      const query = Object.fromEntries(searchParams)
      delete query.auth_provider
      const token = await sdk.auth.callback("user", AUTH_PROVIDER, query)

      const decoded = decodeJwtPayload(token)

      if (!decoded?.actor_id) {
        // First login — create admin user
        const res = await fetch("/admin/auth/create-user", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        })

        if (!res.ok) {
          const body = await res.text()
          console.error("create-user failed:", res.status, body)
          throw new Error(`Не удалось создать пользователя (${res.status})`)
        }

        // Refresh token to get actor_id populated
        await sdk.auth.refresh({
          Authorization: `Bearer ${token}`,
        })
      }

      navigate("/app/catalog", { replace: true })
    } catch (e: any) {
      console.error("Logto callback error:", e)
      // Navigate with error flag — prevents auto-redirect loop
      navigate("/app/login?login_error=1", { replace: true })
    }
    setIsPending(false)
  }, [searchParams, navigate])

  return { handleCallback, isCallbackPending: isPending }
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LogtoLoginWidget
