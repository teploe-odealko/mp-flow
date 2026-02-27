import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

const AUTH_PROVIDER = "logto"

// Access the dashboard's pre-initialized Medusa SDK
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
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const isCallback =
    searchParams.get("auth_provider") === AUTH_PROVIDER &&
    (searchParams.has("code") || searchParams.has("error"))

  const { handleLogin, isLoginPending } = useLogtoLogin()
  const { handleCallback, isCallbackPending } = useLogtoCallback(searchParams)

  const actionInitiated = useRef(false)
  useEffect(() => {
    if (actionInitiated.current) return
    if (isCallback) {
      actionInitiated.current = true
      handleCallback()
    }
  }, [isCallback, handleCallback])

  // Show full-screen spinner during callback processing
  if (isCallback) {
    return (
      <div className="bg-ui-bg-subtle fixed inset-0 z-50 flex items-center justify-center">
        <Spinner className="text-ui-fg-subtle animate-spin" />
      </div>
    )
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={handleLogin}
        className="w-full"
        disabled={isLoginPending || isCallbackPending}
        isLoading={isLoginPending || isCallbackPending}
      >
        Войти через MPFlow
      </Button>
      <hr className="bg-ui-border-base my-1" />
    </>
  )
}

function useLogtoLogin() {
  const navigate = useNavigate()
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
      navigate("/login")
    }
    setIsPending(false)
  }, [navigate])

  return { handleLogin, isLoginPending: isPending }
}

function useLogtoCallback(searchParams: URLSearchParams) {
  const navigate = useNavigate()
  const [isPending, setIsPending] = useState(false)

  const handleCallback = useCallback(async () => {
    setIsPending(true)
    try {
      const sdk = getSdk()

      // Exchange code for token
      const query = Object.fromEntries(searchParams)
      delete query.auth_provider
      const token = await sdk.auth.callback("user", AUTH_PROVIDER, query)

      // Decode token to check if user exists
      const decoded = decodeJwtPayload(token)

      if (!decoded?.actor_id) {
        // First login — create user
        await fetch("/admin/auth/create-user", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        })

        // Refresh token to get actor_id populated
        await sdk.auth.refresh({
          Authorization: `Bearer ${token}`,
        })
      }

      navigate("/app/catalog", { replace: true })
    } catch (e: any) {
      console.error("Logto callback error:", e)
      navigate("/login")
    }
    setIsPending(false)
  }, [searchParams, navigate])

  return { handleCallback, isCallbackPending: isPending }
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LogtoLoginWidget
