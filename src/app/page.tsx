'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  resolveCategory,
  CATEGORY_STYLES,
  CATEGORY_ORDER,
  buildDailySummary,
  greeting,
  avatarInitials,
  avatarColorClass,
  type Category,
} from '@/lib/brief-display'

/* ── Interfaces matching the /api/briefs-today response ── */

interface BriefItem {
  id: string
  headline: string
  source_url: string | null
  source_name: string | null
  pub_date: string | null
  so_what: string | null
  relevance_tag: string | null
  relevance_score: number
  category: string | null
}

interface ActionItem {
  id: string
  headline: string
  source_url: string | null
  source_name: string | null
  so_what: string | null
  relevance_score: number
  contact_match_score: number
  contact_id: string | null
  contact_name: string | null
  contact_company: string | null
  contact_status: string | null
  contact_match_reason: string | null
  draft_email: string | null
  status: string
}

interface SourceStat {
  source: string
  fetched: number
  passed: number
  error: string | null
}

interface SourceDebug {
  per_source: SourceStat[]
  cutoff_iso?: string
  total_scored?: number
  brief_count?: number
  action_count?: number
  elapsed_seconds?: number
}

type Tab = 'brief' | 'actions'

const USER_FIRST_NAME = 'Sammy'

type CategorizedBriefItem = BriefItem & { category_resolved: Category }

