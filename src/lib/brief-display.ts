/**
 * Client-side display helpers for the Daily Brief tab.
 *
 * Category detection is derived at read time from the stored headline /
 * so_what / relevance_tag fields so we don't need a DB migration or a
 * schema change — the same regexes used by the pipeline's signal-boost
 * logic power this. Categories influence card color, icon, and the
 * Morning-Brew-style "3 funding rounds, 1 regulatory update" summary line.
 */

export type Category =
  | 'Funding'
  | 'M&A'
  | 'Regulatory'
  | 'Exec Move'
  | 'Partnership'
  | 'Product Launch'
  | 'Thought Leadership'

const CATEGORY_RULES: { category: Category; pattern: RegExp }[] = [
  {
    category: 'Funding',
    pattern:
      /\brais(?:es?|ed|ing)\b|\bseries\s+[a-hA-H]\b|\$\d+\s*(?:m\b|million|bn\b|billion|b\b)|\bfund(?:raise|raising)\b|\bclose[sd]?\b.*\bround\b|\bsecures?\b.*\$/i,
  },
  {
    category: 'M&A',
    pattern:
      /\bacquir(?:e[sd]?|ing)\b|\bacquisition\b|\bmerger\b|\bmerge[sd]?\b|\bbuyout\b|\btakeover\b/i,
  },
  {
    category: 'Regulatory',
    pattern:
      /\bFDA\b|\bCMS\b|\bregulat(?:or|ory|ion|ed|e[sd]?)\b|\bapprov(?:al|e[sd]?|es|ing)\b|\bclearance\b|\bguidance\b|\brule\b|\blawsuit\b|\bsettle(?:s|d|ment)\b/i,
  },
  {
    category: 'Exec Move',
    pattern:
      /\bCEO\b|\bCTO\b|\bCOO\b|\bCFO\b|\bchief\s+[a-z]+\s+officer\b|\bappoint(?:s|ed|ment)\b|\bhires?\b.*\b(?:VP|SVP|President|Chief)\b|\bnames?\b.*\b(?:CEO|CTO|COO|CFO)\b|\bresign(?:s|ed|ation)\b|\bsteps?\s+down\b/i,
  },
  {
    category: 'Partnership',
    pattern:
      /\bpartners?(?:hip|ed|ing)?\b|\bjoint\s+venture\b|\bcollaborat(?:e|ion|ing|ed|es)\b|\bteams?\s+up\b|\balliance\b/i,
  },
  {
    category: 'Product Launch',
    pattern:
      /\blaunch(?:es|ed|ing)?\b|\bdebuts?\b|\bunveil(?:s|ed|ing)?\b|\brolls?\s+out\b|\bemerges?\s+from\s+stealth\b|\brelease[sd]?\b/i,
  },
]

export function categorize(input: {
  headline: string
  so_what?: string | null
  relevance_tag?: string | null
}): Category {
  const haystack = `${input.headline} ${input.so_what || ''} ${input.relevance_tag || ''}`
  for (const { category, pattern } of CATEGORY_RULES) {
    if (pattern.test(haystack)) return category
  }
  return 'Thought Leadership'
}

/** Visual styling per category — kept together so a palette tweak is one-stop. */
export const CATEGORY_STYLES: Record<
  Category,
  { pill: string; accent: string; icon: string; label: string }
> = {
  Funding: {
    pill: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    accent: 'border-l-emerald-500',
    icon: '💰',
    label: 'Funding',
  },
  'M&A': {
    pill: 'bg-teal-100 text-teal-800 border border-teal-200',
    accent: 'border-l-teal-500',
    icon: '🤝',
    label: 'M&A',
  },
  Regulatory: {
    pill: 'bg-red-100 text-red-800 border border-red-200',
    accent: 'border-l-red-500',
    icon: '⚖️',
    label: 'Regulatory',
  },
  'Exec Move': {
    pill: 'bg-amber-100 text-amber-800 border border-amber-200',
    accent: 'border-l-amber-500',
    icon: '👔',
    label: 'Exec Move',
  },
  Partnership: {
    pill: 'bg-purple-100 text-purple-800 border border-purple-200',
    accent: 'border-l-purple-500',
    icon: '🔗',
    label: 'Partnership',
  },
  'Product Launch': {
    pill: 'bg-sky-100 text-sky-800 border border-sky-200',
    accent: 'border-l-sky-500',
    icon: '🚀',
    label: 'Product Launch',
  },
  'Thought Leadership': {
    pill: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
    accent: 'border-l-indigo-500',
    icon: '💡',
    label: 'Thought Leadership',
  },
}

/** Build the "3 funding rounds, 1 regulatory update, 2 thought pieces" summary. */
export function buildDailySummary(items: { category: Category }[]): string {
  if (items.length === 0) return ''
  const counts = new Map<Category, number>()
  for (const i of items) {
    counts.set(i.category, (counts.get(i.category) || 0) + 1)
  }
  const phrase = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`
  const parts: string[] = []
  const order: { cat: Category; singular: string; plural: string }[] = [
    { cat: 'Funding', singular: 'funding round', plural: 'funding rounds' },
    { cat: 'M&A', singular: 'M&A deal', plural: 'M&A deals' },
    { cat: 'Regulatory', singular: 'regulatory update', plural: 'regulatory updates' },
    { cat: 'Exec Move', singular: 'exec move', plural: 'exec moves' },
    { cat: 'Partnership', singular: 'partnership', plural: 'partnerships' },
    { cat: 'Product Launch', singular: 'launch', plural: 'launches' },
    { cat: 'Thought Leadership', singular: 'thought piece', plural: 'thought pieces' },
  ]
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

/** Deterministic color for an avatar based on a name hash. */
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
