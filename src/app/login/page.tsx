'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    setError('')

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      // Hard nav so the proxy re-evaluates and returns the real page
      window.location.href = next.startsWith('/') ? next : '/'
      return
    }

    const data = await res.json().catch(() => ({}))
    setError(data.error || 'Incorrect password')
    setSubmitting(false)
    // Don't give router a path here — we only redirect on success
    void router
  }

  return (
    // Fixed / z-50 covers the sidebar from the root layout. Keeps the login
    // screen full-bleed without introducing a separate route group.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">In the Loop</h1>
        <p className="text-sm text-gray-500 mb-6">Enter password to continue.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Checking...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100" />}>
      <LoginForm />
    </Suspense>
  )
}
