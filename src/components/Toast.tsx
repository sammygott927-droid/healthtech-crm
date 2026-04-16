'use client'

import { useEffect } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

interface Props {
  message: string
  variant?: ToastVariant
  onDismiss: () => void
  /** Auto-dismiss after this many ms. 0 disables auto-dismiss. */
  durationMs?: number
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-blue-600 text-white',
}

/**
 * Lightweight floating toast pinned to the bottom-right of the viewport.
 * Used for confirming background actions (e.g. "Sector updated to: …").
 */
export default function Toast({
  message,
  variant = 'success',
  onDismiss,
  durationMs = 2000,
}: Props) {
  useEffect(() => {
    if (durationMs <= 0) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [durationMs, onDismiss])

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
      <div
        className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${VARIANT_STYLES[variant]} animate-fade-in`}
        role="status"
      >
        {message}
      </div>
    </div>
  )
}
