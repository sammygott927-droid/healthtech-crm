'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

/* ── Interfaces matching the new /api/briefs-today response ── */

interface BriefItem {
  id: string
  headline: string
  source_url: string | null
  source_name: string | null
  pub_date: string | null
  so_what: string | null
  relevance_tag: string | null
  relevance_score: number
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

interface FollowUpContact {
  id: string
  name: string
  company: string | null
  last_contact_date: string | null
  days_until_due?: number
  days_overdue?: number
}

type Tab = 'brief' | 'actions'

export default function HomePage() {
  const [briefItems, setBriefItems] = useState<BriefItem[]>([])
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [upcoming, setUpcoming] = useState<FollowUpContact[]>([])
  const [overdue, setOverdue] = useState<FollowUpContact[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runningBrief, setRunningBrief] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('brief')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [briefsRes, followUpsRes] = await Promise.all([
      fetch('/api/briefs-today'),
      fetch('/api/follow-ups'),
    ])
    const briefsData = await briefsRes.json()
    const followUpsData = await followUpsRes.json()

    setBriefItems(briefsData.brief || [])
    setActionItems(briefsData.actions || [])
    setHasRun(briefsData.has_run || false)
    setUpcoming(followUpsData.upcoming || [])
    setOverdue(followUpsData.overdue || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function runBrief() {
    setRunningBrief(true)
    await fetch('/api/daily-brief', { method: 'POST' })
    await fetchData()
    setRunningBrief(false)
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
    if (s === 'Warm') return 'bg-yellow-100 text-yellow-800'
    if (s === 'Cold') return 'bg-blue-100 text-blue-800'
    return 'bg-gray-100 text-gray-600'
  }

  const totalActions = actionItems.length + overdue.length + upcoming.length

  return (
    <div className="p-8">
      <div className="max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
          <button
            onClick={runBrief}
            disabled={runningBrief}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {runningBrief ? 'Running…' : hasRun ? 'Refresh Brief' : 'Run Brief Now'}
          </button>
        </div>

        {/* Tabs */}
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
              <span
                className={`ml-2 inline-block text-xs px-2 py-0.5 rounded-full ${
                  overdue.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {totalActions}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading…</p>
        ) : tab === 'brief' ? (
          /* ═══════ DAILY BRIEF TAB — pure news feed ═══════ */
          <div>
            {briefItems.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
                <p className="text-sm text-gray-500">
                  {hasRun
                    ? 'No articles scored 6+ relevance today.'
                    : 'No brief yet today. Click "Run Brief Now" to generate.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {briefItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <a
                          href={item.source_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-blue-600 hover:underline leading-snug"
                        >
                          {item.headline}
                        </a>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                          {item.source_name && <span>{item.source_name}</span>}
                          {item.pub_date && (
                            <>
                              <span>·</span>
                              <span>{formatDate(item.pub_date)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {item.relevance_tag && (
                        <span className="flex-shrink-0 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                          {item.relevance_tag}
                        </span>
                      )}
                    </div>
                    {item.so_what && (
                      <p className="text-sm text-gray-700 mt-2">{item.so_what}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ═══════ DAILY ACTIONS TAB — outreach cards + follow-ups ═══════ */
          <div className="space-y-6">
            {/* News-based outreach cards */}
            {actionItems.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Outreach opportunities
                </h3>
                <div className="space-y-4">
                  {actionItems.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-white rounded-lg shadow-sm border-l-4 border border-gray-200 p-5 ${
                        item.status === 'Sent'
                          ? 'border-l-green-400 opacity-60'
                          : item.status === 'Dismissed'
                            ? 'border-l-gray-300 opacity-40'
                            : 'border-l-blue-500'
                      }`}
                    >
                      {/* Contact header */}
                      <div className="flex items-center gap-2 mb-2">
                        {item.contact_id ? (
                          <Link
                            href={`/contacts/${item.contact_id}`}
                            className="text-base font-semibold text-gray-900 hover:text-blue-600"
                          >
                            {item.contact_name}
                          </Link>
                        ) : (
                          <span className="text-base font-semibold text-gray-900">
                            {item.contact_name}
                          </span>
                        )}
                        {item.contact_company && (
                          <span className="text-sm text-gray-500">at {item.contact_company}</span>
                        )}
                        {item.contact_status && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor(item.contact_status)}`}
                          >
                            {item.contact_status}
                          </span>
                        )}
                      </div>

                      {/* Match reason */}
                      {item.contact_match_reason && (
                        <p className="text-sm text-gray-700 mb-3">{item.contact_match_reason}</p>
                      )}

                      {/* Article */}
                      <div className="bg-gray-50 rounded-lg p-3 mb-3">
                        <a
                          href={item.source_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          {item.headline}
                        </a>
                        {item.so_what && (
                          <p className="text-xs text-gray-600 mt-1">{item.so_what}</p>
                        )}
                      </div>

                      {/* Draft email (collapsible) */}
                      {item.draft_email && item.status === 'New' && (
                        <div className="mb-3">
                          <button
                            onClick={() => toggleEmail(item.id)}
                            className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1"
                          >
                            {expandedEmails.has(item.id) ? '▼' : '▶'} Draft email
                          </button>
                          {expandedEmails.has(item.id) && (
                            <div className="bg-blue-50 rounded-lg p-4 mt-2">
                              <div className="flex justify-end mb-2">
                                <button
                                  onClick={() => copyText(item.id, item.draft_email!)}
                                  className="text-xs bg-white border border-blue-200 px-3 py-1 rounded hover:bg-blue-50 text-blue-700 font-medium"
                                >
                                  {copiedId === item.id ? 'Copied!' : 'Copy'}
                                </button>
                              </div>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                {item.draft_email}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action buttons */}
                      {item.status === 'New' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateStatus(item.id, 'Sent')}
                            className="text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Mark as sent
                          </button>
                          <button
                            onClick={() => updateStatus(item.id, 'Dismissed')}
                            className="text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                      {item.status === 'Sent' && (
                        <span className="text-xs text-green-600 font-medium">Sent</span>
                      )}
                      {item.status === 'Dismissed' && (
                        <span className="text-xs text-gray-400 font-medium">Dismissed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overdue follow-ups */}
            {overdue.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Overdue connections
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {overdue.map((c) => (
                    <div
                      key={c.id}
                      className="bg-white rounded-lg shadow-sm border-l-4 border-l-red-500 border border-gray-200 p-4"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-red-700">
                          {c.days_overdue}d overdue
                        </span>
                      </div>
                      <Link
                        href={`/contacts/${c.id}`}
                        className="text-sm font-semibold text-gray-900 hover:text-blue-600"
                      >
                        {c.name}
                      </Link>
                      {c.company && (
                        <p className="text-xs text-gray-500">{c.company}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        Last: {c.last_contact_date ? new Date(c.last_contact_date).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming follow-ups */}
            {upcoming.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Follow-ups due this week
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {upcoming.map((c) => (
                    <div
                      key={c.id}
                      className="bg-white rounded-lg shadow-sm border-l-4 border-l-yellow-500 border border-gray-200 p-4"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-yellow-700">
                          {c.days_until_due === 0 ? 'Due today' : `Due in ${c.days_until_due}d`}
                        </span>
                      </div>
                      <Link
                        href={`/contacts/${c.id}`}
                        className="text-sm font-semibold text-gray-900 hover:text-blue-600"
                      >
                        {c.name}
                      </Link>
                      {c.company && (
                        <p className="text-xs text-gray-500">{c.company}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        Last: {c.last_contact_date ? new Date(c.last_contact_date).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All clear state */}
            {totalActions === 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
                <p className="text-sm text-gray-500">
                  All caught up! No outreach opportunities, overdue follow-ups, or upcoming reminders.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
