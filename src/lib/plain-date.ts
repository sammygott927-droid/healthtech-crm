/**
 * Plain date helpers — for `last_contact_date`, `next_step_date`, and any
 * other Postgres `date` column that has no time component.
 *
 * The bug this fixes: a value like "2026-01-13" parsed via `new Date(s)`
 * is interpreted as UTC midnight (per the JS spec for ISO date-only
 * strings). When `.toLocaleDateString()` is called in any negative-offset
 * timezone (US: PST/EST/CST/MST), it converts UTC midnight back to local
 * time — which is the previous day. So Jan 13 picked in PST renders as
 * Jan 12.
 *
 * The fix: never let `new Date("YYYY-MM-DD")` happen. Parse the components
 * by hand and construct the Date with the local-time constructor signature
 * `new Date(year, monthIndex, day)`, which produces local midnight on that
 * calendar date regardless of timezone.
 */

/** Parse "YYYY-MM-DD" as a LOCAL-time Date at midnight. */
export function parsePlainDate(s: string | null | undefined): Date | null {
  if (!s || typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!year || !month || !day) return null
  const dt = new Date(year, month - 1, day)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/**
 * Format a "YYYY-MM-DD" plain date for display, with NO timezone shift.
 * Returns the fallback string when the input is null/empty/unparseable.
 */
export function formatPlainDate(
  s: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
  fallback = '—'
): string {
  if (!s) return fallback
  const dt = parsePlainDate(s)
  if (!dt) return s // raw passthrough if it's some unexpected shape
  return dt.toLocaleDateString('en-US', opts)
}

/**
 * Today's calendar date, in the user's local timezone, as a plain date
 * (midnight local). Used for follow-up cadence math so "is this overdue?"
 * compares apples to apples.
 */
export function todayLocal(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Calendar-day diff between two LOCAL midnight dates (b − a). */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)
}
