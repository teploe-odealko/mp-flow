import React, { createContext, useContext, useEffect, useState } from "react"

interface User {
  id: string
  email: string
  name?: string
}

type AuthMode = "logto" | "selfhosted" | "dev"

interface SubscriptionInfo {
  active: boolean
  activeUntil: string | null
}

interface AuthContextType {
  user: User | null
  loading: boolean
  authMode: AuthMode | null
  needsSetup: boolean
  subscription: SubscriptionInfo | null
  login: () => void
  logout: () => void
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  authMode: null,
  needsSetup: false,
  subscription: null,
  login: () => {},
  logout: () => {},
  setUser: () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/auth/me", { credentials: "include" }).then((r) => r.json()),
      fetch("/auth/mode", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([meData, modeData]) => {
        setUser(meData.user || null)
        setAuthMode(modeData.mode || "selfhosted")
        setNeedsSetup(modeData.needsSetup || false)
        setSubscription(meData.subscription || null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function login() {
    // For Logto: redirect to server-side login
    window.location.href = "/auth/login"
  }

  function logout() {
    fetch("/auth/logout", { method: "POST", credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setUser(null)
        // Logto mode: redirect to Logto end-session to clear OIDC session
        window.location.href = data.logoutUrl || "/"
      })
      .catch(() => {
        setUser(null)
        window.location.href = "/"
      })
  }

  return (
    <AuthContext.Provider value={{ user, loading, authMode, needsSetup, subscription, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
