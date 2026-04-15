'use client'

import { useReveal } from './RevealProvider'

interface MaskedFieldProps {
  value: string | null | undefined
  // How to render the value once unlocked. Defaults to plain text.
  // Use 'mailto' to render as <a href="mailto:..."> / 'tel' for phones.
  as?: 'text' | 'mailto' | 'tel'
  // Shown when value is null/empty even after unlock.
  emptyFallback?: string
  className?: string
}

/**
 * Renders `••••••••` with a Show button by default. After the user unlocks
 * the session via the reveal modal, shows the real value. If `value` is null
 * or empty, renders the empty fallback regardless of lock state.
 */
export default function MaskedField({
  value,
  as = 'text',
  emptyFallback = '—',
  className = '',
}: MaskedFieldProps) {
  const { unlocked, requestUnlock } = useReveal()

  if (!value) {
    return <span className={className}>{emptyFallback}</span>
  }

  if (!unlocked) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <span className="font-mono text-gray-400 tracking-wider select-none">••••••••</span>
        <button
          type="button"
          onClick={() => requestUnlock()}
          className="text-xs text-blue-600 hover:underline"
        >
          Show
        </button>
      </span>
    )
  }

  if (as === 'mailto') {
    return (
      <a href={`mailto:${value}`} className={`text-blue-600 hover:underline ${className}`}>
        {value}
      </a>
    )
  }
  if (as === 'tel') {
    return (
      <a href={`tel:${value}`} className={`text-blue-600 hover:underline ${className}`}>
        {value}
      </a>
    )
  }
  return <span className={className}>{value}</span>
}
