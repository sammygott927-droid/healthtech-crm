'use client'

interface MaskedFieldProps {
  value: string | null | undefined
  // How to render the value. Defaults to plain text.
  // Use 'mailto' to render as <a href="mailto:..."> / 'tel' for phones.
  as?: 'text' | 'mailto' | 'tel'
  // Shown when value is null/empty.
  emptyFallback?: string
  className?: string
}

/**
 * DEMO BRANCH OVERRIDE.
 *
 * Production (`main`) version of this component renders `••••••••` plus a
 * "Show" button until the user unlocks the session via the reveal modal
 * (gated server-side by REVEAL_PASSWORD). That makes sense for production
 * where the email/phone columns hold real PII.
 *
 * On the demo branch every contact's email is the synthetic
 * firstname.lastname@example.com address from the curated name pool —
 * there is nothing to protect, and the Show-then-modal friction gets in
 * the way of a professor reviewing the demo. So we no-op the gate here:
 * always render the value plainly.
 *
 * The RevealProvider and /api/reveal-check route are intentionally left
 * intact so the Sidebar's lock-and-logout flow (which also uses
 * useReveal) keeps working, and any future cherry-pick between branches
 * doesn't cascade across multiple files.
 */
export default function MaskedField({
  value,
  as = 'text',
  emptyFallback = '—',
  className = '',
}: MaskedFieldProps) {
  if (!value) {
    return <span className={className}>{emptyFallback}</span>
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