export default function HomePage() {
  const [briefItems, setBriefItems] = useState<BriefItem[]>([])
  const [sourceDebug, setSourceDebug] = useState<SourceDebug | null>(null)
  const [showSourceDebug, setShowSourceDebug] = useState(false)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runningBrief, setRunningBrief] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('brief')
  const [briefError, setBriefError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Daily Actions tab no longer surfaces overdue/upcoming follow-ups —
      // those moved to /reconnect — so we only need the brief endpoint here.
      const briefsRes = await fetch('/api/briefs-today')
      const briefsData = await briefsRes.json()

      setBriefItems(briefsData.brief || [])
      setSourceDebug(briefsData.source_debug || null)
      setActionItems(briefsData.actions || [])
      setHasRun(briefsData.has_run || false)
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function runBrief() {
    setRunningBrief(true)
    setBriefError(null)
    try {
      const res = await fetch('/api/daily-brief', { method: 'POST' })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Brief returned ${res.status}: ${body}`)
      }
      await fetchData()
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Brief failed — check console')
    } finally {
      setRunningBrief(false)
    }
  }

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function toggleEmail(id: string) {
    setExpandedEmails((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function updateStatus(id: string, newStatus: 'Sent' | 'Dismissed') {
    await fetch(`/api/briefs-today/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setActionItems((prev) => prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)))
  }

  const statusColor = (s: string | null) => {
    if (s === 'Active') return 'bg-green-100 text-green-800'
    if (s === 'Warm') return 'bg-amber-100 text-amber-800'
    if (s === 'Cold') return 'bg-blue-100 text-blue-800'
    return 'bg-gray-100 text-gray-600'
  }

  const totalActions = actionItems.length

  // Resolve each brief item's category (stored first, keyword fallback
  // for rows from before the migration).
  const categorizedBrief = useMemo<CategorizedBriefItem[]>(
    () =>
      briefItems.map((item) => ({
        ...item,
        category_resolved: resolveCategory(item.category, {
          headline: item.headline,
          so_what: item.so_what,
          relevance_tag: item.relevance_tag,
        }),
      })),
    [briefItems]
  )

  const dailySummary = useMemo(
    () => buildDailySummary(categorizedBrief.map((i) => ({ category: i.category_resolved }))),
    [categorizedBrief]
  )

  // Group by category, preserving each category's internal relevance order.
  const groupedBrief = useMemo(() => {
    const groups: Record<Category, CategorizedBriefItem[]> = {
      funding: [],
      partnership: [],
      market_news: [],
      thought_leadership: [],
      regulatory: [],
    }
    for (const item of categorizedBrief) {
      groups[item.category_resolved].push(item)
    }
    return groups
  }, [categorizedBrief])

  const now = new Date()
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="p-8">
      <div className="w-full">
        {/* ═══════ Greeting header ═══════ */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-sm text-white px-8 py-7 mb-6 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">
              {greeting(now)}, {USER_FIRST_NAME}.
            </h1>
            <p className="text-sm text-blue-100 mt-1">{dateLine}</p>
            {dailySummary ? (
              <p className="text-base text-white/90 mt-3 max-w-3xl">
                Today: {dailySummary}.
              </p>
            ) : hasRun ? (
              <p className="text-base text-white/80 mt-3">
                Quiet day — nothing cleared the relevance bar.
              </p>
            ) : (
              <p className="text-base text-white/80 mt-3">
                No brief yet today. Click <span className="font-semibold">Run Brief Now</span> to generate.
              </p>
            )}
          </div>
          <button
            onClick={runBrief}
            disabled={runningBrief}
            className="bg-white text-blue-700 px-5 py-2.5 rounded-lg text-sm font-semibold shadow hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2 flex-shrink-0"
          >
            {runningBrief && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {runningBrief ? 'Running brief…' : hasRun ? 'Refresh Brief' : 'Run Brief Now'}
          </button>
        </div>

        {/* Error banner */}
        {briefError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
            <span className="text-red-500 text-sm font-medium flex-shrink-0">Error</span>
            <p className="text-sm text-red-700 flex-1">{briefError}</p>
            <button
              onClick={() => setBriefError(null)}
              className="text-red-400 hover:text-red-600 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* Running indicator */}
        {runningBrief && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
            Generating daily brief — this may take 1–2 minutes. Please keep this tab open.
          </div>
        )}

        {/* ═══════ Tabs ═══════ */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setTab('brief')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'brief'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Daily Brief
            {briefItems.length > 0 && (
              <span className="ml-2 inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                {briefItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('actions')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'actions'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Daily Actions
            {totalActions > 0 && (
              <span className="ml-2 inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                {totalActions}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading…</p>
        ) : tab === 'brief' ? (
          /* ═══════ DAILY BRIEF TAB — grouped newsletter layout ═══════ */
          <div className="w-full">
            {categorizedBrief.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center">
                <p className="text-sm text-gray-500">
                  {hasRun
                    ? 'No articles scored 6+ relevance today.'
                    : 'No brief yet today. Click "Run Brief Now" to generate.'}
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {CATEGORY_ORDER.map((cat) => {
                  const items = groupedBrief[cat]
                  if (items.length === 0) return null
                  return <CategorySection key={cat} category={cat} items={items} />
                })}
              </div>
            )}

            {/* Source debug (collapsible) */}
            {sourceDebug && sourceDebug.per_source && sourceDebug.per_source.length > 0 && (
              <div className="mt-10 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowSourceDebug((v) => !v)}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  {showSourceDebug ? '▼' : '▶'} Show source debug
                </button>
                {showSourceDebug && (
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-xs text-gray-700 space-y-1">
                    {sourceDebug.per_source.map((s) => (
                      <div key={s.source} className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{s.source}:</span>
                        {s.error ? (
                          <span className="text-red-600">
                            {s.fetched} fetched ({s.error})
                          </span>
                        ) : (
                          <span>
                            {s.fetched} fetched, {s.passed} passed
                          </span>
                        )}
                      </div>
                    ))}
                    {sourceDebug.cutoff_iso && (
                      <div className="text-gray-400 mt-2 pt-2 border-t border-gray-200">
                        Freshness cutoff: {formatDate(sourceDebug.cutoff_iso)} ·{' '}
                        {sourceDebug.total_scored ?? '?'} scored by Claude ·{' '}
                        {sourceDebug.brief_count ?? '?'} in brief ·{' '}
                        {sourceDebug.action_count ?? '?'} actions ·{' '}
                        pipeline took {sourceDebug.elapsed_seconds ?? '?'}s
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ═══════ DAILY ACTIONS TAB — single-column stack ═══════ */
          <div className="w-full space-y-8">
            {actionItems.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                  Outreach opportunities
                </h3>
                <div className="space-y-4">
                  {actionItems.map((item) => (
                    <ActionCard
                      key={item.id}
                      item={item}
                      onSend={() => updateStatus(item.id, 'Sent')}
                      onDismiss={() => updateStatus(item.id, 'Dismissed')}
                      emailExpanded={expandedEmails.has(item.id)}
                      onToggleEmail={() => toggleEmail(item.id)}
                      copied={copiedId === item.id}
                      onCopy={() => item.draft_email && copyText(item.id, item.draft_email)}
                      statusColor={statusColor}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Overdue + upcoming follow-ups now live on the dedicated
                /reconnect page (sidebar). Daily Actions only shows the
                top 5 outreach opportunities so it stays focused. */}

            {actionItems.length === 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-base font-medium text-gray-900">No outreach opportunities today.</p>
                <p className="text-sm text-gray-500 mt-1">
                  Run the brief to surface news-anchored reasons to reach out, or check{' '}
                  <Link href="/reconnect" className="text-blue-600 hover:underline">
                    Reconnect
                  </Link>{' '}
                  for contacts past their cadence.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════ Category section — heading + single-column card list ═══════ */

function CategorySection({
  category,
  items,
}: {
  category: Category
  items: CategorizedBriefItem[]
}) {
  const style = CATEGORY_STYLES[category]
  return (
    <section>
      {/* Colored hairline above the heading gives a clear visual divider
          between sections even on a long scrolling feed. */}
      <div className={`h-0.5 w-12 rounded-full mb-3 ${style.ruleColor}`} />
      <div className="flex items-center gap-3 mb-5">
        <span className="text-3xl leading-none" aria-hidden="true">
          {style.emoji}
        </span>
        <h2 className={`text-2xl font-bold tracking-tight ${style.iconColor}`}>
          {style.label}
        </h2>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${style.countBg} ${style.countText}`}
        >
          {items.length}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <BriefCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function BriefCard({ item }: { item: CategorizedBriefItem }) {
  return (
    <article className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all">
      <div className="flex items-start justify-between gap-4 mb-1">
        <a
          href={item.source_url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base font-semibold text-blue-700 hover:underline leading-snug flex-1 min-w-0"
        >
          {item.headline}
        </a>
        {item.relevance_tag && (
          <span className="flex-shrink-0 text-xs text-gray-500 font-medium whitespace-nowrap max-w-[40%] truncate">
            {item.relevance_tag}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
        {item.source_name && <span>{item.source_name}</span>}
        {item.source_name && item.pub_date && <span>·</span>}
        {item.pub_date && <span>{formatDate(item.pub_date)}</span>}
      </div>
      {item.so_what && (
        <p className="text-sm text-gray-700 leading-relaxed">{item.so_what}</p>
      )}
    </article>
  )
}

/* ═══════ Action card ═══════ */

function ActionCard({
  item,
  onSend,
  onDismiss,
  emailExpanded,
  onToggleEmail,
  copied,
  onCopy,
  statusColor,
}: {
  item: ActionItem
  onSend: () => void
  onDismiss: () => void
  emailExpanded: boolean
  onToggleEmail: () => void
  copied: boolean
  onCopy: () => void
  statusColor: (s: string | null) => string
}) {
  const displayName = item.contact_name || 'Unknown contact'
  const initials = avatarInitials(displayName)
  const avatarColor = avatarColorClass(displayName)

  const isSent = item.status === 'Sent'
  const isDismissed = item.status === 'Dismissed'

  return (
    <article
      className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden transition-all ${
        isSent
          ? 'border-l-4 border-l-emerald-400 opacity-75'
          : isDismissed
            ? 'border-l-4 border-l-gray-300 opacity-50'
            : 'border-l-4 border-l-blue-500 hover:shadow-md'
      }`}
    >
      {/* Contact header */}
      <div className="flex items-start gap-3 p-5 pb-3">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-base flex-shrink-0 ${avatarColor}`}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {item.contact_id ? (
              <Link
                href={`/contacts/${item.contact_id}`}
                className="text-base font-bold text-gray-900 hover:text-blue-600"
              >
                {displayName}
              </Link>
            ) : (
              <span className="text-base font-bold text-gray-900">{displayName}</span>
            )}
            {item.contact_status && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${statusColor(item.contact_status)}`}
              >
                {item.contact_status}
              </span>
            )}
          </div>
          {item.contact_company && (
            <p className="text-sm text-gray-600 mt-0.5">{item.contact_company}</p>
          )}
        </div>
        {isSent && (
          <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Sent
          </span>
        )}
        {isDismissed && (
          <span className="text-xs text-gray-400 font-medium">Dismissed</span>
        )}
      </div>

      {item.contact_match_reason && (
        <p className="px-5 text-sm text-gray-700">{item.contact_match_reason}</p>
      )}

      <div className="px-5 py-4">
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
          <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">
            News hook
          </div>
          <a
            href={item.source_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-blue-700 hover:underline leading-snug block"
          >
            {item.headline}
          </a>
          {item.so_what && (
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{item.so_what}</p>
          )}
        </div>
      </div>

      {item.draft_email && !isSent && !isDismissed && (
        <div className="px-5 pb-4">
          <button
            onClick={onToggleEmail}
            className="text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1 uppercase tracking-wider"
          >
            {emailExpanded ? '▼' : '▶'} Draft email
          </button>
          {emailExpanded && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-2">
              <div className="flex justify-end mb-2">
                <button
                  onClick={onCopy}
                  className="text-xs bg-white border border-blue-200 px-3 py-1 rounded hover:bg-blue-50 text-blue-700 font-semibold"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {item.draft_email}
              </p>
            </div>
          )}
        </div>
      )}

      {!isSent && !isDismissed && (
        <div className="flex items-center gap-2 px-5 pb-4">
          <button
            onClick={onSend}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark as sent
          </button>
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-2 transition-colors"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </article>
  )
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}
