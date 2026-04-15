'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'

interface ArticleItem {
  headline: string
  url: string
  summary: string
}

interface EmailOption {
  label: string
  full_email: string
}

interface CompanyBrief {
  id: string
  company: string | null
  contact_name: string | null
  contact_id: string | null
  relevance: string | null
  articles: ArticleItem[]
  synthesis: string | null
  email_options: EmailOption[]
  created_at: string
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
  const [briefs, setBriefs] = useState<CompanyBrief[]>([])
  const [upcoming, setUpcoming] = useState<FollowUpContact[]>([])
  const [overdue, setOverdue] = useState<FollowUpContact[]>([])
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

    setBriefs(Array.isArray(briefsData) ? briefsData : [])
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

  const relevanceColor = (r: string | null) => {
    if (r === 'High') return 'bg-red-100 text-red-700'
    if (r === 'Medium') return 'bg-yellow-100 text-yellow-700'
    return 'bg-gray-100 text-gray-600'
  }

  // Build the action cards list: overdue first (most urgent), then upcoming,
  // then high-relevance briefs that have a contact to reach out to.
  const actionCards = useMemo(() => {
    type ActionCard =
      | {
          kind: 'overdue'
          id: string
          contactId: string
          name: string
          company: string | null
          days: number
          lastDate: string | null
        }
      | {
          kind: 'upcoming'
          id: string
          contactId: string
          name: string
          company: string | null
          days: number
          lastDate: string | null
        }
      | {
          kind: 'outreach'
          id: string
          contactId: string | null
          name: string
          company: string | null
          relevance: string
          articleHeadline: string | null
        }

    const cards: ActionCard[] = []

    for (const c of overdue) {
      cards.push({
        kind: 'overdue',
        id: `overdue-${c.id}`,
        contactId: c.id,
        name: c.name,
        company: c.company,
        days: c.days_overdue ?? 0,
        lastDate: c.last_contact_date,
      })
    }

    for (const c of upcoming) {
      cards.push({
        kind: 'upcoming',
        id: `upcoming-${c.id}`,
        contactId: c.id,
        name: c.name,
        company: c.company,
        days: c.days_until_due ?? 0,
        lastDate: c.last_contact_date,
      })
    }

    for (const b of briefs) {
      if (b.relevance !== 'High') continue
      if (!b.contact_name) continue // watchlist-only, no one to reach out to
      cards.push({
        kind: 'outreach',
        id: `outreach-${b.id}`,
        contactId: b.contact_id,
        name: b.contact_name,
        company: b.company,
        relevance: b.relevance,
        articleHeadline: b.articles[0]?.headline ?? null,
      })
    }

    return cards
  }, [overdue, upcoming, briefs])

