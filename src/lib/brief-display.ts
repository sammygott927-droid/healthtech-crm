/**
 * Display helpers for the Command Center Daily Brief tab.
 *
 * The pipeline now asks Claude to tag each article with one of five
 * categories (funding / partnership / market_news / thought_leadership /
 * regulatory) during scoring; that value lives in daily_briefs.category.
 *
 * For historical rows stored before the migration, `fallbackCategorize`
 * assigns one of the same five buckets from the headline + so_what +
 * relevance_tag — so the grouped UI works everywhere without a backfill.
 */

export type Category =
  | 'funding'
  | 'partnership'
  | 'market_news'
  | 'thought_leadership'
  | 'regulatory'

// Order the Brief tab renders them (empty groups are skipped at render time).
export const CATEGORY_ORDER: Category[] = [
  'funding',
  'partnership',
  'market_news',
  'thought_leadership',
  'regulatory',
]

interface CategoryStyle {
  label: string
  /** Tailwind text-color for the small icon dot + section heading icon. */
  iconColor: string
  /** Tailwind bg-color for the small filled icon dot. */
  iconBg: string
  /** Tailwind bg-color for the category count badge. */
  countBg: string
  countText: string
}

export const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  funding: {
    label: 'Funding',
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-500',
    countBg: 'bg-emerald-50',
    countText: 'text-emerald-700',
  },
  partnership: {
    label: 'Partnerships',
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-500',
    countBg: 'bg-purple-50',
    countText: 'text-purple-700',
  },
  market_news: {
    label: 'Market news',
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-500',
    countBg: 'bg-amber-50',
    countText: 'text-amber-800',
  },
  thought_leadership: {
    label: 'Thought leadership',
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-500',
    countBg: 'bg-blue-50',
    countText: 'text-blue-700',
  },
  regulatory: {
    label: 'Regulatory',
    iconColor: 'text-red-600',
    iconBg: 'bg-red-500',
    countBg: 'bg-red-50',
    countText: 'text-red-700',
  },
}

const FUNDING_RE =
  /\brais(?:es?|ed|ing)\b|\bseries\s+[a-hA-H]\b|\$\d+\s*(?:m\b|million|bn\b|billion|b\b)|\bfund(?:raise|raising)\b|\bclose[sd]?\b.*\bround\b|\bsecures?\b.*\$|\bseed\s+round\b|\bpre-seed\b|\bvalu(?:ation|ed)\s+at\b/i
const PARTNERSHIP_RE =
  /\bpartners?(?:hip|ed|ing)?\b|\bjoint\s+venture\b|\bcollaborat(?:e|ion|ing|ed|es)\b|\bteams?\s+up\b|\balliance\b|\bagreement\b|\bdistributing?\b|\bcontract\s+with\b/i
const REGULATORY_RE =
  /\bFDA\b|\bCMS\b|\bregulat(?:or|ory|ion|ed|e[sd]?)\b|\bapprov(?:al|e[sd]?|es|ing)\b|\bclearance\b|\bguidance\b|\bHIPAA\b|\bHHS\b|\blawsuit\b|\bsettle(?:s|d|ment)\b|\bpolicy\b|\bprior\s+auth/i
const THOUGHT_LEADERSHIP_RE =
  /\banalysis\b|\bopinion\b|\beditorial\b|\bessay\b|\bresearch\s+report\b|\bwhite\s+paper\b|\bperspective\b|\bdeep\s+dive\b|\binterview\b|\bpodcast\b|\bQ&A\b/i

/**
 * Keyword-based categorizer used when Claude didn't stamp a category
 * (pre-migration rows). Order matters — specific categories before the
 * generic market_news default.
 */
export function fallbackCategorize(input: {
  headline: string
  so_what?: string | null
  relevance_tag?: string | null
}): Category {
  const haystack = `${input.headline} ${input.so_what || ''} ${input.relevance_tag || ''}`
  if (REGULATORY_RE.test(haystack)) return 'regulatory'
  if (FUNDING_RE.test(haystack)) return 'funding'
  if (PARTNERSHIP_RE.test(haystack)) return 'partnership'
  if (THOUGHT_LEADERSHIP_RE.test(haystack)) return 'thought_leadership'
  return 'market_news'
}

/** Normalize a stored category (may be null/invalid) to one of the 5 buckets. */
export function resolveCategory(
  stored: string | null | undefined,
  input: {
    headline: string
    so_what?: string | null
    relevance_tag?: string | null
  }
): Category {
  const normalized = typeof stored === 'string' ? stored.trim().toLowerCase() : ''
  if (CATEGORY_ORDER.includes(normalized as Category)) {
    return normalized as Category
  }
  return fallbackCategorize(input)
}

/** "3 funding rounds, 1 regulatory update, 2 thought pieces" header summary. */
export function buildDailySummary(items: { category: Category }[]): string {
  if (items.length === 0) return ''
  const counts = new Map<Category, number>()
  for (const i of items) counts.set(i.category, (counts.get(i.category) || 0) + 1)

  const phrase = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`

  const order: { cat: Category; singular: string; plural: string }[] = [
    { cat: 'funding', singular: 'funding round', plural: 'funding rounds' },
    { cat: 'partnership', singular: 'partnership', plural: 'partnerships' },
    { cat: 'regulatory', singular: 'regulatory update', plural: 'regulatory updates' },
    { cat: 'thought_leadership', singular: 'thought piece', plural: 'thought pieces' },
    { cat: 'market_news', singular: 'market story', plural: 'market stories' },
  ]

  const parts: string[] = []
  for (const { cat, singular, plural } of order) {
    const n = counts.get(cat) || 0
    if (n > 0) parts.push(phrase(n, singular, plural))
  }
  return parts.join(', ')
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Avatar helpers (used by the Daily Actions tab)
const AVATAR_PALETTE = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function avatarInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function avatarColorClass(name: string): string {
  const idx = hashString(name || '?') % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}
