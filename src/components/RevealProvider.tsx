'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// Session-only PII reveal. Flag lives in sessionStorage so closing the tab
// re-locks all emails/phones. Check happens server-side against REVEAL_PASSWORD.

const SESSION_KEY = 'crm_reveal_unlocked'

interface RevealContextValue {
  unlocked: boolean
  requestUnlock: () => Promise<boolean>
  lock: () => void
}

const RevealContext = createContext<RevealContextValue | null>(null)

export function useReveal(): RevealContextValue {
  const ctx = useContext(RevealContext)
  if (!ctx) throw new Error('useReveal must be used inside <RevealProvider>')
  return ctx
}

export default function RevealProvider({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Resolver for the current requestUnlock() call; we resolve it when the
  // modal closes (either by success or cancel).
  const pendingResolver = useRef<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(SESSION_KEY) === '1') setUnlocked(true)
  }, [])

  const lock = useCallback(() => {
    setUnlocked(false)
    if (typeof window !== 'undefined') sessionStorage.removeItem(SESSION_KEY)
  }, [])

  const requestUnlock = useCallback((): Promise<boolean> => {
    if (unlocked) return Promise.resolve(true)
    setPassword('')
    setError('')
    setModalOpen(true)
    return new Promise<boolean>((resolve) => {
      pendingResolver.current = resolve
    })
  }, [unlocked])

  function resolvePending(ok: boolean) {
    setModalOpen(false)
    setPassword('')
    setSubmitting(false)
    if (pendingResolver.current) {
      pendingResolver.current(ok)
      pendingResolver.current = null
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/reveal-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Incorrect password')
        setSubmitting(false)
        return
      }
      setUnlocked(true)
      if (typeof window !== 'undefined') sessionStorage.setItem(SESSION_KEY, '1')
      resolvePending(true)
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  return (
    <RevealContext.Provider value={{ unlocked, requestUnlock, lock }}>
      {children}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => resolvePending(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg border border-gray-200 p-6 w-full max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Reveal contact info</h3>
            <p className="text-xs text-gray-500 mb-4">
              Enter the reveal password to show emails and phone numbers for this session.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => resolvePending(false)}
                  className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Checking...' : 'Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </RevealContext.Provider>
  )
}