  const actionCount = actionCards.length

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
            {runningBrief ? 'Running…' : 'Run Brief Now'}
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
            {briefs.length > 0 && (
              <span className="ml-2 inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                {briefs.length}
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
            {actionCount > 0 && (
              <span
                className={`ml-2 inline-block text-xs px-2 py-0.5 rounded-full ${
                  overdue.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {actionCount}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading…</p>
        ) : tab === 'brief' ? (
          /* ============ DAILY BRIEF TAB ============ */
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            {briefs.length === 0 ? (
              <p className="text-sm text-gray-400">
                No brief items yet today. Click &quot;Run Brief Now&quot; to generate.
              </p>
            ) : (
              <div className="space-y-5">
                {briefs.map((item) => (
                  <div
                    key={item.id}
                    className="border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-base font-semibold text-gray-900">{item.company}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${relevanceColor(item.relevance)}`}
                      >
                        {item.relevance}
                      </span>
                    </div>

                    {item.contact_name && (
                      <p className="text-xs text-gray-500 mb-3">
                        {item.contact_name === '(watchlist)' ? (
                          <span className="inline-block bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">
                            Watchlist
                          </span>
                        ) : (
                          <>
                            Contact{item.contact_name.includes(',') ? 's' : ''}:{' '}
                            {item.contact_id ? (
                              <Link
                                href={`/contacts/${item.contact_id}`}
                                className="text-blue-600 hover:underline"
                              >
                                {item.contact_name}
                              </Link>
                            ) : (
                              item.contact_name
                            )}
                          </>
                        )}
                      </p>
                    )}

                    {item.articles.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {item.articles.map((article, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg p-3">
                            <a
                              href={article.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-blue-600 hover:underline"
                            >
                              {article.headline}
                            </a>
                            <p className="text-xs text-gray-600 mt-1">{article.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {item.synthesis && (
                      <div className="border-t border-gray-100 pt-3 mb-3">
                        <p className="text-xs font-medium text-gray-500 mb-1">Synthesis</p>
                        <p className="text-sm text-gray-700">{item.synthesis}</p>
                      </div>
                    )}

                    {item.email_options.length > 0 && (
                      <div className="border-t border-gray-100 pt-3">
                        <button
                          onClick={() => toggleEmail(item.id)}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1"
                        >
                          {expandedEmails.has(item.id) ? '▼' : '▶'} Draft Emails (
                          {item.email_options.length} option
                          {item.email_options.length > 1 ? 's' : ''})
                        </button>

                        {expandedEmails.has(item.id) && (
                          <div className="space-y-3">
                            {item.email_options.map((option, i) => (
                              <div key={i} className="bg-blue-50 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-blue-800">
                                    {option.label}
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyText(`${item.id}-opt-${i}`, option.full_email)
                                    }
                                    className="text-xs bg-white border border-blue-200 px-3 py-1 rounded hover:bg-blue-50 text-blue-700 font-medium"
                                  >
                                    {copiedId === `${item.id}-opt-${i}` ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                  {option.full_email}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ============ DAILY ACTIONS TAB ============ */
          <div>
            {actionCount === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
                <p className="text-sm text-gray-500">
                  All caught up! No overdue follow-ups and no high-priority outreach queued.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {actionCards.map((card) => {
                  if (card.kind === 'overdue') {
                    return (
                      <div
                        key={card.id}
                        className="bg-white rounded-lg shadow-sm border-l-4 border-l-red-500 border border-gray-200 p-5"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-red-700">
                            Overdue
                          </span>
                          <span className="text-xs text-red-700 font-medium">
                            {card.days} {card.days === 1 ? 'day' : 'days'}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">{card.name}</h3>
                        {card.company && (
                          <p className="text-sm text-gray-500 mb-3">{card.company}</p>
                        )}
                        <p className="text-xs text-gray-500 mb-4">
                          Last contact:{' '}
                          {card.lastDate ? new Date(card.lastDate).toLocaleDateString() : '—'}
                        </p>
                        <Link
                          href={`/contacts/${card.contactId}`}
                          className="inline-block text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Reach out →
                        </Link>
                      </div>
                    )
                  }
                  if (card.kind === 'upcoming') {
                    return (
                      <div
                        key={card.id}
                        className="bg-white rounded-lg shadow-sm border-l-4 border-l-yellow-500 border border-gray-200 p-5"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-yellow-700">
                            Follow-up due
                          </span>
                          <span className="text-xs text-yellow-700 font-medium">
                            {card.days === 0 ? 'Today' : `in ${card.days}d`}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">{card.name}</h3>
                        {card.company && (
                          <p className="text-sm text-gray-500 mb-3">{card.company}</p>
                        )}
                        <p className="text-xs text-gray-500 mb-4">
                          Last contact:{' '}
                          {card.lastDate ? new Date(card.lastDate).toLocaleDateString() : '—'}
                        </p>
                        <Link
                          href={`/contacts/${card.contactId}`}
                          className="inline-block text-sm font-medium text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Open contact →
                        </Link>
                      </div>
                    )
                  }
                  // outreach
                  return (
                    <div
                      key={card.id}
                      className="bg-white rounded-lg shadow-sm border-l-4 border-l-blue-500 border border-gray-200 p-5"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                          High-relevance news
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900">{card.name}</h3>
                      {card.company && (
                        <p className="text-sm text-gray-500 mb-2">{card.company}</p>
                      )}
                      {card.articleHeadline && (
                        <p className="text-xs text-gray-700 mb-4 line-clamp-2">
                          {card.articleHeadline}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setTab('brief')}
                          className="text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          View brief →
                        </button>
                        {card.contactId && (
                          <Link
                            href={`/contacts/${card.contactId}`}
                            className="text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Contact
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
