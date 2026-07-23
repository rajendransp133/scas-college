"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  apiPost,
  clearToken,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "@/lib/api"
import type { User } from "@/lib/types"

interface LoginResponse {
  accessToken: string
  tokenType: string
  user: User
}

interface AuthContextValue {
  /** Current JWT, or null when signed out. */
  token: string | null
  /** True once the token has been read from localStorage (avoids a login flash). */
  initialized: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Owns the JWT session. The token lives in localStorage (`scas-erp-token`);
 * a 401 from any request clears it (via the api layer's unauthorized handler),
 * which drops the user back to the login screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setTok] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  // Read the persisted token after mount (localStorage isn't available on the server).
  useEffect(() => {
    setTok(getToken())
    setInitialized(true)
  }, [])

  // Wire up the api layer so a 401 anywhere ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setTok(null)
      queryClient.clear()
    })
    return () => setUnauthorizedHandler(null)
  }, [queryClient])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiPost<LoginResponse>("/auth/login", { email, password })
      setToken(res.accessToken)
      queryClient.clear() // fresh cache for the new identity
      setTok(res.accessToken)
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout")
    } catch {
      // stateless JWT — logout is best-effort
    }
    clearToken()
    setTok(null)
    queryClient.clear()
  }, [queryClient])

  return (
    <AuthContext.Provider value={{ token, initialized, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuthSession must be used within <AuthProvider>")
  return ctx
}
