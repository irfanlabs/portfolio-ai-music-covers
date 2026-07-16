/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { hasValidSupabaseEnv } from '../lib/env'
import { supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  isReady: boolean
  error: string | null
  retry: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true

    const initialize = async () => {
      setError(null)
      setIsReady(false)
      if (!hasValidSupabaseEnv) {
        setError('Supabase is not configured. Add the VITE_SUPABASE values.')
        setIsReady(true)
        return
      }

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (!active) return

      if (sessionError) {
        setError(sessionError.message)
        setIsReady(true)
        return
      }

      if (data.session) {
        setSession(data.session)
        setIsReady(true)
        return
      }

      const { data: anonymousData, error: anonymousError } =
        await supabase.auth.signInAnonymously()
      if (!active) return
      setSession(anonymousData.session)
      setError(anonymousError?.message ?? null)
      setIsReady(true)
    }

    void initialize()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [attempt])

  const value = useMemo(
    () => ({
      session,
      isReady,
      error,
      retry: () => setAttempt((value) => value + 1),
    }),
    [session, isReady, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
