/**
 * Shared visual tokens so status badges, tag pills, and card chrome stay
 * consistent across every page (Task 15 visual polish pass).
 *
 * Put any future "this needs to look the same everywhere" helper here
 * instead of inlining Tailwind strings.
 */

/**
 * Contact status → badge classes. Active pops vibrant green, Warm is
 * amber, Cold is blue, Dormant is muted grey.
 */
export function statusBadgeClasses(status: string | null | undefined): string {
  const s = (status || '').toLowerCase()
  if (s === 'active') return 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-200'
  if (s === 'warm') return 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200'
  if (s === 'cold') return 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200'
  if (s === 'dormant') return 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200'
  return 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200'
}

export const BADGE_BASE =
  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold'

export const BADGE_UPPER =
  'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide'

/**
 * Tag pill — used on contact tags, contact-row tag chips, new-contact
 * suggested tags, etc. Consistent purple palette + sizing.
 */
export const TAG_PILL =
  'inline-flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-0.5 rounded-full text-xs font-medium'

/** Standard card shell — shadow-sm by default, hover:shadow-md for list items. */
export const CARD =
  'bg-white rounded-xl shadow-sm border border-gray-200'

export const CARD_HOVER =
  'bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all'

/** Page-level heading (h1) — same on every page. */
export const H1 = 'text-3xl font-bold tracking-tight text-gray-900'

/** Section heading inside a page (h2 / card header). */
export const H2 = 'text-lg font-semibold text-gray-900'
