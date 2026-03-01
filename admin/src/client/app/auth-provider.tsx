import React, { createContext, useContext, useEffect, useState, useRef } from "react"
import LogtoClient from "@logto/browser"

interface User {
  id: string
  email: string
  name?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const logtoRef = useRef<LogtoClient | null>(null)

  useEffect(() => {
    initAuth()
  }, [])

  async function initAuth() {
    try {
      // First check if we already have a session
      const meRes = await fetch("/auth/me", { credentials: "include" })
      const meData = await meRes.json()
      if (meData.user) {
        setUser(meData.user)
        setLoading(false)
        return
      }

      // No session — init Logto client
      const configRes = await fetch("/auth/logto-config")
      const config = await configRes.json()
      if (!config.endpoint || !config.app_id) {
        console.error("[auth] Missing Logto config")
        setLoading(false)
        return
      }

      const logto = new LogtoClient({
        endpoint: config.endpoint,
        appId: config.app_id,
      })
      logtoRef.current = logto

      // Check if this is an OAuth callback (URL has code + state params)
      const url = new URL(window.location.href)
      if (url.searchParams.has("code") && url.searchParams.has("state")) {
        try {
          await logto.handleSignInCallback(window.location.href)
          // Clean URL
          window.history.replaceState({}, "", url.pathname)
        } catch (err) {
          console.error("[auth] Callback handling failed:", err)
        }
      }

      // Check if Logto has a valid session
      const isAuthed = await logto.isAuthenticated()
      if (isAuthed) {
        try {
          const accessToken = await logto.getAccessToken()
          // Exchange Logto token for our server session
          const exchangeRes = await fetch("/auth/logto-exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ access_token: accessToken }),
          })
          const exchangeData = await exchangeRes.json()
          if (exchangeData.user) {
            setUser(exchangeData.user)
          }
        } catch (err) {
          console.error("[auth] Token exchange failed:", err)
        }
      }
    } catch (err) {
      console.error("[auth] Init failed:", err)
    } finally {
      setLoading(false)
    }
  }

  async function login() {
    try {
      if (!logtoRef.current) {
        const configRes = await fetch("/auth/logto-config")
        const config = await configRes.json()
        logtoRef.current = new LogtoClient({
          endpoint: config.endpoint,
          appId: config.app_id,
        })
      }
      await logtoRef.current.signIn(window.location.origin + "/callback")
    } catch (err) {
      console.error("[auth] Login failed:", err)
    }
  }

  async function logout() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" })
      if (logtoRef.current) {
        await logtoRef.current.signOut(window.location.origin)
      }
      setUser(null)
    } catch {
      setUser(null)
      window.location.href = "/"
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
